import { defineConfig } from 'vite';

/**
 * LAST ZONE build configuration.
 *
 * `base: './'` keeps the built bundle relative so `dist/` can be dropped on any
 * static host (or opened through a simple file server) without extra config.
 */
export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Allow proxied / tunnelled hosts (cloud sandboxes, LAN devices, ngrok, ...).
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // three.js is by far the largest dependency and changes rarely: keep it
        // in its own chunk so browsers can cache it across game updates.
        manualChunks: { three: ['three'] },
      },
    },
  },
});
