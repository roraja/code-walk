/** Error boundary so a single render error never blanks the whole sidebar. */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the webview devtools console for diagnosis.
    console.error('Code Walk webview error:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="cw-empty">
          <div className="cw-empty-title">Something went wrong</div>
          <p className="cw-empty-hint">
            The Code Walk view hit an unexpected error while rendering. Try the refresh button, or reopen the walk.
          </p>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontSize: '11px',
              opacity: 0.7,
              maxWidth: '280px',
              textAlign: 'left',
            }}
          >
            {this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
