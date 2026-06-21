/** Root component — renders one frame of the walk from the current view model. */
import { useEffect } from 'react';
import type { WalkViewModel } from '../codewalk-view-model.js';
import { post } from './vscode-api.js';
import { EmptyState } from './components/EmptyState.js';
import { Header } from './components/Header.js';
import { Explanation } from './components/Explanation.js';
import { Steps } from './components/Steps.js';
import { BranchOptions } from './components/BranchOptions.js';
import { Variables } from './components/Variables.js';
import { CallStack } from './components/CallStack.js';
import { CellList } from './components/CellList.js';
import { Badge } from './components/primitives.js';

export function App(props: { model: WalkViewModel | null }) {
  const { model } = props;

  // Keyboard navigation: arrows / j / k step through the walk.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      if (e.key === 'ArrowDown' || e.key === 'j') {
        post({ type: 'nextCell' });
        e.preventDefault();
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        post({ type: 'prevCell' });
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (!model || !model.walk || !model.cell) {
    return (
      <div className="cw-app">
        <EmptyState />
      </div>
    );
  }

  const { cell } = model;

  return (
    <div className="cw-app">
      <Header model={model} />

      <main className="cw-content">
        <div className="cw-badges">
          <Badge variant="accent">{cell.typeLabel}</Badge>
          {cell.hasBranching && <Badge variant="branch">Branch</Badge>}
          <Badge>
            <span className={`cw-badge-dot status-${cell.status}`} />
            {cell.status}
          </Badge>
          {cell.confidencePct && (
            <Badge className={`cw-conf-${cell.confidenceLevel}`}>{cell.confidencePct}</Badge>
          )}
          <span className="cw-spacer" />
          <span className="cw-depth" title="Call-stack depth">
            depth {cell.stackDepth}
          </span>
        </div>

        <button
          type="button"
          className="cw-fileref"
          title="Open this code in the editor"
          onClick={() =>
            post({ type: 'openFrame', filePath: cell.filePath, line: cell.startLine, functionName: '' })
          }
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M14 3v5h5M7 3h8l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" strokeLinejoin="round" />
          </svg>
          <span className="cw-fileref-path">
            {cell.fileLabel}:{cell.startLine}-{cell.endLine}
          </span>
          <span className="cw-fileref-go" aria-hidden="true">
            ↗
          </span>
        </button>

        <Steps cell={cell} />
        <Explanation cell={cell} />
        <BranchOptions cell={cell} />
        <Variables cell={cell} />
        <CallStack cell={cell} />
        <CellList model={model} />
      </main>
    </div>
  );
}
