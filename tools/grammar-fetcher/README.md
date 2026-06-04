# `@reponova/grammar-fetcher`

Internal build-time tool that downloads pinned tree-sitter `.wasm` grammars from upstream GitHub releases, verifies their SHA-256, and writes them into the consuming plugin under `packages/<package>/grammars/`.

The grammars are **not** committed to git. They _are_ included in the npm tarball of each plugin (declared via `"files": ["dist", "grammars", ...]` in the plugin's `package.json`), populated by the `prebuild` hook before `tsup` runs.

## Why

- **Reproducibility**: each grammar is pinned to an upstream tag + SHA-256. The manifest is the single source of truth.
- **Lean repo**: no binary blobs in git history. Bumping a grammar is a small text-only PR (manifest update).
- **Tamper-evident**: the fetcher refuses to write a download whose SHA-256 does not match the manifest.

## Usage

From the workspace root:

```bash
pnpm grammar-fetch                       # fetch all grammars (skip up-to-date)
pnpm grammar-fetch --package=lang-python # fetch only one plugin's grammars
pnpm grammar-fetch --check               # verify on disk; exit 1 on mismatch
pnpm grammar-fetch --force               # always re-download
```

Plugin packages with a grammar should declare a `prebuild` and `pretest` hook so local builds and tests pull the wasm transparently:

```jsonc
{
  "scripts": {
    "prebuild": "pnpm -w grammar-fetch --package=lang-python",
    "pretest": "pnpm -w grammar-fetch --package=lang-python"
  }
}
```

## Manifest

`tools/grammar-fetcher/grammars.json` lists every grammar:

```jsonc
{
  "grammars": [
    {
      "id": "tree-sitter-python",
      "package": "lang-python",
      "filename": "tree-sitter-python.wasm",
      "source": {
        "type": "github-release",
        "owner": "tree-sitter",
        "repo": "tree-sitter-python",
        "tag": "v0.25.0",
        "asset": "tree-sitter-python.wasm"
      },
      "sha256": "16108b50df4ee9a30168794252ab55e7c93bfc5765d7fa0aa3e335752c515f47",
      "size": 457883
    }
  ]
}
```

### Adding a new grammar

1. Find the upstream release of `tree-sitter-<lang>` that ships a prebuilt `.wasm` asset
2. Download the asset and compute its SHA-256:
   ```bash
   curl -L -o /tmp/x.wasm https://github.com/tree-sitter/tree-sitter-<lang>/releases/download/<tag>/tree-sitter-<lang>.wasm
   sha256sum /tmp/x.wasm
   wc -c /tmp/x.wasm
   ```
3. Add an entry to `grammars.json`
4. Run `pnpm grammar-fetch --package=lang-<lang>` and verify it succeeds

### Bumping a grammar

Update the `tag`, `sha256`, and `size` fields in the manifest. Verify locally with `pnpm grammar-fetch --force --package=lang-<lang>`. Open a PR with a changeset for the affected plugin.
