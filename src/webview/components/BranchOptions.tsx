/** Branch path chooser shown when a cell forks into multiple next cells. */
import type { CellVM } from '../../codewalk-view-model.js';
import { post } from '../vscode-api.js';
import { Card } from './primitives.js';

const HINT_ICON: Record<string, string> = {
  taken: '✓',
  skipped: '✕',
  error: '⚠',
  default: '➜',
};

export function BranchOptions(props: { cell: CellVM }) {
  const { cell } = props;
  if (!cell.hasBranching) return null;
  const options = cell.branchOptions ?? [];

  return (
    <Card title="Choose a path" className="cw-branch-card">
      <div className="cw-branch-list">
        {options.map((opt) => (
          <button
            key={opt.index}
            type="button"
            className={`cw-branch ${opt.hint}`}
            onClick={() => post({ type: 'selectBranch', branchIndex: opt.index })}
          >
            <div className="cw-branch-head">
              <span aria-hidden="true">{HINT_ICON[opt.hint] ?? HINT_ICON.default}</span>
              <span>{opt.label}</span>
              <span className="cw-branch-go" aria-hidden="true">
                →
              </span>
            </div>
            {opt.description && <div className="cw-branch-desc">{opt.description}</div>}
            {opt.condition && <code className="cw-branch-cond">{opt.condition}</code>}
          </button>
        ))}
      </div>
    </Card>
  );
}
