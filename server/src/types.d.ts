// Modul shimy pro asset imports, které esbuild bundluje, ale tsc je sám neumí
// resolvnout. Phase 4a: .tmj (Tiled JSON map export) — importujeme do server
// bundle přes esbuild { loader: { '.tmj': 'json' } }, viz build.js.

declare module '*.tmj' {
  import type { TiledMap } from 'irij-shared/types';
  const value: TiledMap;
  export default value;
}
