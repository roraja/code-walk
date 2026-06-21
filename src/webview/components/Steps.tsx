/** Sub-step navigator (dots + prev/next) shown when a cell has steps. */
import type { CellVM } from '../../codewalk-view-model.js';
import { post } from '../vscode-api.js';
import { IconButton } from './primitives.js';

export function Steps(props: { cell: CellVM }) {
  const { cell } = props;
  if (!cell.hasSteps) return null;

  return (
    <div className="cw-steps">
      <IconButton label="Previous step" disabled={cell.stepIndex === 0} onClick={() => post({ type: 'prevStep' })}>
        ‹
      </IconButton>
      <span className="cw-steps-label">
        Step {cell.stepIndex + 1} / {cell.stepsTotal}
      </span>
      <IconButton
        label="Next step"
        disabled={cell.stepIndex >= cell.stepsTotal - 1}
        onClick={() => post({ type: 'nextStep' })}
      >
        ›
      </IconButton>
      <div className="cw-steps-dots">
        {Array.from({ length: cell.stepsTotal }).map((_, i) => {
          const state = i === cell.stepIndex ? 'active' : i < cell.stepIndex ? 'visited' : '';
          return (
            <button
              key={i}
              type="button"
              className={`cw-step-dot ${state}`}
              aria-label={`Go to step ${i + 1}`}
              title={`Step ${i + 1}`}
              onClick={() => post({ type: 'goToStep', stepIndex: i })}
            />
          );
        })}
      </div>
    </div>
  );
}
