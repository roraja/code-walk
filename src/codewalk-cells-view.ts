/**
 * Code Walk Cells Webview — renders a code walk as notebook-style cells in a
 * dedicated sidebar panel.
 *
 * Each cell shows:
 * - A progress bar + sticky navigation header
 * - The code slice with highlighted lines
 * - AI narrative / explanation (and sub-steps when present)
 * - Variable state (changed / created / read)
 * - The call stack at that point
 * - Branch options when a cell forks into multiple paths
 *
 * Navigation supports branching: when a cell has multiple `nextCellIds`, the
 * viewer presents a choice of which path to explore. A navigation history stack
 * enables correct "Prev" behavior regardless of which branches were taken.
 *
 * @module codewalk-cells-view
 */

import * as vscode from 'vscode';
import { log, logEntry, logExit } from './logger.js';
import type { CodeWalk, WalkCell, CellStep, BranchOption } from './codewalk-types.js';

/** Webview provider for the Code Walk Cells panel. */
export class CodeWalkCellsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codewalk.cells';

  private view?: vscode.WebviewView;
  private currentWalk?: CodeWalk;
  private currentCellIndex = 0;
  private currentStepIndex = -1; // -1 = no steps / show all

  /**
   * Navigation history — a stack of cell indices the user has visited. When the
   * user navigates forward (including choosing a branch), the current index is
   * pushed. "Prev" pops from this stack, so it always retraces the exact path.
   */
  private navigationHistory: number[] = [];

  /** Map from cell ID → index in walk.cells for O(1) lookup. */
  private cellIdToIndex = new Map<string, number>();

  /** Fired when the current cell changes (for syncing editor highlights). */
  private _onCellChanged = new vscode.EventEmitter<
    { walk: CodeWalk; cell: WalkCell; index: number; stepIndex: number; step?: CellStep } | undefined
  >();
  readonly onCellChanged = this._onCellChanged.event;

  /** Invoked when the user asks to open a code walk from the empty state. */
  onRequestOpen?: () => void;

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    logEntry('CodeWalkCellsViewProvider.resolveWebviewView');
    this.view = webviewView;

    webviewView.webview.options = { enableScripts: true };

    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.type) {
        case 'navigateToCell':
          this.goToCell(message.index);
          break;
        case 'nextCell':
          this.nextCell();
          break;
        case 'prevCell':
          this.prevCell();
          break;
        case 'nextStep':
          this.nextStep();
          break;
        case 'prevStep':
          this.prevStep();
          break;
        case 'goToStep':
          this.goToStepIndex(message.stepIndex);
          break;
        case 'selectBranch':
          this.selectBranch(message.branchIndex);
          break;
        case 'openWalk':
          this.onRequestOpen?.();
          break;
        case 'openFrame': {
          const filePath = message.filePath as string;
          const line = message.line as number;
          if (filePath && line) {
            log('debug', 'CodeWalkCellsViewProvider: openFrame', { filePath, line });
            vscode.commands.executeCommand('codewalk.openFrame', {
              functionName: message.functionName ?? '',
              filePath,
              line,
            });
          }
          break;
        }
      }
    });

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.render();
      }
    });

    this.render();
    logExit('CodeWalkCellsViewProvider.resolveWebviewView');
  }

  /** Load a code walk into the cells view. */
  loadWalk(walk: CodeWalk): void {
    logEntry('CodeWalkCellsViewProvider.loadWalk', { walkId: walk.id, cellCount: walk.cells.length });
    this.currentWalk = walk;
    this.currentCellIndex = 0;
    this.navigationHistory = [];
    const firstCell = walk.cells[0];
    this.currentStepIndex = firstCell?.steps && firstCell.steps.length > 0 ? 0 : -1;
    this.rebuildCellIdMap();
    this.render();
    this.fireCellChanged();
    logExit('CodeWalkCellsViewProvider.loadWalk');
  }

  getWalk(): CodeWalk | undefined {
    return this.currentWalk;
  }

  getCurrentCell(): WalkCell | undefined {
    if (!this.currentWalk) return undefined;
    return this.currentWalk.cells[this.currentCellIndex];
  }

  getCurrentCellIndex(): number {
    return this.currentCellIndex;
  }

  getCurrentStep(): CellStep | undefined {
    const cell = this.getCurrentCell();
    if (cell?.steps && this.currentStepIndex >= 0) {
      return cell.steps[this.currentStepIndex];
    }
    return undefined;
  }

  /**
   * Navigate to the next cell (or next sub-step within the current cell).
   *
   * If the current cell has multiple `nextCellIds` (a branch point), this
   * triggers the branch selection UI instead of advancing automatically. If it
   * has exactly one `nextCellId`, it follows that link. Otherwise it falls
   * through to the next cell by index.
   */
  nextCell(): void {
    if (!this.currentWalk) return;
    const cell = this.currentWalk.cells[this.currentCellIndex];

    if (cell?.steps && cell.steps.length > 0 && this.currentStepIndex < cell.steps.length - 1) {
      this.currentStepIndex++;
      this.render();
      this.fireCellChanged();
      return;
    }

    if (cell?.nextCellIds && cell.nextCellIds.length > 1) {
      vscode.window.showInformationMessage(
        'Code Walk: This is a branch point. Choose a path from the options below.',
      );
      return;
    }

    if (cell?.nextCellIds && cell.nextCellIds.length === 1) {
      const nextIdx = this.cellIdToIndex.get(cell.nextCellIds[0]);
      if (nextIdx !== undefined) {
        this.navigateForward(nextIdx);
        return;
      }
    }

    if (this.currentCellIndex < this.currentWalk.cells.length - 1) {
      this.navigateForward(this.currentCellIndex + 1);
    } else {
      vscode.window.showInformationMessage('Code Walk: Already at the last cell.');
    }
  }

  /**
   * Navigate to the previous cell (or previous sub-step within the current
   * cell). Uses the navigation history stack to retrace the user's exact path.
   */
  prevCell(): void {
    if (!this.currentWalk) return;
    const cell = this.currentWalk.cells[this.currentCellIndex];

    if (cell?.steps && cell.steps.length > 0 && this.currentStepIndex > 0) {
      this.currentStepIndex--;
      this.render();
      this.fireCellChanged();
      return;
    }

    if (this.navigationHistory.length > 0) {
      this.currentCellIndex = this.navigationHistory.pop()!;
      const prevCell = this.currentWalk.cells[this.currentCellIndex];
      this.currentStepIndex = prevCell?.steps && prevCell.steps.length > 0 ? 0 : -1;
      this.render();
      this.fireCellChanged();
    } else {
      vscode.window.showInformationMessage('Code Walk: Already at the first cell.');
    }
  }

  /** Select a branch when the current cell has multiple nextCellIds. */
  selectBranch(branchIndex: number): void {
    if (!this.currentWalk) return;
    const cell = this.currentWalk.cells[this.currentCellIndex];
    if (!cell?.nextCellIds || branchIndex < 0 || branchIndex >= cell.nextCellIds.length) return;

    const targetId = cell.nextCellIds[branchIndex];
    const targetIdx = this.cellIdToIndex.get(targetId);
    if (targetIdx !== undefined) {
      log('debug', 'CodeWalkCellsViewProvider: selectBranch', {
        branchIndex,
        targetId,
        targetIdx,
        label: cell.branchOptions?.[branchIndex]?.label ?? targetId,
      });
      this.navigateForward(targetIdx);
    } else {
      vscode.window.showWarningMessage(`Code Walk: Branch target cell "${targetId}" not found.`);
    }
  }

  nextStep(): void {
    if (!this.currentWalk) return;
    const cell = this.currentWalk.cells[this.currentCellIndex];
    if (cell?.steps && this.currentStepIndex < cell.steps.length - 1) {
      this.currentStepIndex++;
      this.render();
      this.fireCellChanged();
    }
  }

  prevStep(): void {
    if (!this.currentWalk) return;
    const cell = this.currentWalk.cells[this.currentCellIndex];
    if (cell?.steps && this.currentStepIndex > 0) {
      this.currentStepIndex--;
      this.render();
      this.fireCellChanged();
    }
  }

  goToStepIndex(stepIndex: number): void {
    if (!this.currentWalk) return;
    const cell = this.currentWalk.cells[this.currentCellIndex];
    if (cell?.steps && stepIndex >= 0 && stepIndex < cell.steps.length) {
      this.currentStepIndex = stepIndex;
      this.render();
      this.fireCellChanged();
    }
  }

  /** Jump to a specific cell by index (records history so Prev works). */
  goToCell(index: number): void {
    if (!this.currentWalk) return;
    if (index >= 0 && index < this.currentWalk.cells.length && index !== this.currentCellIndex) {
      this.navigationHistory.push(this.currentCellIndex);
      this.currentCellIndex = index;
      const cell = this.currentWalk.cells[index];
      this.currentStepIndex = cell?.steps && cell.steps.length > 0 ? 0 : -1;
      this.render();
      this.fireCellChanged();
    }
  }

  clear(): void {
    this.currentWalk = undefined;
    this.currentCellIndex = 0;
    this.currentStepIndex = -1;
    this.navigationHistory = [];
    this.cellIdToIndex.clear();
    this.render();
    this._onCellChanged.fire(undefined);
  }

  // -------------------------------------------------------------------------
  // Private: navigation helpers
  // -------------------------------------------------------------------------

  private navigateForward(targetIndex: number): void {
    this.navigationHistory.push(this.currentCellIndex);
    this.currentCellIndex = targetIndex;
    const cell = this.currentWalk!.cells[this.currentCellIndex];
    this.currentStepIndex = cell?.steps && cell.steps.length > 0 ? 0 : -1;
    this.render();
    this.fireCellChanged();
  }

  private rebuildCellIdMap(): void {
    this.cellIdToIndex.clear();
    if (!this.currentWalk) return;
    for (let i = 0; i < this.currentWalk.cells.length; i++) {
      this.cellIdToIndex.set(this.currentWalk.cells[i].id, i);
    }
  }

  private fireCellChanged(): void {
    if (!this.currentWalk) return;
    const cell = this.currentWalk.cells[this.currentCellIndex];
    if (!cell) return;
    const step = cell.steps && this.currentStepIndex >= 0 ? cell.steps[this.currentStepIndex] : undefined;
    this._onCellChanged.fire({
      walk: this.currentWalk,
      cell,
      index: this.currentCellIndex,
      stepIndex: this.currentStepIndex,
      step,
    });
  }

  private render(): void {
    if (!this.view) return;

    if (!this.currentWalk || this.currentWalk.cells.length === 0) {
      this.view.webview.html = this.getEmptyHtml();
      return;
    }

    this.view.webview.html = this.getWalkHtml(this.currentWalk, this.currentCellIndex, this.currentStepIndex);
  }

  // -------------------------------------------------------------------------
  // Private: HTML rendering
  // -------------------------------------------------------------------------

  private getEmptyHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${this.getBaseStyles()}</style>
