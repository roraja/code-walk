/** Call-stack section — frames are clickable to jump to source. */
import type { CellVM } from '../../codewalk-view-model.js';
import { post } from '../vscode-api.js';
import { Card } from './primitives.js';

export function CallStack(props: { cell: CellVM }) {
  const { cell } = props;
  const frames = cell.callStack ?? [];
  if (frames.length === 0) return null;

  return (
    <Card title="Call stack">
      {frames.map((frame, i) => (
        <div
          key={i}
          className={`cw-frame ${frame.isTop ? 'top' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() =>
            post({ type: 'openFrame', filePath: frame.filePath, line: frame.line, functionName: frame.functionName })
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              post({ type: 'openFrame', filePath: frame.filePath, line: frame.line, functionName: frame.functionName });
            }
          }}
        >
          <span className="cw-frame-depth">#{frame.depth}</span>
          <span className="cw-frame-name">{frame.functionName}</span>
          <span className="cw-frame-loc">
            {frame.fileName}:{frame.line}
          </span>
        </div>
      ))}
    </Card>
  );
}
