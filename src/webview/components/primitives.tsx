/** Small shadcn-inspired presentational primitives. */
import type { ReactNode } from 'react';

export function Card(props: { title?: string; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`cw-card ${props.className ?? ''}`}>
      {(props.title || props.aside) && (
        <div className="cw-card-header">
          {props.title && <h3 className="cw-card-title">{props.title}</h3>}
          {props.aside}
        </div>
      )}
      <div className="cw-card-body">{props.children}</div>
    </section>
  );
}

export function Badge(props: { children: ReactNode; variant?: 'default' | 'accent' | 'branch'; className?: string }) {
  const variant = props.variant ?? 'default';
  const cls = variant === 'accent' ? 'cw-badge-accent' : variant === 'branch' ? 'cw-badge-branch' : '';
  return <span className={`cw-badge ${cls} ${props.className ?? ''}`}>{props.children}</span>;
}

export function IconButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`cw-icon-btn ${props.primary ? 'cw-icon-btn-primary' : ''}`}
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
