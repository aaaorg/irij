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
  // .tmj jsou Tiled JSON exporty (mapy). Esbuild umí JSON nativně, ale custom
  // extension musí být explicitně namapována. Phase 4a importuje test_50x50.tmj
  // do server bundle pro WalkableMask init.
  loader: { '.tmj': 'json' },
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

async function verifyInitModule() {
  const src = await readFile(OUTFILE, 'utf8');
  if (/var __irij_server\b/.test(src)) {
    console.error(
      'BUILD FAILED: IIFE wrapper still present in dist/index.js.\n' +
        'unwrapIife() regex no longer matches esbuild output format.\n' +
        'Nakama runtime will crash with "failed to find InitModule".',
    );
    process.exit(1);
  }
  if (!/function InitModule\b/.test(src)) {
    console.error(
      'BUILD FAILED: `function InitModule` not found in dist/index.js.\n' +
        'Nakama runtime will crash with "failed to find InitModule".',
    );
    process.exit(1);
  }
}

if (watch) {
  const ctx = await context(config);
  await ctx.watch();
  console.log('esbuild: watching…');
} else {
  await build(config);
  await unwrapIife();
  await verifyInitModule();
  console.log('esbuild: built to dist/index.js');
}
