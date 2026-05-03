import { build, context } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const OUTFILE = 'dist/index.js';

// Nakama Goja runtime hledá `function InitModule` na top-level scope a registruje
// RPC/match handlery podle jejich `Function.name`. Esbuild IIFE wrapper všechny
// funkce skryje uvnitř closure — Goja je nenajde a `registerRpc` selže s
// "function key could not be extracted: not found". Strip wrapper post-build.
const config = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  globalName: '__irij_server',
  target: 'es2022',
  outfile: OUTFILE,
  platform: 'neutral',
  external: ['nakama-runtime'],
  logLevel: 'info',
};

async function unwrapIife() {
  const src = await readFile(OUTFILE, 'utf8');
  // Esbuild IIFE format: `var X = (() => { BODY })();`
  // BODY končí `return __toCommonJS(main_exports);`, který je nahrazený výrazem
  // Top-level naked stripping:
  //   - "use strict"; ponecháme
  //   - `var __irij_server = (() => {` → smazat (otevírá IIFE)
  //   - `return __toCommonJS(main_exports);` → smazat (uvnitř IIFE poslední řádek)
  //   - `})();` na konci souboru → smazat (uzavírá IIFE)
  const unwrapped = src
    .replace(/var __irij_server = \(\(\) => \{\n/, '')
    .replace(/\s+return __toCommonJS\(main_exports\);\n\}\)\(\);\s*$/, '\n');
  await writeFile(OUTFILE, unwrapped, 'utf8');
}

if (watch) {
  const ctx = await context(config);
  await ctx.watch();
  console.log('esbuild: watching…');
  // Watch mode unwrap done once; rebuild stays wrapped without rebuilding.
  // Pro jednoduchost watch mode není podporován pro Nakama loading; používej --build pro deploy.
} else {
  await build(config);
  await unwrapIife();
  console.log('esbuild: built to dist/index.js');
}
