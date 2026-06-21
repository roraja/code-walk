/**
 * Webview entry point. Mounts the React app and bridges the VS Code message
 * channel: it listens for `render` messages from the extension and re-renders
 * the app with the new view model, and signals `ready` once mounted so the
 * extension knows to send the initial state.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ExtensionToWebviewMessage, WalkViewModel } from '../codewalk-view-model.js';
import { App } from './App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { post } from './vscode-api.js';
import './styles.css';

function Root() {
  const [model, setModel] = useState<WalkViewModel | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const message = event.data;
      if (message && message.type === 'render') {
        setModel(message.model);
      }
    };
    window.addEventListener('message', onMessage);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <ErrorBoundary>
      <App model={model} />
    </ErrorBoundary>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}
