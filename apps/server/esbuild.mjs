// Production bundler for the game server.
//
// Why bundle? In this monorepo, the server imports `@fmr/shared`, which ships
// TypeScript source (no build step). A plain `tsc` emit leaves a bare
// `import ... from '@fmr/shared'` in the output, which Node cannot resolve at
// runtime (it points at .ts source). esbuild inlines the shared package into a
// single self-contained dist/index.js, while leaving real npm dependencies
// external (resolved from node_modules as usual). This makes the server
// trivially deployable on any Node host.
import esbuild from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Externalize real npm dependencies; bundle the workspace package (@fmr/shared).
const external = Object.keys(pkg.dependencies ?? {}).filter((dep) => dep !== '@fmr/shared');

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/index.js',
  sourcemap: true,
  external,
  // CJS interop shim: some external deps (express, colyseus) are CommonJS and may
  // use require() internally once interop-loaded. Provide require in the ESM scope.
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
  tsconfig: 'tsconfig.json',
  logLevel: 'info',
});

console.log('[build] server bundled → dist/index.js');
