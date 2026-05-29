import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/v1': 'http://localhost:3000',
    },
  },
  build: {
    outDir: '../../packages/api/public',
    emptyOutDir: true,
  },
});
