/**
 * esbuild config for the Code Walk VS Code extension.
 *
 * Bundles the extension into a single dist/extension.js. The extension has no
 * runtime npm dependencies (only Node built-ins + the `vscode` API), so the
 * VSIX is fully self-contained.
 */
import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const buildOptions = {
  entryPoints: ['./src/extension.ts'],
  bundle: true,
  outdir: './dist',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  treeShaking: true,
  logLevel: 'info',
};

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('esbuild: watching for changes...');
} else {
  await esbuild.build(buildOptions);
}
