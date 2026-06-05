# Contributing to reponova-langs

This document covers everything you need to develop, build, test, and release the official `@reponova/lang-*` plugins. End-user documentation lives in each plugin's own README.

## Requirements

- Node `>= 18`
- pnpm `9`

## Local setup

```bash
pnpm install
pnpm grammar-fetch    # one-time per clone / per grammar bump
pnpm typecheck
pnpm build
pnpm test
```

The `prebuild` and `pretest` hooks of plugins that ship a tree-sitter grammar (e.g. `lang-typescript`, `lang-python`) call `grammar-fetch` automatically, so a fresh `pnpm build` or `pnpm test` from a clean clone works without an explicit fetch step.

## Repository layout

```
packages/
  lang-typescript/       # @reponova/lang-typescript  (published)
  lang-python/           # @reponova/lang-python      (published)
  lang-plantuml/         # @reponova/lang-plantuml    (published)
  lang-svg/              # @reponova/lang-svg         (published)
  lang-test-utils/       # internal: shared test helpers
  scaffold/              # internal: `pnpm scaffold` CLI
tools/
  grammar-fetcher/       # internal: pinned download + SHA-256 verify
  trust-configure/       # internal: bulk npm OIDC trust setup
  bootstrap-plugin/      # internal: first-publish helper for new plugins
```

`lang-test-utils`, `scaffold`, `grammar-fetcher`, `trust-configure`, and `bootstrap-plugin` are private (`"private": true`) and never published to npm.

## Tree-sitter grammars

`.wasm` grammars are **not committed to git**. They are pinned (version + SHA-256) in [`tools/grammar-fetcher/grammars.json`](./tools/grammar-fetcher/grammars.json), downloaded from upstream GitHub releases at build time, and bundled into each plugin's published npm tarball under `grammars/`.

To add or bump a grammar, edit the manifest and re-run `pnpm grammar-fetch`. See [`tools/grammar-fetcher/README.md`](./tools/grammar-fetcher/README.md) for the operational details.

## npm trusted publisher (OIDC)

Each `@reponova/lang-*` package on npmjs.com is configured with a GitHub Actions OIDC Trusted Publisher pointing at `release.yml` in this repo. **There are no long-lived `NPM_TOKEN` secrets in CI** — every release is signed by the workflow's short-lived OIDC token.

A brand-new plugin needs a one-time bootstrap because npm has a chicken-and-egg constraint between Trusted Publisher configuration and the first OIDC publish. Use the helper:

```bash
pnpm bootstrap-plugin lang-<id>   # publish + trust + tag + GitHub Release
```

After this runs once, every subsequent release is fully automated via CI. See [`tools/bootstrap-plugin/README.md`](./tools/bootstrap-plugin/README.md) and [`tools/trust-configure/README.md`](./tools/trust-configure/README.md) for the full operational procedure.

## Scaffold a new plugin

```bash
pnpm scaffold lang-<id>
```

This generates a new package under `packages/lang-<id>/` with the workspace conventions (extractor + outline scaffolding, tsup config, vitest config, lint baseline, README skeleton).

## Release process

Releases are managed via [Changesets](https://github.com/changesets/changesets) and a release workflow that publishes each `@reponova/lang-*` package **independently** in a `fail-fast: false` matrix. A failure on one package never blocks the others, and every step (npm publish / git tag / GitHub Release) is idempotent so re-runs after a manual recovery converge to green.

### Day-to-day flow (single, unified)

```bash
pnpm changeset           # describe a change → .changeset/<random>.md
git commit / push / open PR / merge PR
# 1. CI opens (or updates) the "Version Packages" PR via changesets/action.
# 2. Merge the Version PR.
# 3. The Release workflow runs three jobs in order:
#      versioning  → no-op (no pending changesets)
#      detect      → enumerates packages with a version not yet on npm
#      publish     → matrix, one job per package, fail-fast: false
#                    each job: npm publish (OIDC) → git tag → gh release
```

For an already-bootstrapped package, this is everything: every job is green, npm and GitHub Releases stay in lock-step, no manual step required.

### When a publish-matrix job fails (one-time per new plugin, or rare flakes)

The very first time a new `@reponova/lang-*` is bumped past `0.0.0`, its publish job will fail because npm cannot accept an OIDC publish without a pre-existing Trusted Publisher entry. The same recovery procedure applies to any other isolated job failure (network flake, npm outage, etc.):

```bash
git checkout main
git pull
pnpm install
pnpm bootstrap-plugin lang-<id>      # publish + trust + tag + release, all idempotent
```

Then on the GitHub Actions UI of the failing run, click **Re-run failed jobs**. Each step of the matrix detects the work as already done (version on registry, tag on origin, release exists) and skips: the run flips to all-green.

The same `bootstrap-plugin` invocation is also safe to run *before* merging the Version PR (on the `changeset-release/main` branch) if you want to avoid the red run entirely; the result is identical.

## Coding conventions

- TypeScript everywhere. ESLint is the source of truth (`pnpm -w lint`).
- One package per language / asset type. No multi-grammar plugins.
- Tests use Vitest. Each extractor ships at least three fixture tiers (`simple`, `medium`, `complex`); the `complex` tier should be a verbatim, SHA-pinned snapshot of a real-world OSS project where licensing allows.
- Keep plugin READMEs focused on the npm consumer: install, what it extracts, configuration, resolution semantics. Repo-internal concerns belong here in `CONTRIBUTING.md`.

## License

MIT — see [LICENSE](./LICENSE).
