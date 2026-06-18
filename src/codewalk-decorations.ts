/**
 * Code Walk Decorations — highlights the current cell's lines in the editor.
 *
 * When navigating cells in a code walk, this module opens the relevant
 * file and highlights the lines that the current cell refers to. Different
 * highlight types (executed, branched, assigned, called, returned, skipped)
 * get distinct visual styles.
 *
 * @module codewalk-decorations
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { log, logEntry, logExit, logError } from './logger.js';
import type { WalkCell, CodeWalk, LineHighlight, CellStep } from './codewalk-types.js';

// ---------------------------------------------------------------------------
// Decoration types — one per highlight type
// ---------------------------------------------------------------------------

/** Primary highlight: the cell's entire code range */
const cellRangeDecorationType = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(33, 150, 243, 0.06)',
  isWholeLine: true,
  overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.findMatchForeground'),
  overviewRulerLane: vscode.OverviewRulerLane.Center,
});

/** Executed line highlight */
const executedLineDecorationType = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(33, 150, 243, 0.15)',
  isWholeLine: true,
  borderWidth: '0 0 0 3px',
  borderStyle: 'solid',
  borderColor: new vscode.ThemeColor('charts.blue'),
  after: {
    margin: '0 0 0 1em',
    color: new vscode.ThemeColor('editorCodeLens.foreground'),
  },
});

/** Branched line highlight */
const branchedLineDecorationType = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(255, 152, 0, 0.15)',
  isWholeLine: true,
  borderWidth: '0 0 0 3px',
  borderStyle: 'solid',
  borderColor: new vscode.ThemeColor('charts.yellow'),
  after: {
    margin: '0 0 0 1em',
    color: new vscode.ThemeColor('editorCodeLens.foreground'),
  },
});

/** Assigned line highlight */
const assignedLineDecorationType = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(121, 85, 72, 0.12)',
  isWholeLine: true,
  borderWidth: '0 0 0 3px',
  borderStyle: 'solid',
  borderColor: '#795548',
  after: {
    margin: '0 0 0 1em',
    color: new vscode.ThemeColor('editorCodeLens.foreground'),
  },
});

/** Called line highlight */
const calledLineDecorationType = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(33, 150, 243, 0.2)',
  isWholeLine: true,
  borderWidth: '0 0 0 3px',
  borderStyle: 'solid',
  borderColor: '#42a5f5',
  after: {
    margin: '0 0 0 1em',
    color: new vscode.ThemeColor('editorCodeLens.foreground'),
  },
});

/** Returned line highlight */
const returnedLineDecorationType = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(96, 125, 139, 0.12)',
  isWholeLine: true,
  borderWidth: '0 0 0 3px',
  borderStyle: 'solid',
  borderColor: '#607d8b',
  after: {
    margin: '0 0 0 1em',
    color: new vscode.ThemeColor('editorCodeLens.foreground'),
  },
});

/** Skipped line highlight */
const skippedLineDecorationType = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(244, 67, 54, 0.08)',
  isWholeLine: true,
  borderWidth: '0 0 0 3px',
  borderStyle: 'solid',
  borderColor: new vscode.ThemeColor('charts.red'),
  opacity: '0.6',
  after: {
    margin: '0 0 0 1em',
    color: new vscode.ThemeColor('editorCodeLens.foreground'),
  },
});

/** Other cells in the same file */
const otherCellDecorationType = vscode.window.createTextEditorDecorationType({
  overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.infoForeground'),
  overviewRulerLane: vscode.OverviewRulerLane.Left,
  before: {
    contentText: '',
    width: '3px',
    backgroundColor: 'rgba(128, 128, 128, 0.3)',
  },
});

/** Focused line within a sub-step — strong highlight */
const focusedLineDecorationType = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(86, 156, 214, 0.25)',
  isWholeLine: true,
  borderWidth: '0 0 0 3px',
  borderStyle: 'solid',
  borderColor: new vscode.ThemeColor('charts.blue'),
  overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.findMatchForeground'),
  overviewRulerLane: vscode.OverviewRulerLane.Center,
  after: {
    margin: '0 0 0 1em',
    color: new vscode.ThemeColor('editorCodeLens.foreground'),
  },
});

/** All decoration types for cleanup */
const allDecorationTypes = [
  cellRangeDecorationType,
  executedLineDecorationType,
  branchedLineDecorationType,
  assignedLineDecorationType,
  calledLineDecorationType,
  returnedLineDecorationType,
  skippedLineDecorationType,
  otherCellDecorationType,
  focusedLineDecorationType,
];

/**
 * Map highlight type to its decoration type.
 */
function getDecorationTypeForHighlight(type: LineHighlight['type']): vscode.TextEditorDecorationType {
  switch (type) {
    case 'executed': return executedLineDecorationType;
    case 'branched': return branchedLineDecorationType;
    case 'assigned': return assignedLineDecorationType;
    case 'called': return calledLineDecorationType;
    case 'returned': return returnedLineDecorationType;
    case 'skipped': return skippedLineDecorationType;
    default: return executedLineDecorationType;
  }
}

/**
 * Open a file in the editor and highlight the cell's lines.
 *
 * @param cell - The current walk cell to display
 * @param workspaceRoot - The workspace root path
 * @param walk - The full code walk (to highlight other cells in same file)
 * @param activeStep - The active sub-step (for focused line highlighting)
 */
