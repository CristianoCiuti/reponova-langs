import { defineConfig } from 'tsup';
import { baseConfig } from '../../tsup.base';

/**
 * Build for `@reponova/lang-typescript-core`.
 *
 * The package is `"private": true` and is never published to npm. The reason
 * we still build it is so consumer plugins (`@reponova/lang-typescript`,
 * `@reponova/lang-tsx`) can let `tsup --noExternal` pick up the compiled
 * `.js` and let `dts: { resolve: true }` pick up the compiled `.d.ts`,
 * inlining everything into their own published tarballs.
 */
export default defineConfig(baseConfig);
