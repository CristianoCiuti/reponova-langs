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

## Working against an unpublished `reponova` (cross-repo dev link)

Plugins depend on the *published* `reponova` npm package. While developing a change that spans both `reponova` and one or more `@reponova/lang-*` plugins (e.g. a host-side API rename plus the plugins updating their call sites), you need this workspace's build and type-check to see the unreleased host code from your local `reponova` checkout.

The pair of scripts below makes that transparent and reversible:

```bash
pnpm dev:link-reponova                       # default: ../reponova
REPONOVA_PATH=/path pnpm dev:link-reponova   # explicit path
```

What it does:

1. `npm pack` of the sibling `reponova` checkout → tarball under `.dev/` (gitignored).
2. Writes `pnpm.overrides.reponova: file:./.dev/reponova-x.y.z.tgz` into the root `package.json`.
3. `pnpm install --no-frozen-lockfile` to apply the override.

**Both edits — `package.json` and `pnpm-lock.yaml` — are intentionally local and MUST NOT be committed.** When you're done:

```bash
pnpm dev:unlink-reponova
```

This reverts `package.json` and `pnpm-lock.yaml` via `git checkout`, deletes `.dev/`, and runs `pnpm install --frozen-lockfile` to restore the published-version setup.

Transitional caveat — pre-publish window: while a feature is in flight, the plugins' `peerDependencies.reponova` (and the matching `devDependencies.reponova`) may declare a range that doesn't yet exist on npm (e.g. `^0.5.0` while the published version is still `0.4.3`). The committed `pnpm-lock.yaml` then necessarily lags behind. `dev:unlink-reponova` detects this case and exits cleanly with a friendly note; the working tree is restored and safe to commit, and `pnpm install` will re-resolve the lockfile automatically once the upstream release ships.

Safety nets (three layers, defense-in-depth):

1. **Pre-commit hook (automatic).** The committed `.githooks/pre-commit` runs `pnpm check:no-dev-link` whenever a commit touches `package.json` or `pnpm-lock.yaml`. It's wired in by `scripts/install-githooks.mjs`, which the `prepare` npm script runs on every `pnpm install` — so a fresh clone is protected after the very first install with zero extra steps. The hook is a no-op for commits that don't touch those files. Emergency bypass: `git commit --no-verify` (but please don't — and never push the result without a second look).
2. **Release guard.** `prerelease` runs the same check, so `pnpm release` fails fast if the override leaked through. CI never publishes a tarball built against your local sibling checkout.
3. **On-demand check.** `pnpm check:no-dev-link` is also exposed as a regular script (~50 ms), useful in custom CI steps or if you want to call it manually.

`prebuild`/`pretest` intentionally do NOT run the guard: blocking those during dev would defeat the point of the link in the first place.

## Repository layout

```
packages/
  lang-*/                # @reponova/lang-*  (one published plugin per language / asset type)
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

### How retries work in the publish matrix

Network-bound steps that are read-only or post-publish writes (`npm view`, `git ls-remote`, `git push origin <tag>`, `gh release view`, `gh release create`) are wrapped in `.github/scripts/retry.sh`, a small bash helper with exponential backoff. The helper retries up to 5 times (waits 2s → 4s → 8s → 16s, ~30s worst-case extra wall-time) and propagates the final exit code on failure. Each retry is annotated as a `::warning::` in the run summary; an exhausted retry surfaces a `::error::`.

`npm publish` itself is intentionally **not** retried: its most common failures (`404 PUT Not Found` for "no Trusted Publisher", `409 Conflict` for an already-published version) are deterministic and a retry would mask real issues while doubling CI time. For the rare transient `npm publish` failure, the recovery is the bootstrap-plugin path (idempotent on re-run).

The retry helper is unit-tested end-to-end in `tools/bootstrap-plugin/tests/retry.test.ts` (success first try, success after N flakes, exhaustion + exit-code propagation, `MAX_ATTEMPTS=1` behaves as a single shot, etc.).

### When a publish-matrix job fails (one-time per new plugin, or rare flakes)

Even with retries, a job can still end red — most commonly the first time a new `@reponova/lang-*` is bumped past `0.0.0`, where npm cannot accept an OIDC publish without a pre-existing Trusted Publisher entry. The same recovery procedure applies to any other isolated job failure (extended network outage, GitHub API extended degradation, etc.):

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
