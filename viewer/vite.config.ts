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
      '/api': {
        target: 'http://127.0.0.1:7778',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:7778',
        ws: true,
      },
      '/tts': {
        target: 'http://127.0.0.1:7778',
        changeOrigin: true,
        ws: true,
      },
      '/stt': {
        target: 'http://127.0.0.1:7778',
        changeOrigin: true,
      },
      '/image': {
        target: 'http://127.0.0.1:7778',
        changeOrigin: true,
      },
      '/inference': {
        target: 'http://127.0.0.1:7778',
        changeOrigin: true,
      },
      '/models': {
        target: 'http://127.0.0.1:7778',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:7778',
        changeOrigin: true,
      },
    },
  },
})
