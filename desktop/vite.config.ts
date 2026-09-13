import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Shared framework-agnostic modules live outside this package (monorepo).
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  // Tauri expects a fixed dev-server port, so do not auto-increment it.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Don't watch the Rust core, since it has no bearing on HMR.
      ignored: ['**/src-tauri/**'],
    },
  },
});
