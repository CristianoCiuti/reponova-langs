import { defineConfig } from 'tsup';
import { baseConfig } from '../../tsup.base';

/**
 * Bundle the workspace-internal `@reponova/lang-typescript-core` inline so the
 * published tarball is fully self-contained.
 *
 * `noExternal` handles the JS bundle. `dts: { resolve: true }` is required so
 * that the generated `dist/index.d.ts` inlines re-exported types from the
 * private core package; without it the consumer-facing declarations would
 * import from `@reponova/lang-typescript-core`, which npm cannot resolve
 * because the core is `"private": true` and never published to npm.
 */
export default defineConfig({
  ...baseConfig,
  noExternal: ['@reponova/lang-typescript-core'],
  dts: { resolve: true },
});
