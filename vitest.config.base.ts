import { defineConfig, type UserConfig } from 'vitest/config';

/**
 * Shared vitest configuration for all packages.
 * Plugins extend this in their own vitest.config.ts via `defineConfig({ ...baseTestConfig })`.
 */
export const baseTestConfig: UserConfig = {
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    pool: 'forks',
  },
};

export default defineConfig(baseTestConfig);
