/**
 * Code Walk — VS Code Extension entry point.
 *
 * A minimal, standalone extension for browsing code walks (notebook-style
 * execution walkthroughs) stored as `.codewalk.json` files on disk. It reads
 * walks directly from the filesystem — no database, AI provider, or server
 * required at runtime. AI agents author the walks via the bundled skills.
 *
 * Provides:
 *   - A "Code Walk" sidebar panel rendering cells with code, narrative,
 *     variable state, and call stacks.
 *   - Editor decorations that highlight the current cell's lines.
 *   - An "Install AI Skills" command to set up the Claude / Copilot skills.
 *
 * @module extension
 */

import * as vscode from 'vscode';
import { initLogger, log, logEntry, logExit, logError, disposeLogger, showOutputChannel } from './logger.js';
import { CodeWalkFileReader } from './codewalk-file-reader.js';
import { CodeWalkCellsViewProvider } from './codewalk-cells-view.js';
import { openCellInEditor } from './codewalk-decorations.js';
import { registerInstallSkillsCommand } from './skills-installer.js';
import type { CodeWalk } from './codewalk-types.js';

export function activate(context: vscode.ExtensionContext): void {
  logEntry('activate', { extensionVersion: context.extension.packageJSON?.version });

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    initLogger(workspaceRoot);
  }

  log('info', 'Code Walk activating', {
    workspaceRoot,
    extensionVersion: context.extension.packageJSON.version,
  });

  const reader = workspaceRoot ? new CodeWalkFileReader(workspaceRoot) : undefined;
  const cellsView = new CodeWalkCellsViewProvider();

  // Open-walk flow shared by the empty-state button and the open command.
  const openWalkFlow = async (): Promise<void> => {
    if (!reader) {
      vscode.window.showWarningMessage('Code Walk: Open a folder to load code walks.');
      return;
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Loading code walks...' },
      async () => {
        const walks = reader.listCodeWalks();
        if (walks.length === 0) {
          vscode.window.showWarningMessage(
            'Code Walk: No code walks found in .vscode/code-graph/codewalks/. ' +
              'Create one with the codegraph-codewalk-populate skill.',
          );
          return;
        }

        let walk: CodeWalk | null = walks.length === 1 ? walks[0] : null;
        if (!walk) {
          const picked = await vscode.window.showQuickPick(
            walks.map((w) => ({
              label: w.name,
              description: `${w.cells.length} cells`,
              detail: w.description,
              walkId: w.id,
            })),
            { placeHolder: 'Select a code walk' },
          );
          if (!picked) return;
          walk = reader.getCodeWalk(picked.walkId);
        }

        if (!walk) {
          vscode.window.showWarningMessage('Code Walk: Code walk not found.');
          return;
        }

        cellsView.loadWalk(walk);
        await vscode.commands.executeCommand('codewalk.cells.focus');
        const firstCell = cellsView.getCurrentCell();
        if (firstCell && shouldAutoOpen()) {
          await openCellInEditor(firstCell, workspaceRoot, walk);
        }
      },
    );
  };

  cellsView.onRequestOpen = () => {
    void openWalkFlow();
  };

  // Register the webview panel.
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CodeWalkCellsViewProvider.viewType, cellsView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Sync cell changes to the editor (highlight + reveal).
  context.subscriptions.push(
    cellsView.onCellChanged((data) => {
      if (data && shouldAutoOpen()) {
        void openCellInEditor(data.cell, workspaceRoot, data.walk, data.step);
      }
    }),
  );

  // --- Commands ---

  context.subscriptions.push(
    vscode.commands.registerCommand('codewalk.open', async () => {
      logEntry('cmd:open');
      try {
        await openWalkFlow();
      } catch (err) {
        logError('cmd:open', err);
      }
      logExit('cmd:open');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('codewalk.openById', async (walkOrId?: CodeWalk | string) => {
      logEntry('cmd:openById');
      try {
        if (!reader) {
          await openWalkFlow();
          return;
        }
        let walk: CodeWalk | null = null;
        if (typeof walkOrId === 'string') {
          walk = reader.getCodeWalk(walkOrId);
        } else if (walkOrId && typeof walkOrId === 'object' && 'cells' in walkOrId) {
          walk = walkOrId;
        }
        if (!walk) {
          await openWalkFlow();
          return;
        }
        cellsView.loadWalk(walk);
        await vscode.commands.executeCommand('codewalk.cells.focus');
        const firstCell = cellsView.getCurrentCell();
        if (firstCell && shouldAutoOpen()) {
          await openCellInEditor(firstCell, workspaceRoot, walk);
        }
      } catch (err) {
        logError('cmd:openById', err);
      }
      logExit('cmd:openById');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('codewalk.refresh', async () => {
      logEntry('cmd:refresh');
      const current = cellsView.getWalk();
      if (current && reader) {
        const fresh = reader.getCodeWalk(current.id);
        if (fresh) {
          cellsView.loadWalk(fresh);
          vscode.window.showInformationMessage(`Code Walk: Reloaded "${fresh.name}".`);
        }
      } else {
        await openWalkFlow();
      }
      logExit('cmd:refresh');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('codewalk.nextCell', () => {
      logEntry('cmd:nextCell');
      try {
        cellsView.nextCell();
      } catch (err) {
        logError('cmd:nextCell', err);
      }
      logExit('cmd:nextCell');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('codewalk.prevCell', () => {
      logEntry('cmd:prevCell');
      try {
        cellsView.prevCell();
      } catch (err) {
        logError('cmd:prevCell', err);
      }
      logExit('cmd:prevCell');
    }),
  );

  // Navigate to a call-stack frame / file location in the editor.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'codewalk.openFrame',
      async (frame: { functionName?: string; filePath: string; line: number }) => {
        logEntry('cmd:openFrame', { filePath: frame?.filePath, line: frame?.line });
        try {
          if (!frame || !frame.filePath) return;
          let filePath = frame.filePath;
          if (!filePath.startsWith('/') && workspaceRoot) {
            const path = await import('node:path');
            filePath = path.join(workspaceRoot, filePath);
          }
          const uri = vscode.Uri.file(filePath);
          const line = Math.max(0, (frame.line ?? 1) - 1);
          await vscode.window.showTextDocument(uri, {
            selection: new vscode.Range(line, 0, line, 0),
            preview: false,
          });
        } catch (err) {
          logError('cmd:openFrame', err);
          const message = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Code Walk: Could not open file — ${message}`);
        }
        logExit('cmd:openFrame');
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('codewalk.showOutput', () => {
      showOutputChannel();
    }),
  );

  context.subscriptions.push(registerInstallSkillsCommand(context));

  log('info', 'Code Walk activated');
  logExit('activate');
}

export function deactivate(): void {
  logEntry('deactivate');
  log('info', 'Code Walk deactivated');
  logExit('deactivate');
  disposeLogger();
}

/** Whether the codewalk.autoOpenCell setting is enabled (default true). */
function shouldAutoOpen(): boolean {
  return vscode.workspace.getConfiguration('codewalk').get<boolean>('autoOpenCell', true);
}
