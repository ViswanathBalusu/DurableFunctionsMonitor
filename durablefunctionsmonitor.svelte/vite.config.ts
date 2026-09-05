// Build output contract: docs/plans/svelte-rewrite/00-shared-contracts.md §2.
// `defineConfig` comes from 'vitest/config' (not 'vite') so the `test` key type-checks.
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  base: '/',
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
    },
  },
  build: {
    outDir: 'build',
    sourcemap: true,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        hashCharacters: 'hex',
        entryFileNames: 'static/js/main.[hash].js',
        chunkFileNames: 'static/js/[name].[hash].js',
        assetFileNames: (asset) => {
          const name = asset.names?.[0] ?? '';
          if (name.endsWith('.css')) return 'static/css/main.[hash][extname]';
          return 'static/media/[name].[hash][extname]';
        },
      },
    },
  },
  experimental: {
    renderBuiltUrl(filename, { hostType }) {
      return hostType === 'css' ? { relative: true } : undefined;
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/durable-functions-monitor': 'http://localhost:7072',
      '/a/p/i': 'http://localhost:7072',
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    passWithNoTests: true,
  },
});
