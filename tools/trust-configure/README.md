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
| Permission | `--allow-publish` (required since 2026-05-20) |

After this runs once, the `release.yml` workflow can publish each package via OIDC, with **no `NPM_TOKEN` secret** required.

## Prerequisites

1. **npm CLI >= 11.15.0** — required by the npm registry. The `permissions` field on the trust payload (added in [`npm/cli#9248`](https://github.com/npm/cli/pull/9248), released in npm 11.15.0 on 2026-05-20) is now mandatory; older CLIs send an empty `permissions` array and the registry rejects every call with `400 "permissions is required and must contain at least one valid route"`. Check / upgrade with:
   ```bash
   npm --version
   # if older:
   npm install -g npm@latest
   ```
2. **Logged in to npm**: `npm login`
3. **2FA in "auth-and-writes" mode**. Every call to the trust **write** endpoint (`POST /-/package/<pkg>/trust`) triggers a fresh webauth handshake on its own — the "skip 2FA for the next 5 minutes" toggle bypass applies only to the **read** endpoint (`GET …/trust`, used by the fast-path `npm trust list`). So you'll need your security key handy for each newly-configured package (\~10 seconds each).
4. **Package already exists on npm**: Trusted Publisher can only be configured on existing packages. For a brand-new plugin, do **one** manual `npm publish` (with OTP) of the initial version first, then run this tool.
5. **An interactive terminal (real TTY)** for `--apply`. The script wraps `npm trust github` in a [`node-pty`](https://github.com/microsoft/node-pty) pseudo-terminal so the npm CLI's webauth handler sees a genuine TTY (`isatty()` returns true on stdin/stdout) and can read your OTP. Without a real TTY (CI sandbox, headless cron, IDE shells that proxy stdin without exposing a TTY) the script bails out cleanly with the exact `npm trust github …` command you can paste into a real shell — never crashes. Dry-run (`pnpm trust:configure` without `--apply`) does not need a TTY.

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

- Discovers every non-private `@reponova/lang-*` package via `packages/*/package.json`.
- For each package, performs a **best-effort** fast-path skip via `npm trust list <pkg> --json`. The npm registry's trust-read endpoint also requires OTP, so this only succeeds while you are inside a recent webauth cooldown — when it does succeed it skips already-configured packages with zero security-key taps.
- Otherwise runs `npm trust github <pkg> --repo CristianoCiuti/reponova-langs --file release.yml --allow-publish --yes` **inside a `node-pty` pseudo-terminal** (see "Why a PTY?" below). Stdin (raw mode), stdout, terminal resize and SIGINT are forwarded between your real terminal and the PTY, so the webauth prompt behaves exactly as if you'd typed the command yourself.
- If the spawn fails, performs a **post-mortem read** via the same `npm trust list`. If the trust is now there, the spawn's failure was a `409 Conflict` (the canonical "this trust already exists" signal) and the package is classified as **skipped**, never as a failure.
- Sleeps 2 seconds between calls (npm registry rate-limit friendly).
- Reports a `ok / skipped / failed` summary and exits non-zero only if any package failed.

The combination is **fully idempotent**: re-running it on a fully-configured monorepo always reports `0 ok, N skipped, 0 failed` and exits 0, regardless of whether you are inside the OTP cooldown or not.

## Why a PTY?

`npm trust github` performs a webauth-style 2FA challenge that requires a real TTY on stdin/stdout. Earlier versions of this tool spawned npm via `child_process.spawnSync('npm', …, { stdio: ['inherit','inherit','pipe'], shell: true })`. On Windows that interposes `cmd.exe /c npm.cmd …` and pipes stderr to a non-TTY pipe; the moment the registry demanded a fresh OTP, the npm CLI's webauth handler crashed with `STATUS_STACK_BUFFER_OVERRUN` (exit code `3221226505` = `0xC0000409`), leaving the first-publish flow stuck.

[`node-pty`](https://github.com/microsoft/node-pty) allocates a real pseudo-terminal (ConPTY on Windows ≥ 10 1809, `pty.h` on POSIX) and gives the child npm process a genuine TTY pair to talk to. Webauth's `isatty()` checks succeed and the 2FA handshake completes the same way it does in a hand-typed `npm trust github`. The PTY is loaded **lazily** (dynamic `import('node-pty')` only when we need the write path), so the dry-run never touches the native binding.

The fast-path `npm trust list` and the post-mortem read remain on plain `child_process.spawnSync` because they're non-interactive and either succeed silently or fall through.

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
