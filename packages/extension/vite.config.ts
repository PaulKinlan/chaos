import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig({
  define: {
    '__CHAOS_DEFAULT_RELAY_URL__': JSON.stringify(process.env.VITE_RELAY_URL || 'https://chaos--main.paulkinlan-ea.deno.net'),
  },
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
        'src/voice/recognition-frame': new URL('./src/voice/recognition-frame.html', import.meta.url).pathname,
        'src/offscreen-parser': new URL('./src/offscreen-parser.html', import.meta.url).pathname,
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
