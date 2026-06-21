/** The hero explanation block — the primary content of the sidebar. */
import type { CellVM } from '../../codewalk-view-model.js';

export function Explanation(props: { cell: CellVM }) {
  const { cell } = props;

  const eyebrow = cell.hasSteps ? `Step ${cell.stepIndex + 1} of ${cell.stepsTotal}` : 'Explanation';
  const text = cell.hasSteps ? cell.stepDescription : cell.narrative;

  return (
    <div className="cw-explain">
      <div className="cw-explain-eyebrow">{eyebrow}</div>
      {text ? (
        <p className="cw-explain-text">{text}</p>
      ) : (
        <p className="cw-explain-empty">No explanation has been written for this step yet.</p>
      )}

      {cell.hasSteps && cell.narrative && (
        <details className="cw-explain-full">
          <summary>Full explanation</summary>
          <p className="cw-explain-full-text">{cell.narrative}</p>
        </details>
      )}
    </div>
  );
}
