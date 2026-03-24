import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  publicDir: path.resolve(__dirname, 'public'),
  build: {
    outDir: path.resolve(repoRoot, 'dist', 'web'),
    emptyOutDir: true
  },
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
      allow: [repoRoot]
    }
  }
})
