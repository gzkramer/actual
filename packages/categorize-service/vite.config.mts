import path from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  ssr: {
    target: 'node',
  },
  build: {
    ssr: true,
    target: 'node22',
    outDir: path.resolve(__dirname, 'build'),
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'src/index.ts'),
        'scripts/health-check': path.resolve(
          __dirname,
          'src/scripts/health-check.ts',
        ),
      },
      output: {
        format: 'esm',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
});
