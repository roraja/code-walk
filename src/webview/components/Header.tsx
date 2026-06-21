/** Sticky header: walk name, prev/next navigation, progress bar, breadcrumb. */
import type { WalkViewModel } from '../../codewalk-view-model.js';
import { post } from '../vscode-api.js';
import { IconButton } from './primitives.js';

export function Header(props: { model: WalkViewModel }) {
  const { model } = props;
  return (
    <header className="cw-header">
      <div className="cw-header-row">
        <span className="cw-walk-name" title={model.walk?.description || model.walk?.name}>
          {model.walk?.name}
        </span>
        <div className="cw-nav">
          <IconButton label="Previous step" disabled={!model.canGoBack} onClick={() => post({ type: 'prevCell' })}>
            <Chevron dir="up" />
          </IconButton>
          <span className="cw-counter">
            <b>{model.activeIndex + 1}</b> / {model.totalCells}
          </span>
          <IconButton
            label="Next step"
            primary
            disabled={model.isEndCell}
            onClick={() => post({ type: 'nextCell' })}
          >
            <Chevron dir="down" />
          </IconButton>
        </div>
      </div>

      <div className="cw-progress">
        <div className="cw-progress-fill" style={{ width: `${model.progressPct}%` }} />
      </div>

      {(model.breadcrumb?.length ?? 0) > 1 && (
        <nav className="cw-breadcrumb" aria-label="Path">
          {model.breadcrumb.map((crumb, i) => {
            const isLast = i === model.breadcrumb.length - 1;
            return (
              <span key={i} className={isLast ? 'cw-breadcrumb-current' : undefined}>
                {crumb}
                {!isLast && <span className="cw-breadcrumb-sep"> › </span>}
              </span>
            );
          })}
        </nav>
      )}
    </header>
  );
}

function Chevron(props: { dir: 'up' | 'down' }) {
  const d = props.dir === 'up' ? 'M6 14l6-6 6 6' : 'M6 10l6 6 6-6';
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
