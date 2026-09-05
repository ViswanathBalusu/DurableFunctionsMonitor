// Build output contract: docs/plans/svelte-rewrite/00-shared-contracts.md §2.
// `defineConfig` comes from 'vitest/config' (not 'vite') so the `test` key type-checks.
import { svelteTesting } from '@testing-library/svelte/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // svelteTesting() only acts when process.env.VITEST is set (adds `browser` to
  // resolve.conditions ahead of `node` so Vitest mounts Svelte's browser build
  // instead of its SSR build, plus DOM auto-cleanup after each test); it is a
  // no-op for `vite build`/`vite dev`. See docs/plans/svelte-rewrite/E3-test-harness.md E3-S1-T1.
  plugins: [tailwindcss(), svelte(), svelteTesting()],
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
    passWithNoTests: true, // until the first test file exists
    setupFiles: ['tests/unit/setup.ts'],
    css: true, // load Svelte component styles so class-based assertions see real classes
    coverage: {
      // Not `enabled: true`: the `npm run test:watch` loop should stay fast and
      // uninstrumented. `npm test` (package.json) passes `--coverage`, which
      // overrides this to enabled for the one-shot CI/local run.
      provider: 'v8',
      reporter: ['text', 'html'],
      // Thresholds only for the pure-logic modules named by E3-S1-T1; everything
      // else (components, state, routes) has no enforced threshold yet.
      thresholds: {
        'src/lib/format/**': { lines: 70 },
        'src/lib/filters/**': { lines: 70 },
        'src/lib/api/**': { lines: 70 },
        'src/lib/router.svelte.ts': { lines: 70 },
      },
    },
  },
});
