import { defineConfig } from 'vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import cssInjectedByJs from 'vite-plugin-css-injected-by-js';

export default defineConfig({
  define: {
    // Amplify and its deps reference process.env.NODE_ENV; replace it at build time
    // so the IIFE bundle doesn't crash in browsers (no Node.js runtime)
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': '{}',
    global: 'globalThis',
  },
  plugins: [
    react(),
    cssInjectedByJs(), // inline all CSS into the IIFE so the widget is self-contained
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'KycWidget',
      fileName: () => 'kyc-widget.iife.js',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
