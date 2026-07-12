import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Electron main + preload run in Node (better-sqlite3 is a native dep → externalize it).
// The renderer is a normal Vite + React SPA.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts') } } },
  },
  renderer: {
    root: 'src/ui',
    build: { rollupOptions: { input: { index: resolve('src/ui/index.html') } } },
    plugins: [react()],
  },
});
