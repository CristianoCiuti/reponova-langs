# `@reponova/trust-configure`

Internal one-shot tool that registers the GitHub Actions OIDC **Trusted Publisher** for every `@reponova/lang-*` package on npmjs.com, in a single bulk operation.

## Why this exists

Each npm package on npmjs.com can have **one** Trusted Publisher entry. There is **no** scope- or organization-level config (see [`npm/cli#8877`](https://github.com/npm/cli/issues/8877), still open as of June 2026). Configuring 4, 8, 24 packages by hand through the npmjs.com UI is tedious and easy to misconfigure (one typo in the workflow filename and the next CI publish silently fails).

`pnpm trust:configure` discovers every non-private `@reponova/lang-*` package in `packages/` and calls `npm trust github` against each of them with the canonical settings:

| Field | Value |
|---|---|
| Provider | GitHub Actions |
| Repository | `CristianoCiuti/reponova-langs` |
| Workflow filename | `release.yml` |
| Permission | `--allow-publish` |

After this runs once, the `release.yml` workflow can publish each package via OIDC, with **no `NPM_TOKEN` secret** required.

## Prerequisites

1. **npm CLI >= 11.10.0** (the version that introduced the `npm trust` subcommand). Check with:
   ```bash
   npm --version
   # if older:
   npm install -g npm@latest
   ```
2. **Logged in to npm**: `npm login`
3. **2FA**: when prompted on the first package, accept _"skip 2FA for the next 5 minutes"_ so the rest of the packages process without re-authentication
4. **Package already exists on npm**: Trusted Publisher can only be configured on existing packages. For a brand-new plugin, do **one** manual `npm publish` (with OTP) of the initial version first, then run this tool

## Usage

From the workspace root:

```bash
# 1. Dry-run: list all packages and the exact commands that would run.
#    Always do this first to confirm the discovery picked up the right targets.
pnpm trust:configure

# 2. Apply: actually configure each package on npmjs.com.
pnpm trust:configure --apply
```

The script:

- Discovers every non-private `@reponova/lang-*` package via `packages/*/package.json`
- Runs `npm trust github <pkg> --repo CristianoCiuti/reponova-langs --file release.yml --allow-publish --yes` for each
- Sleeps 2 seconds between calls (npm registry rate-limit friendly)
- Reports a summary at the end and exits non-zero if any package failed

It is **idempotent**: re-running it on already-configured packages is a no-op or a re-confirmation, never destructive.

## Adding a new plugin: end-to-end flow

When you add `@reponova/lang-<id>` to the monorepo and want it on npm with OIDC publishing, the easiest path is the [`bootstrap-plugin`](../bootstrap-plugin/README.md) helper, which wraps both the manual publish and `trust:configure --apply` in one guided command:

```bash
pnpm bootstrap-plugin lang-<id>
```

Or, if you prefer to do the steps by hand:

```bash
# 1. (after the initial PR with the new plugin is merged to main, the
#     Changesets Version PR will bump it to 0.1.0 and the Release workflow
#     will TRY to publish via OIDC. That first publish will fail because
#     no Trusted Publisher exists yet.)

# 2. From your local machine, do a one-time manual publish to "create" the
#    package on npm:
cd packages/lang-<id>
npm publish --access public  # accept OTP

# 3. Configure the Trusted Publisher for ALL @reponova/lang-* packages
#    (the new one + any existing ones, idempotent on the existing ones):
cd ../..
pnpm trust:configure --apply

# 4. From this point on, every Release workflow run publishes via OIDC.
```

## Manual fallback

If for any reason the CLI flow fails, you can always configure Trusted Publisher manually via the npmjs.com UI:

1. Go to `https://www.npmjs.com/package/@reponova/lang-<id>/access`
2. Find the **Trusted Publisher** section
3. Click **Add trusted publisher**
4. Provider: **GitHub Actions**
5. Organization: `CristianoCiuti`
6. Repository: `reponova-langs`
7. Workflow filename: `release.yml`
8. Save

Repeat for each package. (This is exactly what the script automates.)
