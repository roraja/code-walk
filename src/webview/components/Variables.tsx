/** Optional variable-state section (rendered below the explanation). */
import type { CellVM } from '../../codewalk-view-model.js';
import { Card } from './primitives.js';

const ACTION_MARK: Record<string, string> = {
  created: '+',
  modified: '✎',
  read: '·',
};

export function Variables(props: { cell: CellVM }) {
  const { cell } = props;
  const scopes = cell.scopes ?? [];
  const changes = cell.changes ?? [];
  const hasVars = scopes.some((s) => s.vars.length > 0);
  if (!hasVars && changes.length === 0) return null;

  return (
    <Card title="State">
      {scopes.map(
        (scope) =>
          scope.vars.length > 0 && (
            <div className="cw-scope" key={scope.name}>
              <div className="cw-scope-name">{scope.name}</div>
              {scope.vars.map((v) => (
                <div
                  className={`cw-var ${v.changed ? 'changed' : ''}`}
                  key={v.name}
                  title={v.rationale || undefined}
                >
                  <span aria-hidden="true">{v.action ? ACTION_MARK[v.action] ?? '' : ''}</span>
                  <span className="cw-var-name">{v.name}</span>
                  {v.type && <span className="cw-var-type">{v.type}</span>}
                  <span className="cw-var-value">{v.value}</span>
                </div>
              ))}
            </div>
          ),
      )}

      {changes.length > 0 && (
        <div className="cw-changes">
          <div className="cw-changes-label">Changes</div>
          {changes.map((c, i) => (
            <div className="cw-change" key={i}>
              {c}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
