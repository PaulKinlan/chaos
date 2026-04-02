import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [
    crx({ manifest }),
  ],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        app: new URL('./app.html', import.meta.url).pathname,
        offscreen: new URL('./offscreen.html', import.meta.url).pathname,
      },
    },
  },
  test: {
    exclude: [
      'node_modules/**',
      'dist/**',
      'src/__tests__/e2e/**',
    ],
  },
});
