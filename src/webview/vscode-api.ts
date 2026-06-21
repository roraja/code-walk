/**
 * Thin typed wrapper around the VS Code webview messaging API.
 *
 * `acquireVsCodeApi()` may only be called once per webview, so we cache it.
 */
import type { WebviewToExtensionMessage } from '../codewalk-view-model.js';

interface VsCodeApi {
  postMessage(message: WebviewToExtensionMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let cached: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi {
  if (!cached) {
    cached = acquireVsCodeApi();
  }
  return cached;
}

export function post(message: WebviewToExtensionMessage): void {
  getVsCodeApi().postMessage(message);
}
