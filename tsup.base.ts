import type { Options } from 'tsup';

/**
 * Shared tsup configuration for all @reponova/lang-* plugins.
 * Each plugin imports this and may override specific fields.
 */
export const baseConfig: Options = {
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
  treeshake: true,
  splitting: false,
  shims: false,
};
