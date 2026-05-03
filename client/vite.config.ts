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
});
