import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

const config = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'irij_server',
  target: 'es2022',
  outfile: 'dist/index.js',
  platform: 'neutral',
  // Nakama runtime má vlastní moduly, externí
  external: ['nakama-runtime'],
  // Polyfilly nepotřebujeme — Nakama runtime má built-ins
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(config);
  await ctx.watch();
  console.log('esbuild: watching…');
} else {
  await build(config);
  console.log('esbuild: built to dist/index.js');
}
