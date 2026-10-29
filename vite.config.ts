import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // relative paths: the same build runs from any folder, a web host or the desktop app
  base: './',
  plugins: [react()],
  // the desktop shell (Tauri) expects a fixed dev port
  server: { port: 5173, strictPort: false },
  clearScreen: false,
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', testTimeout: 60000 },
} as any);
