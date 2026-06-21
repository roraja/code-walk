/** The mini cell list for jumping between steps. */
import { useEffect, useRef } from 'react';
import type { WalkViewModel } from '../../codewalk-view-model.js';
import { post } from '../vscode-api.js';
import { Card } from './primitives.js';

export function CellList(props: { model: WalkViewModel }) {
  const { model } = props;
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = activeRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [model.activeIndex]);

  const cells = model.cells ?? [];

  return (
    <Card title="Steps" aside={<span className="cw-card-title">{model.totalCells}</span>}>
      <div className="cw-cells">
        {cells.map((cell) => (
          <div
            key={cell.index}
            ref={cell.isActive ? activeRef : undefined}
            className={`cw-cell ${cell.isActive ? 'active' : ''} ${cell.isVisited ? 'visited' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => post({ type: 'navigateToCell', index: cell.index })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                post({ type: 'navigateToCell', index: cell.index });
              }
            }}
          >
            <span className="cw-cell-num">{cell.index + 1}</span>
            <span className="cw-cell-label" style={{ paddingLeft: `${Math.min(cell.stackDepth, 6) * 8}px` }}>
              {cell.label}
            </span>
            {cell.hasBranch && (
              <span className="cw-cell-branch" title="Branch point" aria-hidden="true">
                ★
              </span>
            )}
            <span className={`cw-cell-status status-${cell.status}`} title={cell.status} />
          </div>
        ))}
      </div>
    </Card>
  );
}