export async function openCellInEditor(
  cell: WalkCell,
  workspaceRoot: string | undefined,
  walk?: CodeWalk,
  activeStep?: CellStep
): Promise<void> {
  logEntry('openCellInEditor', { cellId: cell.id, filePath: cell.code.filePath, hasStep: !!activeStep });

  const filePath = resolveFilePath(cell.code.filePath, workspaceRoot);
  if (!filePath) {
    log('warn', 'openCellInEditor: could not resolve file path', { filePath: cell.code.filePath });
    // Don't show error — the file likely doesn't exist locally (e.g. Chromium source)
    // Just log and return silently
    logExit('openCellInEditor', 'no file path');
    return;
  }

  try {
    const uri = vscode.Uri.file(filePath);

    // Center the view on the cell's start line
    const startLine = Math.max(0, cell.code.startLine - 1);
    const endLine = Math.max(0, cell.code.endLine - 1);

    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, {
      selection: new vscode.Range(startLine, 0, startLine, 0),
      preview: false,
    });

    // Clear all previous decorations
    for (const decType of allDecorationTypes) {
      editor.setDecorations(decType, []);
    }

    // 1. Apply the overall cell range highlight (subtle background)
    const rangeDecorations: vscode.DecorationOptions[] = [{
      range: new vscode.Range(startLine, 0, endLine, 999),
    }];
    editor.setDecorations(cellRangeDecorationType, rangeDecorations);

    // 2. Apply per-line highlights or sub-step focus
    if (activeStep) {
      // In sub-step mode: show focused line with strong highlight
      const focusStart = Math.max(0, activeStep.focusLine - 1);
      const focusEnd = Math.max(0, (activeStep.focusEndLine || activeStep.focusLine) - 1);
      const focusDecorations: vscode.DecorationOptions[] = [{
        range: new vscode.Range(focusStart, 0, focusEnd, 999),
      }];
      editor.setDecorations(focusedLineDecorationType, focusDecorations);

      // Reveal the focused line
      editor.revealRange(
        new vscode.Range(focusStart, 0, focusEnd, 0),
        vscode.TextEditorRevealType.InCenterIfOutsideViewport
      );
    } else if (cell.code.highlights && cell.code.highlights.length > 0) {
      // Group highlights by type
      const byType = new Map<string, vscode.DecorationOptions[]>();
      for (const hl of cell.code.highlights) {
        const line = Math.max(0, hl.line - 1);
        const decoration: vscode.DecorationOptions = {
          range: new vscode.Range(line, 0, line, 999),
          renderOptions: hl.annotation ? {
            after: {
              contentText: ` // ${hl.annotation}`,
            },
          } : undefined,
        };

        const existing = byType.get(hl.type) ?? [];
        existing.push(decoration);
        byType.set(hl.type, existing);
      }

      // Apply each group's decorations
      for (const [type, decorations] of byType) {
        const decType = getDecorationTypeForHighlight(type as LineHighlight['type']);
        editor.setDecorations(decType, decorations);
      }
    }

    // 3. Highlight other cells in the same file (subtle markers)
    if (walk) {
      const otherDecorations: vscode.DecorationOptions[] = walk.cells
        .filter(c => c.id !== cell.id && resolveFilePath(c.code.filePath, workspaceRoot) === filePath)
        .map(c => ({
          range: new vscode.Range(
            Math.max(0, c.code.startLine - 1), 0,
            Math.max(0, c.code.endLine - 1), 999
          ),
          hoverMessage: new vscode.MarkdownString(
            `**Cell ${c.index + 1}** — ${c.type}\n\n` +
            (c.narrative ? c.narrative.substring(0, 150) + '...' : '')
          ),
        }));
      editor.setDecorations(otherCellDecorationType, otherDecorations);
    }

    // Reveal the range to center it
    editor.revealRange(
      new vscode.Range(startLine, 0, endLine, 0),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );

    log('debug', 'openCellInEditor: decorations applied', {
      file: filePath,
      startLine: cell.code.startLine,
      endLine: cell.code.endLine,
      highlights: cell.code.highlights?.length ?? 0,
    });
    logExit('openCellInEditor');
  } catch (err) {
    // File might not exist locally (e.g. Chromium source paths) — that's OK
    logError('openCellInEditor', err);
  }
}

/**
 * Clear all codewalk decorations from the active editor.
 */
export function clearCodeWalkDecorations(editor: vscode.TextEditor): void {
  logEntry('clearCodeWalkDecorations');
  for (const decType of allDecorationTypes) {
    editor.setDecorations(decType, []);
  }
  logExit('clearCodeWalkDecorations');
}

/**
 * Resolve a file path — handle absolute paths, workspace-relative paths,
 * and gracefully handle non-existent files (common for Chromium source).
 */
function resolveFilePath(rawPath: string, workspaceRoot: string | undefined): string | null {
  if (!rawPath) return null;

  // If already absolute and exists concept
  if (rawPath.startsWith('/')) {
    return rawPath;
  }

  // Try workspace-relative
  if (workspaceRoot) {
    return path.join(workspaceRoot, rawPath);
  }

  return rawPath;
}
