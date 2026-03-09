import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  server: {
    fs: {
      allow: ['..']
    },
    proxy: {
      '/api/yandex': {
        target: 'https://ai.api.cloud.yandex.net/v1',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/yandex/, ''),
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            // Передаем все заголовки из оригинального запроса
            const authHeader = req.headers['authorization'] || req.headers['Authorization'];
            const folderHeader = req.headers['x-folder-id'] || req.headers['X-Folder-Id'];
            
            if (authHeader) {
              proxyReq.setHeader('Authorization', authHeader);
            }
            if (folderHeader) {
              proxyReq.setHeader('x-folder-id', folderHeader);
            }
            // Убеждаемся, что Content-Type передается
            if (req.headers['content-type']) {
              proxyReq.setHeader('Content-Type', req.headers['content-type']);
            }
          });
          proxy.on('error', (err, req, res) => {
            console.error('Proxy error:', err);
          });
        }
      }
    }
  }
})
