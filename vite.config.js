import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: '/index.html',
        navigateFallbackAllowlist: [/^\/(?!__).*/],
        // Skip cross-origin font requests entirely — let the browser handle them
        navigateFallbackDenylist: [/^\/__(.*)/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'NetworkOnly',
            options: { cacheName: 'google-fonts-bypass' }
          },
          {
            urlPattern: /^https:\/\/.*\.firebasestorage\.app\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'firebase-images', expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 } }
          }
        ]
      },
      manifest: {
        name: "Champ's Meats",
        short_name: "Champ's",
        description: "Kiosk ordering for Champ's Butcher Shop",
        theme_color: '#0f0d0b',
        background_color: '#0f0d0b',
        display: 'standalone',
        start_url: '/kiosk',
        scope: '/',
        icons: [
          { src: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
          { src: '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' }
        ]
      }
    })
  ],
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString())
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: undefined,
        entryFileNames: `assets/[name]-[hash].js`,
        chunkFileNames: `assets/[name]-[hash].js`,
        assetFileNames: `assets/[name]-[hash].[ext]`
      }
    }
  }
})
