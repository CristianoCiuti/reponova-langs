// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Shared ESLint flat config for the reponova-langs monorepo.
 *
 * Goals:
 *  - Catch real bugs (no-unused-vars, no-undef via TS)
 *  - Stay quiet on stylistic noise (formatting is editor / Prettier-ish, not lint)
 *  - Allow underscore-prefixed args/vars as intentionally unused (stub extractors)
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/grammars/**',
      'pnpm-lock.yaml',
      // Verbatim third-party snapshots used as `complex/` test fixtures.
      // By convention, anything under `tests/fixtures/complex/` is a pinned
      // upstream snapshot (see each fixture's ATTRIBUTION.md) and must NOT
      // be modified by lint autofixers. Hand-authored `simple/` and `medium/`
      // fixtures remain lint-checked.
      '**/tests/fixtures/complex/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
    },
  },
  {
    files: ['**/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['tools/scaffold/src/templates.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Hand-authored CommonJS / pre-ES-module fixtures used to exercise the
    // `require()` recogniser of the JS extractor: by definition they MUST
    // use `require()` to be useful test inputs, so the no-require-imports
    // rule is muted under tests/fixtures/.
    files: ['**/tests/fixtures/**/*.{cjs,js}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
