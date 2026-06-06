import { defineConfig, type UserConfig } from 'vitest/config';

/**
 * Shared vitest configuration for all packages.
 *
 * Plugins extend this in their own vitest.config.ts via
 * `defineConfig({ ...baseTestConfig })`. The `coverage` block here is
 * applied uniformly: it ONLY runs when vitest is invoked with
 * `--coverage` (or `pnpm test:coverage`), so day-to-day `pnpm test`
 * stays fast.
 *
 * Coverage policy:
 *
 *   ▸ Hard gate at 80% on `src/extractor.ts` for every metric (lines,
 *     branches, functions, statements). This is the canonical
 *     "value-producing" file in every plugin (regex- or tree-sitter-based
 *     parsing logic) and the one the gate singles out.
 *
 *   ▸ NO global gate (yet). Some plugins ship an `outline.ts` whose
 *     coverage is currently far below 80% because the existing test
 *     suites focus on the extractor. Lifting `outline.ts` to 80% is a
 *     planned follow-up, not a blocker for shipping the gate.
 *
 *   ▸ The barrel `src/index.ts` is excluded — it is pure re-exports and
 *     is exercised transitively by every other test.
 *
 * Plugins can override (e.g. to raise the bar on a specific file or to
 * add additional excludes) in their own `vitest.config.ts`.
 */
export const baseTestConfig: UserConfig = {
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/index.ts',
      ],
      thresholds: {
        // Per-file gate on the canonical extractor file. Plugins without
        // an `extractor.ts` (e.g. internal core packages, test utilities)
        // are excluded from `pnpm test:coverage` at the workspace level
        // — see the root package.json filter list — so this glob is a
        // no-op for them rather than a false negative.
        'src/extractor.ts': {
          lines: 80,
          branches: 80,
          functions: 80,
          statements: 80,
        },
      },
    },
  },
};

export default defineConfig(baseTestConfig);
