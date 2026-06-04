# @reponova/lang-python

## 0.2.1

### Patch Changes

- 59d8dfd: Source the bundled tree-sitter grammar from the upstream
  [`tree-sitter/tree-sitter-python@v0.25.0`](https://github.com/tree-sitter/tree-sitter-python/releases/tag/v0.25.0)
  release at build time instead of carrying the `.wasm` binary in git.

  Functionally a no-op for consumers: the published npm tarball still ships
  `grammars/tree-sitter-python.wasm` and the file bytes are identical
  (sha256 `16108b50df4ee9a30168794252ab55e7c93bfc5765d7fa0aa3e335752c515f47`).

  Internal change: the new `@reponova/grammar-fetcher` build tool downloads
  and SHA-256-verifies the grammar from its pinned upstream release before
  `tsup` runs.

## 0.2.0

### Minor Changes

- bab08eb: Migrate to the unified `reponova-langs` monorepo.

  No behavioural changes to the extractors. Internals:

  - `peerDependencies.reponova` tightened from `^0.x` to `^0.4.0`
  - `engines.node` declared as `>=18` in every package
  - Build/test/typecheck configs now extend shared monorepo bases
  - Released from a single repository with coordinated CI on Ubuntu / Windows / macOS x Node 18 / 20 / 22
