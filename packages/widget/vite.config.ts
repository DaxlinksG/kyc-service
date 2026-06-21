import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import cssInjectedByJs from 'vite-plugin-css-injected-by-js';

// Inject a process shim directly into the IIFE output.
// We do this as a generateBundle hook (runs after all other plugins including
// cssInjectedByJs) so the shim is guaranteed to be first inside the wrapper.
const PROCESS_SHIM =
  'var process={"env":{"NODE_ENV":"production"},"browser":true,"version":"","versions":{},"argv":[],"exitCode":0};' +
  'process.on=function(){return process};' +
  'process.removeListener=function(){return process};' +
  'process.listeners=function(){return[]};' +
  'process.hrtime=function(){return[0,0]};' +
  'process.exit=function(){};';

function processShimPlugin(): Plugin {
  return {
    name: 'process-shim',
    enforce: 'post', // run after cssInjectedByJs
    generateBundle(_opts, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && chunk.isEntry) {
          // Insert shim right after the IIFE opening paren so it runs first
          chunk.code = chunk.code.replace(/^(\(function\(\)\{)/, `$1${PROCESS_SHIM}`);
        }
      }
    },
  };
}

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': JSON.stringify({ NODE_ENV: 'production' }),
    global: 'globalThis',
  },
  plugins: [
    react(),
    cssInjectedByJs(),
    processShimPlugin(),
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
