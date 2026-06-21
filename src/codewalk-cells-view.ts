/**
 * Code Walk Cells Webview — hosts the React sidebar UI.
 *
 * The provider owns all navigation logic (history stack, branch resolution,
 * sub-step indices, cell ↔ index maps). On every state change it builds a
 * serializable {@link WalkViewModel} and posts it to the React app, which is a
 * pure presentation layer (see `src/webview/`).
 *
 * The sidebar intentionally renders the **explanation** of each step as clear
 * prose — it never prints raw source code. The corresponding code is instead
 * highlighted in the editor via {@link openCellInEditor}.
 *
 * @module codewalk-cells-view
 */

import * as vscode from 'vscode';
import { log, logEntry, logExit } from './logger.js';
import type { CodeWalk, WalkCell, CellStep, BranchOption } from './codewalk-types.js';
import type {
  WalkViewModel,
  CellVM,
  CellListItemVM,
  ScopeVM,
  StackFrameVM,
  BranchOptionVM,
  WebviewToExtensionMessage,
} from './codewalk-view-model.js';

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

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    logEntry('CodeWalkCellsViewProvider.resolveWebviewView');
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    };

    webviewView.webview.html = this.getShellHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      switch (message.type) {
        case 'ready':
          this.render();
          break;
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
          const { filePath, line } = message;
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

  /** Push the latest view model to the React app. */
  private render(): void {
    if (!this.view) return;
    void this.view.webview.postMessage({ type: 'render', model: this.buildViewModel() });
  }

  // -------------------------------------------------------------------------
  // Private: view-model construction
  // -------------------------------------------------------------------------

  private buildViewModel(): WalkViewModel {
    const walk = this.currentWalk;
    if (!walk || walk.cells.length === 0) {
      return {
        walk: null,
        cell: null,
        activeIndex: 0,
        totalCells: 0,
        progressPct: 0,
        canGoBack: false,
        isEndCell: true,
        breadcrumb: [],
        cells: [],
      };
    }

    const activeIndex = this.currentCellIndex;
    const cell = walk.cells[activeIndex];
    const totalCells = walk.cells.length;

    return {
      walk: { name: walk.name, description: walk.description },
      cell: this.buildCellVM(cell),
      activeIndex,
      totalCells,
      progressPct: Math.round(((activeIndex + 1) / totalCells) * 100),
      canGoBack: this.navigationHistory.length > 0,
      isEndCell: this.isEndCell(cell, walk),
      breadcrumb: this.buildBreadcrumb(walk),
      cells: this.buildCellList(walk, activeIndex),
    };
  }

  private buildCellVM(cell: WalkCell): CellVM {
    const hasSteps = !!(cell.steps && cell.steps.length > 0 && this.currentStepIndex >= 0);
    const hasBranching = !!(cell.nextCellIds && cell.nextCellIds.length > 1);

    let confidencePct: string | undefined;
    let confidenceLevel: CellVM['confidenceLevel'];
    if (cell.confidence !== undefined) {
      confidencePct = `${(cell.confidence * 100).toFixed(0)}%`;
      confidenceLevel = cell.confidence >= 0.8 ? 'high' : cell.confidence >= 0.5 ? 'mid' : 'low';
    }

    return {
      type: cell.type,
      typeLabel: this.formatCellType(cell.type),
      status: cell.status,
      confidencePct,
      confidenceLevel,
      stackDepth: cell.stackDepth,
      narrative: cell.narrative,
      filePath: cell.code.filePath,
      fileLabel: shortenPath(cell.code.filePath),
      startLine: cell.code.startLine,
      endLine: cell.code.endLine,
      hasSteps,
      stepIndex: hasSteps ? this.currentStepIndex : 0,
      stepsTotal: cell.steps?.length ?? 0,
      stepDescription: hasSteps ? cell.steps![this.currentStepIndex].description : undefined,
      hasBranching,
      branchOptions: hasBranching ? this.buildBranchOptions(cell) : [],
      scopes: this.buildScopes(cell),
      changes: cell.state?.changes ?? [],
      callStack: this.buildCallStack(cell),
    };
  }

  private buildBranchOptions(cell: WalkCell): BranchOptionVM[] {
    if (!cell.nextCellIds) return [];
    return cell.nextCellIds.map((nextId, i) => {
      const option: BranchOption | undefined = cell.branchOptions?.[i];
      return {
        index: i,
        label: option?.label ?? `Path ${i + 1}`,
        description: option?.description ?? `Go to ${nextId}`,
        condition: option?.condition,
        hint: option?.pathHint ?? 'default',
      };
    });
  }

  private buildScopes(cell: WalkCell): ScopeVM[] {
    if (!cell.state?.scopes) return [];
    return cell.state.scopes.map((scope) => ({
      name: scope.name,
      vars: Object.entries(scope.variables).map(([name, v]) => ({
        name,
        value: v.value,
        type: v.type,
        changed: v.changed,
        action: v.action,
        rationale: v.rationale,
      })),
    }));
  }

  private buildCallStack(cell: WalkCell): StackFrameVM[] {
    if (!cell.callStack || cell.callStack.length === 0) return [];
    return cell.callStack
      .slice()
      .reverse()
      .map((frame, idx) => ({
        depth: frame.depth,
        functionName: frame.functionName,
        filePath: frame.filePath,
        line: frame.line,
        fileName: frame.filePath.split('/').pop() ?? frame.filePath,
        isTop: idx === 0,
      }));
  }

  private buildBreadcrumb(walk: CodeWalk): string[] {
    if (this.navigationHistory.length === 0) return [];
    const pathIndices = [...this.navigationHistory.slice(-5), this.currentCellIndex];
    const crumbs = pathIndices
      .map((idx) => {
        const c = walk.cells[idx];
        return c ? this.getCellLabel(c) : '';
      })
      .filter(Boolean);
    if (this.navigationHistory.length > 5 && crumbs.length > 0) {
      crumbs[0] = `… ${crumbs[0]}`;
    }
    return crumbs;
  }

  private buildCellList(walk: CodeWalk, activeIndex: number): CellListItemVM[] {
    return walk.cells.map((cell, idx) => ({
      index: idx,
      label: this.getCellLabel(cell),
      type: cell.type,
      status: cell.status,
      stackDepth: cell.stackDepth,
      isActive: idx === activeIndex,
      isVisited: this.navigationHistory.includes(idx),
      hasBranch: !!(cell.nextCellIds && cell.nextCellIds.length > 1),
    }));
  }

  private isEndCell(cell: WalkCell, walk: CodeWalk): boolean {
    if (cell.nextCellIds) {
      return cell.nextCellIds.length === 0;
    }
    return cell.index >= walk.cells.length - 1;
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

  // -------------------------------------------------------------------------
  // Private: shell HTML that boots the React bundle
  // -------------------------------------------------------------------------

  private getShellHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.css'));
    const nonce = getNonce();
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
    ].join('; ');

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>Code Walk</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">
    (function () {
      function showError(msg) {
        var root = document.getElementById('root');
        if (root && !root.firstChild) {
          root.innerHTML =
            '<div style="padding:24px;font-family:var(--vscode-font-family,sans-serif);color:var(--vscode-foreground);line-height:1.5">' +
            '<strong>Code Walk could not start</strong>' +
            '<p style="font-size:12px;opacity:.8">Try reloading the window (Developer: Reload Window). If it persists, reinstall the extension.</p>' +
            '<pre style="white-space:pre-wrap;font-size:11px;opacity:.7">' + String(msg) + '</pre></div>';
        }
      }
      window.addEventListener('error', function (e) {
        showError(e && e.message ? e.message : 'Unknown script error');
      });
      // If the bundle never mounted anything, surface a hint instead of a blank panel.
      setTimeout(function () { showError('The view did not initialize (webview.js may have failed to load).'); }, 4000);
    })();
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorten a long path for display, keeping the last few segments. */
function shortenPath(filePath: string, maxSegments = 3): string {
  const parts = filePath.split('/').filter(Boolean);
  if (parts.length <= maxSegments) return filePath;
  return '\u2026/' + parts.slice(-maxSegments).join('/');
}

/** Generate a random nonce for the Content-Security-Policy. */
function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
