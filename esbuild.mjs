/**
 * esbuild config for the Code Walk VS Code extension.
 *
 * Produces:
 *   - dist/extension.js — the Node-side extension (no runtime npm deps beyond
 *     Node built-ins + the `vscode` API).
 *   - dist/webview.js / dist/webview.css — the React sidebar UI that runs inside
 *     the webview (React + ReactDOM are bundled in, so the VSIX stays
 *     self-contained).
 *
 * Modes:
 *   node esbuild.mjs            → one-off production build of both bundles
 *   node esbuild.mjs --watch    → rebuild both bundles on change
 *   node esbuild.mjs --serve    → serve the UI dev preview (dev/) with mock data
 */
import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');
const isServe = process.argv.includes('--serve');

/** @type {esbuild.BuildOptions} */
const extensionOptions = {
  entryPoints: ['./src/extension.ts'],
  bundle: true,
  outfile: './dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  treeShaking: true,
  logLevel: 'info',
};

/** Shared options for browser (webview) bundles. */
const browserBase = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  treeShaking: true,
  jsx: 'automatic',
  loader: { '.css': 'css' },
  logLevel: 'info',
};

/** @type {esbuild.BuildOptions} */
const webviewOptions = {
  ...browserBase,
  entryPoints: ['./src/webview/index.tsx'],
  outfile: './dist/webview.js',
  define: { 'process.env.NODE_ENV': '"production"' },
};

/** @type {esbuild.BuildOptions} */
const webviewDevOptions = {
  ...browserBase,
  entryPoints: ['./src/webview/dev/main.tsx'],
  outdir: './dev',
  define: { 'process.env.NODE_ENV': '"development"' },
};

if (isServe) {
  const ctx = await esbuild.context(webviewDevOptions);
  await ctx.watch();
  // Default to 0 = let the OS pick a free port (avoids clashes on shared
  // machines); override with CODEWALK_DEV_PORT for a stable, bookmarkable URL.
  const requestedPort = Number(process.env.CODEWALK_DEV_PORT) || 0;
  const { host, port } = await ctx.serve({ servedir: './dev', port: requestedPort });
  const shown = !host || host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  console.log(`\n  Code Walk UI dev server → http://${shown}:${port}\n`);
} else if (isWatch) {
  const extCtx = await esbuild.context(extensionOptions);
  const webCtx = await esbuild.context(webviewOptions);
  await Promise.all([extCtx.watch(), webCtx.watch()]);
  console.log('esbuild: watching for changes...');
} else {
  await Promise.all([esbuild.build(extensionOptions), esbuild.build(webviewOptions)]);
}
