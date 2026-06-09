import { defineConfig } from 'tsup';
import { baseConfig } from '../../tsup.base';

/**
 * Bundle the workspace-internal `@reponova/lang-c-core` inline so the
 * published tarball is fully self-contained.
 *
 * `noExternal` handles the JS bundle. `dts.resolve` is required so that
 * the generated `dist/index.d.ts` inlines re-exported types from the
 * same private package; without it, tsup emits `export {
 * CFamilyExtractor } from '@reponova/lang-c-core'`, which npm consumers
 * cannot resolve because `@reponova/lang-c-core` is `"private": true`
 * and never published to npm.
 */
export default defineConfig({
  ...baseConfig,
  noExternal: ['@reponova/lang-c-core'],
  dts: { resolve: true },
});
