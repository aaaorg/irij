import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Irij',
        short_name: 'Irij',
        description: 'Browser MMORPG ve světě slovanského folklóru.',
        theme_color: '#2c1810',
        background_color: '#1a0f08',
        display: 'standalone',
        orientation: 'any',
        icons: [
          // TODO: doplnit icons (192/512/maskable)
        ],
      },
      workbox: {
        // V MVP fázi cache jen lobby/login, nikdy game traffic
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,png,svg}'],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true, // pro mobile testing přes LAN
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  // irij-shared je workspace TS source (package "main": "./src/index.ts").
  // Defaultně by ho Vite pre-bundloval esbuildem do node_modules/.vite/deps —
  // při HMR shared modulu se pak pre-bundled snapshot a re-transformované
  // moduly rozejdou v listu pojmenovaných exportů, prohlížeč dostane
  // "does not provide an export named X" i když export reálně existuje.
  // Excludneme shared z optimizeDeps a Vite ho serviruje jako čistý zdroj.
  optimizeDeps: {
    exclude: ['irij-shared'],
  },
});
