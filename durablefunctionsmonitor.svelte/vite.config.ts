// Placeholder config: E0-S1-T2 replaces it with the build-output-contract version (contracts §2).
// Only the pieces E0-S1-T1 needs are here: the Svelte plugin, the `$lib` alias that matches
// tsconfig `paths`, the `build` output folder and the vitest block.
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  base: '/',
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
    },
  },
  build: {
    outDir: 'build',
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    passWithNoTests: true,
  },
});
