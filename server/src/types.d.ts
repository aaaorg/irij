// Modul shimy pro asset imports, které esbuild bundluje, ale tsc je sám neumí
// resolvnout. Phase 4a: .tmj (Tiled JSON map export) — importujeme do server
// bundle přes esbuild { loader: { '.tmj': 'json' } }, viz build.js.

declare module '*.tmj' {
  const value: {
    width: number;
    height: number;
    layers: Array<{
      name: string;
      type: string;
      width: number;
      height: number;
      data: number[];
    }>;
    [key: string]: unknown;
  };
  export default value;
}
