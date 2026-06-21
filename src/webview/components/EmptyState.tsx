/** Empty state shown when no walk is loaded. */
import { post } from '../vscode-api.js';

export function EmptyState() {
  return (
    <div className="cw-empty">
      <div className="cw-empty-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 5h16M4 12h16M4 19h10" strokeLinecap="round" />
        </svg>
      </div>
      <div className="cw-empty-title">No code walk loaded</div>
      <p className="cw-empty-hint">
        Open a code walk to step through a traced execution path. Each step is explained in clear text here, while the
        matching code is highlighted in the editor.
      </p>
      <button type="button" className="cw-btn cw-btn-primary" onClick={() => post({ type: 'openWalk' })}>
        Open Code Walk
      </button>
    </div>
  );
}
