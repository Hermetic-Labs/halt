import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.svg', 'icon-512.svg'],
      manifest: {
        name: 'Eve Os: Triage',
        short_name: 'Triage',
        description: 'Airgapped mesh triage network — offline-first medical coordination',
        theme_color: '#0d1117',
        background_color: '#0d1117',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: 'icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 },
              networkTimeoutSeconds: 5,
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 7777,
    proxy: {
      // REST API → axum HTTP server (:7779)
      '/api': {
        target: 'http://127.0.0.1:7779',
        changeOrigin: true,
      },
      '/tts': {
        target: 'http://127.0.0.1:7779',
        changeOrigin: true,
      },
      '/stt': {
        target: 'http://127.0.0.1:7779',
        changeOrigin: true,
      },
      '/inference': {
        target: 'http://127.0.0.1:7779',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:7779',
        changeOrigin: true,
      },
      // WebSocket → tokio-tungstenite mesh server (:7778)
      '/ws': {
        target: 'ws://127.0.0.1:7778',
        ws: true,
      },
      '/translate-live': {
        target: 'http://127.0.0.1:7779',
        changeOrigin: true,
        ws: true,
      },
      '/translate-stream': {
        target: 'http://127.0.0.1:7779',
        changeOrigin: true,
        ws: true,
      },
      '/call-translate': {
        target: 'http://127.0.0.1:7779',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
