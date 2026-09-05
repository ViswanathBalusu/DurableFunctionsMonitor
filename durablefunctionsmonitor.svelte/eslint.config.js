import svelte from 'eslint-plugin-svelte';
import ts from 'typescript-eslint';

export default ts.config(
  {
    ignores: ['build/', 'node_modules/', 'test-results/', 'playwright-report/', '.vite/'],
  },
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
      },
    },
  },
);
