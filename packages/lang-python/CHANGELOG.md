# @reponova/lang-python

## 0.2.0

### Minor Changes

- bab08eb: Migrate to the unified `reponova-langs` monorepo.

  No behavioural changes to the extractors. Internals:

  - `peerDependencies.reponova` tightened from `^0.x` to `^0.4.0`
  - `engines.node` declared as `>=18` in every package
  - Build/test/typecheck configs now extend shared monorepo bases
  - Released from a single repository with coordinated CI on Ubuntu / Windows / macOS x Node 18 / 20 / 22
