import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Two deploy modes:
//   - Standalone (default): served at the project's own domain root (`/`).
//     This is what the open-source repo + great-yak-9522.edgespark.app use.
//   - Sub-path: served at `/tearable-memory/` inside the hinihao.ai hub.
//     Switched on by setting TEARABLE_BASE=/tearable-memory/ at build time.
const BASE = process.env.TEARABLE_BASE || '/';

export default defineConfig({
  base: BASE,
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
