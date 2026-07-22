import { defineConfig } from 'vite';

export default defineConfig({
  base: '/portal/',
  server: {
    proxy: {
      '/v1': 'http://localhost:3000',
    },
  },
  build: {
    // Emit into a subfolder of the API's public dir. The admin build runs first with
    // emptyOutDir on the parent, so the portal must build AFTER admin (see Dockerfile).
    outDir: '../../packages/api/public/portal',
    emptyOutDir: true,
  },
});
