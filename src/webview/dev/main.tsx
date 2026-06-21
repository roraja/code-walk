/**
 * Dev-server entry point for previewing the Code Walk sidebar UI in a browser.
 *
 * It installs a fake `acquireVsCodeApi()` backed by {@link MockController}, then
 * mounts the **real** {@link App} and wires the same `render` ⇄ intent message
 * loop the extension uses — so what you see here matches the extension exactly,
 * but runs with mock data and hot reload (no reinstalling the extension).
 *
 * @module dev/main
 */

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  ExtensionToWebviewMessage,
  WalkViewModel,
  WebviewToExtensionMessage,
} from '../../codewalk-view-model.js';
import { App } from '../App.js';
import { ErrorBoundary } from '../components/ErrorBoundary.js';
import { MockController } from './mock-data.js';
import '../styles.css';

const controller = new MockController((model) => {
  const message: ExtensionToWebviewMessage = { type: 'render', model };
  window.postMessage(message, '*');
});

// Stand in for the VS Code webview API before the app posts anything.
(window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
  postMessage: (message: WebviewToExtensionMessage) => controller.handle(message),
  getState: () => undefined,
  setState: () => undefined,
});

function DevRoot() {
  const [model, setModel] = useState<WalkViewModel | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      if (event.data && event.data.type === 'render') {
        setModel(event.data.model);
      }
    };
    window.addEventListener('message', onMessage);
    controller.render(); // emit the initial frame
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
      <DevRoot />
    </StrictMode>,
  );
}