</head>
<body>
  <div class="empty">
    <div class="empty-icon">&#9776;</div>
    <p class="empty-title">No code walk loaded</p>
    <p class="hint">Open a code walk to step through a traced execution path with code highlights, variable state, and call stacks.</p>
    <button class="primary-btn" id="openBtn">Open Code Walk</button>
  </div>
  <script>
    (function() {
      const vscode = acquireVsCodeApi();
      document.getElementById('openBtn')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'openWalk' });
      });
    })();
  </script>
</body>
</html>`;
  }

  private getWalkHtml(walk: CodeWalk, activeIndex: number, stepIndex: number): string {
    const cell = walk.cells[activeIndex];
    if (!cell) return this.getEmptyHtml();

    const totalCells = walk.cells.length;
    const hasSteps = !!(cell.steps && cell.steps.length > 0 && stepIndex >= 0);
    const hasBranching = !!(cell.nextCellIds && cell.nextCellIds.length > 1);
    const canGoBack = this.navigationHistory.length > 0;
    const isEndCell = this.isEndCell(cell, walk);

    // Progress: how far through the walk (by index, 1-based).
    const progressPct = Math.round(((activeIndex + 1) / totalCells) * 100);

    const narrativeHtml = this.renderNarrative(cell, hasSteps, stepIndex);
    const stepsBarHtml = hasSteps ? this.renderStepsBar(cell, stepIndex) : '';
    const branchOptionsHtml = hasBranching ? this.renderBranchOptions(cell) : '';
    const codeHtml = this.renderCodeSlice(cell);
    const variablesHtml = this.renderVariables(cell);
    const callStackHtml = this.renderCallStack(cell);
    const cellListHtml = this.renderCellList(walk, activeIndex);
    const breadcrumbHtml = this.renderBreadcrumb(walk);

    const typeLabel = this.formatCellType(cell.type);
    const typeClass = `type-${cell.type}`;
    const statusClass = `status-${cell.status}`;

    const confPct = cell.confidence !== undefined ? (cell.confidence * 100).toFixed(0) + '%' : '';
    const confClass =
      cell.confidence !== undefined
        ? cell.confidence >= 0.8
          ? 'conf-high'
          : cell.confidence >= 0.5
            ? 'conf-mid'
            : 'conf-low'
        : '';

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${this.getBaseStyles()}</style>
</head>
<body>
  <header class="topbar">
    <div class="walk-title">
      <span class="walk-name" title="${escapeHtml(walk.description || walk.name)}">${escapeHtml(walk.name)}</span>
    </div>
    <div class="cell-nav">
      <button class="nav-btn" id="prevBtn" ${!canGoBack ? 'disabled' : ''} title="Previous (history-aware)">&#8593;</button>
      <span class="cell-counter">${activeIndex + 1}<span class="counter-sep">/</span>${totalCells}</span>
      <button class="nav-btn nav-btn-primary" id="nextBtn" ${isEndCell ? 'disabled' : ''} ${hasBranching ? 'title="Choose a branch below"' : 'title="Next"'}>&#8595;</button>
    </div>
  </header>

  <div class="progress-track"><div class="progress-fill" style="width:${progressPct}%"></div></div>

  ${breadcrumbHtml}

  <main class="content">
    <div class="cell-meta">
      <span class="badge ${typeClass}">${typeLabel}</span>
      ${hasBranching ? '<span class="badge type-branch-point">BRANCH</span>' : ''}
      <span class="badge ${statusClass}">${escapeHtml(cell.status)}</span>
      ${confPct ? `<span class="badge ${confClass}" title="AI confidence">${confPct}</span>` : ''}
      <span class="cell-depth" title="Call stack depth">&#8623; ${cell.stackDepth}</span>
    </div>

    <button class="file-ref" id="fileRef" title="Open in editor">
      <span class="file-ref-icon">&#128196;</span>
      <span class="file-ref-path">${escapeHtml(shortenPath(cell.code.filePath))}:${cell.code.startLine}-${cell.code.endLine}</span>
    </button>

    ${stepsBarHtml}
    ${narrativeHtml}

    <section class="card">
      <div class="card-head"><h3>Code</h3></div>
      <div class="code-block">${codeHtml}</div>
    </section>

    ${branchOptionsHtml}
    ${variablesHtml}
    ${callStackHtml}

    <section class="card cells-card">
      <div class="card-head"><h3>Cells</h3><span class="card-sub">${totalCells}</span></div>
      <div class="cell-list">${cellListHtml}</div>
    </section>
  </main>

  <script>
    (function() {
      const vscode = acquireVsCodeApi();

      const post = (msg) => vscode.postMessage(msg);

      document.getElementById('prevBtn')?.addEventListener('click', () => post({ type: 'prevCell' }));
      document.getElementById('nextBtn')?.addEventListener('click', () => post({ type: 'nextCell' }));
      document.getElementById('prevStepBtn')?.addEventListener('click', () => post({ type: 'prevStep' }));
      document.getElementById('nextStepBtn')?.addEventListener('click', () => post({ type: 'nextStep' }));

      const fileRef = document.getElementById('fileRef');
      if (fileRef) {
        fileRef.addEventListener('click', () => {
          const fp = fileRef.getAttribute('data-filepath');
          const ln = parseInt(fileRef.getAttribute('data-line') || '0', 10);
          if (fp) post({ type: 'openFrame', filePath: fp, line: ln, functionName: '' });
        });
      }

      document.querySelectorAll('.step-dot, .step-dot-active, .step-dot-visited').forEach(el => {
        el.addEventListener('click', () => {
          post({ type: 'goToStep', stepIndex: parseInt(el.getAttribute('data-step') || '0', 10) });
        });
      });

      document.querySelectorAll('.branch-option-btn').forEach(el => {
        el.addEventListener('click', () => {
          post({ type: 'selectBranch', branchIndex: parseInt(el.getAttribute('data-branch-index') || '0', 10) });
        });
      });

      document.querySelectorAll('.cell-item').forEach(el => {
        el.addEventListener('click', () => {
          post({ type: 'navigateToCell', index: parseInt(el.getAttribute('data-index') || '0', 10) });
        });
      });

      document.querySelectorAll('.stack-frame-clickable').forEach(el => {
        el.addEventListener('click', () => {
          const filePath = el.getAttribute('data-filepath');
          const line = parseInt(el.getAttribute('data-line') || '0', 10);
          const functionName = el.getAttribute('data-funcname') || '';
          if (filePath && line) post({ type: 'openFrame', filePath, line, functionName });
        });
      });

      // Keyboard navigation: arrows / j / k.
      document.addEventListener('keydown', (e) => {
        if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
        if (e.key === 'ArrowDown' || e.key === 'j') { post({ type: 'nextCell' }); e.preventDefault(); }
        else if (e.key === 'ArrowUp' || e.key === 'k') { post({ type: 'prevCell' }); e.preventDefault(); }
      });

      // Keep the active cell visible in the mini-list.
      document.querySelector('.cell-item.cell-active')?.scrollIntoView({ block: 'nearest' });
    })();
  </script>
  <script>
    document.getElementById('fileRef')?.setAttribute('data-filepath', ${JSON.stringify(cell.code.filePath)});
    document.getElementById('fileRef')?.setAttribute('data-line', '${cell.code.startLine}');
  </script>
</body>
</html>`;
  }

  private renderNarrative(cell: WalkCell, hasSteps: boolean, stepIndex: number): string {
    if (hasSteps) {
      const step = cell.steps![stepIndex];
      let html = `<section class="card narrative-card">
        <div class="card-head"><h3>Step ${stepIndex + 1} of ${cell.steps!.length}</h3></div>
        <div class="narrative">${escapeHtml(step.description)}</div>
      </section>`;
      if (cell.narrative) {
        html += `<details class="full-narrative">
          <summary>Full narrative</summary>
          <div class="narrative narrative-muted">${escapeHtml(cell.narrative)}</div>
        </details>`;
      }
      return html;
    }

    if (cell.narrative) {
      return `<section class="card narrative-card">
        <div class="card-head"><h3>Explanation</h3></div>
        <div class="narrative">${escapeHtml(cell.narrative)}</div>
      </section>`;
    }

    return '';
  }

  private renderStepsBar(cell: WalkCell, stepIndex: number): string {
    const dots = cell
      .steps!.map((_s, i) => {
        const cls = i === stepIndex ? 'step-dot-active' : i < stepIndex ? 'step-dot-visited' : 'step-dot';
        return `<span class="${cls}" data-step="${i}" title="Step ${i + 1}"></span>`;
      })
      .join('');
    return `<div class="steps-bar">
      <button class="step-btn" id="prevStepBtn" ${stepIndex === 0 ? 'disabled' : ''}>&#9664;</button>
      <span class="step-counter">Step ${stepIndex + 1}/${cell.steps!.length}</span>
      <button class="step-btn" id="nextStepBtn" ${stepIndex === cell.steps!.length - 1 ? 'disabled' : ''}>&#9654;</button>
      <div class="step-dots">${dots}</div>
    </div>`;
  }

  private isEndCell(cell: WalkCell, walk: CodeWalk): boolean {
    if (cell.nextCellIds) {
      return cell.nextCellIds.length === 0;
    }
    return cell.index >= walk.cells.length - 1;
  }

  private renderBranchOptions(cell: WalkCell): string {
    if (!cell.nextCellIds || cell.nextCellIds.length <= 1) return '';

    const options = cell.nextCellIds
      .map((nextId, i) => {
        const option: BranchOption | undefined = cell.branchOptions?.[i];
        const label = option?.label ?? `Path ${i + 1}`;
        const description = option?.description ?? `Go to ${nextId}`;
        const condition = option?.condition
          ? `<div class="branch-condition">${escapeHtml(option.condition)}</div>`
          : '';
        const hint = option?.pathHint ?? 'default';

        return `<div class="branch-option branch-hint-${hint}">
          <button class="branch-option-btn" data-branch-index="${i}">
            <span class="branch-option-icon">${this.getBranchHintIcon(hint)}</span>
            <span class="branch-option-label">${escapeHtml(label)}</span>
            <span class="branch-option-go">&#8594;</span>
          </button>
          <div class="branch-option-desc">${escapeHtml(description)}</div>
          ${condition}
        </div>`;
      })
      .join('\n');

    return `<section class="card branch-section">
      <div class="card-head"><h3>Choose a Path</h3></div>
      <div class="branch-options">${options}</div>
    </section>`;
  }

  private renderBreadcrumb(walk: CodeWalk): string {
    if (this.navigationHistory.length === 0) return '';

    const pathIndices = [...this.navigationHistory.slice(-5), this.currentCellIndex];
    const crumbs = pathIndices
      .map((idx, i) => {
        const c = walk.cells[idx];
        if (!c) return '';
        const isLast = i === pathIndices.length - 1;
        const label = this.getCellLabel(c);
        const truncated = this.navigationHistory.length > 5 && i === 0;
        return `<span class="breadcrumb-item ${isLast ? 'breadcrumb-current' : ''}">${truncated ? '&hellip; &rsaquo; ' : ''}${escapeHtml(label)}${isLast ? '' : ' &rsaquo; '}</span>`;
      })
      .join('');

    return `<div class="breadcrumb">${crumbs}</div>`;
  }

  private getBranchHintIcon(hint: string): string {
    switch (hint) {
      case 'taken':
        return '&#10003;';
      case 'skipped':
        return '&#10007;';
      case 'error':
        return '&#9888;';
      default:
        return '&#10140;';
    }
  }

  private renderCodeSlice(cell: WalkCell): string {
    const lines = cell.code.text.split('\n');
    const highlights = new Map<number, { type: string; annotation?: string }>();
    if (cell.code.highlights) {
      for (const h of cell.code.highlights) {
        highlights.set(h.line, { type: h.type, annotation: h.annotation });
      }
    }

    // Active sub-step focus range (rendered with a stronger marker).
    const step = cell.steps && this.currentStepIndex >= 0 ? cell.steps[this.currentStepIndex] : undefined;
    const focusStart = step?.focusLine;
    const focusEnd = step ? step.focusEndLine ?? step.focusLine : undefined;

    return lines
      .map((line, idx) => {
        const lineNum = cell.code.startLine + idx;
        const highlight = highlights.get(lineNum);
        const hlClass = highlight ? `hl-${highlight.type}` : '';
        const isFocus =
          focusStart !== undefined && focusEnd !== undefined && lineNum >= focusStart && lineNum <= focusEnd;
        const focusClass = isFocus ? 'code-focus' : '';
        const annotation = highlight?.annotation
          ? `<span class="line-annotation">${escapeHtml(highlight.annotation)}</span>`
          : '';
        return `<div class="code-line ${hlClass} ${focusClass}"><span class="line-num">${lineNum}</span><span class="line-code">${escapeHtml(line) || '&nbsp;'}</span>${annotation}</div>`;
      })
      .join('\n');
  }

  private renderVariables(cell: WalkCell): string {
    if (!cell.state || !cell.state.scopes || cell.state.scopes.length === 0) return '';

    const scopeHtmls = cell.state.scopes
      .map((scope) => {
        const entries = Object.entries(scope.variables);
        if (entries.length === 0) return '';
        const varRows = entries
          .map(([name, v]) => {
            const actionIcon =
              v.action === 'created'
                ? '<span class="var-action var-created" title="created">+</span>'
                : v.action === 'modified'
                  ? '<span class="var-action var-modified" title="modified">&#9998;</span>'
                  : v.action === 'read'
                    ? '<span class="var-action var-read" title="read">&#128065;</span>'
                    : '<span class="var-action"></span>';
            const changedClass = v.changed ? 'var-changed' : '';
            const rationale = v.rationale ? ` title="${escapeHtml(v.rationale)}"` : '';
            return `<div class="var-row ${changedClass}"${rationale}>
              ${actionIcon}
              <span class="var-name">${escapeHtml(name)}</span>
              ${v.type ? `<span class="var-type">${escapeHtml(v.type)}</span>` : ''}
              <span class="var-value">${escapeHtml(v.value)}</span>
            </div>`;
          })
          .join('\n');

        return `<div class="scope-group">
          <div class="scope-name">${escapeHtml(scope.name)}</div>
          ${varRows}
        </div>`;
      })
      .join('\n');

    let changesHtml = '';
    if (cell.state.changes && cell.state.changes.length > 0) {
      changesHtml = `<div class="changes-summary">
        <div class="changes-label">Changes</div>
        ${cell.state.changes.map((c) => `<div class="change-item">${escapeHtml(c)}</div>`).join('\n')}
      </div>`;
    }

    return `<section class="card">
      <div class="card-head"><h3>Variables</h3></div>
      ${scopeHtmls}
      ${changesHtml}
    </section>`;
  }

  private renderCallStack(cell: WalkCell): string {
    if (!cell.callStack || cell.callStack.length === 0) return '';

    const frames = cell.callStack.slice().reverse(); // most recent first
    const framesHtml = frames
      .map((frame, idx) => {
        const isTop = idx === 0;
        const fileName = frame.filePath.split('/').pop() ?? frame.filePath;
        return `<div class="stack-frame stack-frame-clickable ${isTop ? 'stack-frame-current' : ''}" data-filepath="${escapeHtml(frame.filePath)}" data-line="${frame.line}" data-funcname="${escapeHtml(frame.functionName)}">
          <span class="stack-depth">#${frame.depth}</span>
          <span class="stack-name">${escapeHtml(frame.functionName)}</span>
          <span class="stack-loc">${escapeHtml(fileName)}:${frame.line}</span>
        </div>`;
      })
      .join('\n');

    return `<section class="card">
      <div class="card-head"><h3>Call Stack</h3></div>
      <div class="stack-frames">${framesHtml}</div>
    </section>`;
  }

  private renderCellList(walk: CodeWalk, activeIndex: number): string {
    return walk.cells
      .map((cell, idx) => {
        const isActive = idx === activeIndex;
        const isInHistory = this.navigationHistory.includes(idx);
        const indent = '  '.repeat(Math.min(cell.stackDepth, 6));
        const typeIcon = this.getCellTypeIcon(cell.type);
        const hasBranch = cell.nextCellIds && cell.nextCellIds.length > 1;
        const branchIcon = hasBranch ? '<span class="cell-branch-icon" title="Branch point">&#9733;</span>' : '';
        return `<div class="cell-item ${isActive ? 'cell-active' : ''} ${isInHistory ? 'cell-visited' : ''}" data-index="${idx}">
          <span class="cell-num">${idx + 1}</span>
          <span class="cell-indent">${indent}</span>
          <span class="cell-icon type-icon-${cell.type}">${typeIcon}</span>
          <span class="cell-label">${escapeHtml(this.getCellLabel(cell))}</span>
          ${branchIcon}
          <span class="cell-status-dot status-dot-${cell.status}"></span>
        </div>`;
      })
      .join('\n');
  }

  private getCellLabel(cell: WalkCell): string {
    const func = cell.callStack?.[cell.callStack.length - 1]?.functionName ?? '';
    const shortFunc = func.split('::').pop() ?? func;
    switch (cell.type) {
      case 'entry':
        return shortFunc || 'Entry';
      case 'call':
        return `\u2192 ${shortFunc}`;
      case 'branch':
        return 'Branch';
      case 'assignment':
        return 'Assign';
      case 'return':
        return '\u2190 Return';
      case 'dispatch':
        return 'Dispatch';
      case 'block':
        return 'Block';
      case 'note':
        return 'Note';
      default:
        return cell.type;
    }
  }

  private getCellTypeIcon(type: string): string {
    switch (type) {
      case 'entry':
        return '&#9654;';
      case 'call':
        return '&rarr;';
      case 'branch':
        return '&#9094;';
      case 'assignment':
        return '=';
      case 'return':
        return '&larr;';
      case 'dispatch':
        return '&#10239;';
      case 'block':
        return '&#9642;';
      case 'note':
        return '&#9998;';
      default:
        return '&middot;';
    }
  }

  private formatCellType(type: string): string {
    switch (type) {
      case 'entry':
        return 'Entry';
      case 'call':
        return 'Call';
      case 'branch':
        return 'Branch';
      case 'assignment':
        return 'Assignment';
      case 'return':
        return 'Return';
      case 'dispatch':
        return 'Dispatch';
      case 'block':
        return 'Block';
      case 'note':
        return 'Note';
      default:
        return type;
    }
  }

  private getBaseStyles(): string {
    return /* css */ `
      :root {
        --font: var(--vscode-font-family, system-ui, sans-serif);
        --mono: var(--vscode-editor-font-family, monospace);
        --fg: var(--vscode-foreground);
        --bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
        --border: var(--vscode-panel-border, var(--vscode-widget-border, rgba(128,128,128,0.3)));
        --muted: var(--vscode-descriptionForeground);
        --link: var(--vscode-textLink-foreground);
        --badge-bg: var(--vscode-badge-background);
        --badge-fg: var(--vscode-badge-foreground);
        --btn-bg: var(--vscode-button-background);
        --btn-fg: var(--vscode-button-foreground);
        --btn-hover: var(--vscode-button-hoverBackground);
        --btn-sec-bg: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.18));
        --btn-sec-fg: var(--vscode-button-secondaryForeground, var(--fg));
        --green: var(--vscode-charts-green, #4caf50);
        --yellow: var(--vscode-charts-yellow, #ff9800);
        --red: var(--vscode-charts-red, #f44336);
        --blue: var(--vscode-charts-blue, #2196f3);
        --purple: var(--vscode-charts-purple, #9c27b0);
        --hover-bg: var(--vscode-list-hoverBackground, rgba(128,128,128,0.12));
        --active-bg: var(--vscode-list-activeSelectionBackground, rgba(0,120,215,0.15));
        --card-bg: var(--vscode-editorWidget-background, rgba(128,128,128,0.05));
        --code-bg: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.1));
        --narrative-bg: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.08));
      }

      * { box-sizing: border-box; margin: 0; padding: 0; }

      body {
        font-family: var(--font);
        font-size: 13px;
        color: var(--fg);
        background: var(--bg);
        line-height: 1.5;
        padding: 0;
      }

      /* Empty state */
      .empty {
        text-align: center;
        padding: 40px 20px;
        color: var(--muted);
      }
      .empty-icon { font-size: 36px; opacity: 0.35; margin-bottom: 12px; }
      .empty-title { font-size: 14px; font-weight: 600; color: var(--fg); margin-bottom: 6px; }
      .empty .hint { font-size: 12px; opacity: 0.8; margin-bottom: 18px; line-height: 1.5; }
      .primary-btn {
        background: var(--btn-bg);
        color: var(--btn-fg);
        border: none;
        padding: 7px 18px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        font-family: var(--font);
        font-weight: 500;
      }
      .primary-btn:hover { background: var(--btn-hover); }

      /* Sticky top bar */
      .topbar {
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 10px 6px;
        background: var(--bg);
        border-bottom: 1px solid var(--border);
      }
      .walk-title { min-width: 0; flex: 1; }
      .walk-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--fg);
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cell-nav { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
      .nav-btn {
        background: var(--btn-sec-bg);
        color: var(--btn-sec-fg);
        border: none;
        width: 26px;
        height: 24px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        line-height: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .nav-btn-primary { background: var(--btn-bg); color: var(--btn-fg); }
      .nav-btn-primary:hover:not(:disabled) { background: var(--btn-hover); }
      .nav-btn:hover:not(:disabled) { filter: brightness(1.15); }
      .nav-btn:disabled { opacity: 0.35; cursor: default; }
      .cell-counter { font-size: 12px; font-weight: 600; min-width: 38px; text-align: center; font-variant-numeric: tabular-nums; }
      .counter-sep { opacity: 0.5; margin: 0 1px; }

      /* Progress bar */
      .progress-track { height: 3px; background: rgba(128,128,128,0.18); width: 100%; }
      .progress-fill { height: 100%; background: var(--blue); transition: width 0.25s ease; }

      /* Breadcrumb */
      .breadcrumb {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 1px;
        font-size: 10px;
        color: var(--muted);
        padding: 6px 10px;
        background: var(--code-bg);
      }
      .breadcrumb-item { white-space: nowrap; }
      .breadcrumb-current { color: var(--link); font-weight: 600; }

      /* Content */
      .content { padding: 10px; }

      .cell-meta { display: flex; align-items: center; gap: 5px; margin-bottom: 8px; flex-wrap: wrap; }

      .badge {
        display: inline-block;
        font-size: 9px;
        padding: 1px 7px;
        border-radius: 9px;
        background: var(--badge-bg);
        color: var(--badge-fg);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.4px;
      }
      .type-entry { background: var(--blue); color: #fff; }
      .type-call { background: #2196f3; color: #fff; }
      .type-branch { background: #ff9800; color: #000; }
      .type-branch-point { background: var(--purple); color: #fff; animation: pulse-badge 2s infinite; }
      .type-assignment { background: #795548; color: #fff; }
      .type-return { background: #607d8b; color: #fff; }
      .type-dispatch { background: #9c27b0; color: #fff; }
      .type-block { background: #455a64; color: #fff; }
      .type-note { background: #78909c; color: #fff; }

      @keyframes pulse-badge { 0%,100% { opacity: 1; } 50% { opacity: 0.65; } }

      .status-skeleton { background: var(--muted); color: #fff; }
      .status-partial { background: var(--yellow); color: #000; }
      .status-complete { background: var(--green); color: #fff; }
      .status-corrected { background: #e91e63; color: #fff; }

      .conf-high { background: var(--green); color: #fff; }
      .conf-mid { background: var(--yellow); color: #000; }
      .conf-low { background: var(--red); color: #fff; }

      .cell-depth { font-size: 10px; color: var(--muted); margin-left: auto; font-variant-numeric: tabular-nums; }

      /* File ref button */
      .file-ref {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        background: var(--code-bg);
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 5px 8px;
        margin-bottom: 12px;
        cursor: pointer;
        font-family: var(--mono);
        font-size: 11px;
        color: var(--muted);
        text-align: left;
      }
      .file-ref:hover { color: var(--link); border-color: var(--link); }
      .file-ref-icon { flex-shrink: 0; font-size: 11px; }
      .file-ref-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      /* Cards */
      .card {
        background: var(--card-bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 8px 10px;
        margin-bottom: 10px;
      }
      .card-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        margin-bottom: 6px;
      }
      .card-head h3 {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        color: var(--muted);
        font-weight: 700;
      }
      .card-sub { font-size: 10px; color: var(--muted); font-variant-numeric: tabular-nums; }

      /* Code block */
      .code-block {
        background: var(--code-bg);
        border-radius: 4px;
        padding: 6px 0;
        overflow-x: auto;
        font-family: var(--mono);
        font-size: 12px;
        line-height: 1.55;
      }
      .code-line { display: flex; align-items: baseline; padding: 0 8px; min-height: 19px; }
      .code-line.hl-executed { background: rgba(33,150,243,0.12); box-shadow: inset 3px 0 0 var(--blue); }
      .code-line.hl-branched { background: rgba(255,152,0,0.12); box-shadow: inset 3px 0 0 var(--yellow); }
      .code-line.hl-assigned { background: rgba(121,85,72,0.15); box-shadow: inset 3px 0 0 #795548; }
      .code-line.hl-called   { background: rgba(33,150,243,0.18); box-shadow: inset 3px 0 0 #42a5f5; }
      .code-line.hl-returned { background: rgba(96,125,139,0.12); box-shadow: inset 3px 0 0 #607d8b; }
      .code-line.hl-skipped  { background: rgba(244,67,54,0.08); box-shadow: inset 3px 0 0 var(--red); opacity: 0.55; }
      .code-line.code-focus  { background: rgba(86,156,214,0.22); box-shadow: inset 3px 0 0 var(--blue); }
      .line-num {
        color: var(--muted);
        min-width: 32px;
        text-align: right;
        margin-right: 12px;
        user-select: none;
        flex-shrink: 0;
        font-size: 10px;
        opacity: 0.7;
      }
      .line-code { white-space: pre; flex: 1; }
      .line-annotation {
        font-size: 10px;
        color: var(--muted);
        margin-left: 14px;
        font-style: italic;
        white-space: nowrap;
        flex-shrink: 0;
      }

      /* Narrative */
      .narrative-card { border-left: 3px solid var(--blue); }
      .narrative {
        font-size: 12.5px;
        line-height: 1.6;
        white-space: pre-wrap;
        word-wrap: break-word;
      }
      .narrative-muted { color: var(--muted); font-size: 11.5px; margin-top: 6px; }
      .full-narrative { margin: -4px 0 10px; }
      .full-narrative summary {
        cursor: pointer;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--muted);
        padding: 4px 2px;
      }
      .full-narrative summary:hover { color: var(--link); }

      /* Branch options */
      .branch-section { border-left: 3px solid var(--purple); }
      .branch-section h3 { color: var(--purple); }
      .branch-options { display: flex; flex-direction: column; gap: 8px; }
      .branch-option {
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 8px 10px;
        background: var(--bg);
        transition: border-color 0.15s, background 0.15s;
      }
      .branch-option:hover { border-color: var(--link); background: var(--hover-bg); }
      .branch-hint-taken { border-left: 3px solid var(--green); }
      .branch-hint-skipped { border-left: 3px solid var(--red); opacity: 0.85; }
      .branch-hint-error { border-left: 3px solid var(--yellow); }
      .branch-hint-default { border-left: 3px solid var(--blue); }
      .branch-option-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--btn-bg);
        color: var(--btn-fg);
        border: none;
        padding: 5px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-family: var(--font);
        font-weight: 600;
        width: 100%;
        text-align: left;
      }
      .branch-option-btn:hover { background: var(--btn-hover); }
      .branch-option-icon { font-size: 13px; flex-shrink: 0; }
      .branch-option-label { flex: 1; }
      .branch-option-go { opacity: 0.7; }
      .branch-option-desc { font-size: 11px; color: var(--muted); margin-top: 5px; line-height: 1.45; }
      .branch-condition {
        font-family: var(--mono);
        font-size: 10px;
        color: var(--muted);
        margin-top: 5px;
        padding: 2px 6px;
        background: var(--code-bg);
        border-radius: 3px;
        display: inline-block;
      }

      /* Variables */
      .scope-group { margin-bottom: 8px; }
      .scope-group:last-child { margin-bottom: 0; }
      .scope-name {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        color: var(--muted);
        margin-bottom: 4px;
        font-weight: 700;
      }
      .var-row {
        display: flex;
        align-items: baseline;
        gap: 6px;
        padding: 2px 6px;
        font-family: var(--mono);
        font-size: 11px;
        border-radius: 3px;
        flex-wrap: wrap;
      }
      .var-row.var-changed { background: rgba(255,152,0,0.1); box-shadow: inset 2px 0 0 var(--yellow); }
      .var-action { font-size: 10px; width: 14px; flex-shrink: 0; text-align: center; }
      .var-created { color: var(--green); font-weight: 700; }
      .var-modified { color: var(--yellow); }
      .var-read { color: var(--muted); }
      .var-name { color: var(--link); font-weight: 600; flex-shrink: 0; }
      .var-type {
        font-size: 9px;
        color: var(--muted);
        background: rgba(128,128,128,0.14);
        padding: 0 4px;
        border-radius: 3px;
      }
      .var-value { color: var(--fg); word-break: break-all; flex: 1; min-width: 0; }
      .changes-summary {
        margin-top: 8px;
        padding: 6px 8px;
        background: rgba(255,152,0,0.06);
        border-radius: 4px;
        border: 1px solid rgba(255,152,0,0.2);
      }
      .changes-label {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        color: var(--muted);
        margin-bottom: 3px;
        font-weight: 700;
      }
      .change-item { font-family: var(--mono); font-size: 11px; color: var(--fg); padding: 1px 0; }

      /* Call stack */
      .stack-frames { display: flex; flex-direction: column; gap: 1px; }
      .stack-frame {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 6px;
        font-size: 11px;
        border-radius: 3px;
        box-shadow: inset 3px 0 0 transparent;
      }
      .stack-frame-current { box-shadow: inset 3px 0 0 var(--blue); background: var(--active-bg); font-weight: 600; }
      .stack-frame-clickable { cursor: pointer; transition: background 0.1s; }
      .stack-frame-clickable:hover { background: var(--hover-bg); }
      .stack-depth { font-family: var(--mono); font-size: 10px; color: var(--muted); min-width: 18px; }
      .stack-name {
        font-family: var(--mono);
        font-size: 11px;
        color: var(--link);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .stack-loc { font-size: 10px; color: var(--muted); margin-left: auto; white-space: nowrap; }

      /* Cell list */
      .cells-card { padding-bottom: 4px; }
      .cell-list { max-height: 220px; overflow-y: auto; margin: 0 -4px; }
      .cell-item {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 3px 6px;
        cursor: pointer;
        font-size: 11px;
        border-radius: 4px;
        box-shadow: inset 2px 0 0 transparent;
      }
      .cell-item:hover { background: var(--hover-bg); }
      .cell-item.cell-active { background: var(--active-bg); font-weight: 600; box-shadow: inset 2px 0 0 var(--blue); }
      .cell-item.cell-visited .cell-num { color: var(--green); }
      .cell-num {
        font-family: var(--mono);
        font-size: 9px;
        color: var(--muted);
        min-width: 16px;
        text-align: right;
        flex-shrink: 0;
        font-variant-numeric: tabular-nums;
      }
      .cell-indent { white-space: pre; font-family: var(--mono); }
      .cell-icon { width: 14px; text-align: center; font-size: 10px; color: var(--muted); flex-shrink: 0; }
      .type-icon-entry { color: var(--blue); }
      .type-icon-branch { color: var(--yellow); }
      .type-icon-return { color: #607d8b; }
      .type-icon-dispatch { color: var(--purple); }
      .cell-label {
        font-family: var(--mono);
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        min-width: 0;
      }
      .cell-branch-icon { color: var(--purple); font-size: 10px; margin-left: 2px; flex-shrink: 0; }
      .cell-status-dot { width: 6px; height: 6px; border-radius: 50%; margin-left: 4px; flex-shrink: 0; }
      .status-dot-skeleton { background: var(--muted); }
      .status-dot-partial { background: var(--yellow); }
      .status-dot-complete { background: var(--green); }
      .status-dot-corrected { background: #e91e63; }

      /* Steps bar */
      .steps-bar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        background: var(--code-bg);
        border-radius: 6px;
        margin-bottom: 10px;
      }
      .step-btn {
        background: var(--btn-sec-bg);
        color: var(--btn-sec-fg);
        border: none;
        padding: 2px 8px;
        border-radius: 3px;
        cursor: pointer;
        font-size: 10px;
      }
      .step-btn:hover:not(:disabled) { filter: brightness(1.15); }
      .step-btn:disabled { opacity: 0.3; cursor: default; }
      .step-counter { font-size: 11px; font-weight: 600; min-width: 60px; text-align: center; }
      .step-dots { display: flex; gap: 5px; align-items: center; margin-left: auto; }
      .step-dot, .step-dot-active, .step-dot-visited {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .step-dot { background: var(--muted); opacity: 0.3; }
      .step-dot-visited { background: var(--green); opacity: 0.7; }
      .step-dot-active { background: var(--blue); opacity: 1; transform: scale(1.35); }
    `;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Shorten a long path for display, keeping the last few segments. */
function shortenPath(filePath: string, maxSegments = 3): string {
  const parts = filePath.split('/').filter(Boolean);
  if (parts.length <= maxSegments) return filePath;
  return '\u2026/' + parts.slice(-maxSegments).join('/');
}
