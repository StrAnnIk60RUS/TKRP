import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: '.',
  plugins: [react()],
  publicDir: 'public',
  server: {
    port: 5173,
    strictPort: false,
    host: true,
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 5173,
      clientPort: 5173
    },
    fs: {
      allow: ['..']
    }
  }
})
