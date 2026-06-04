# reponova-langs

Monorepo for official language plugins of [RepoNova](https://github.com/CristianoCiuti/reponova).

Each plugin extends RepoNova's knowledge graph with support for a specific language or asset type and is published independently to npm under the `@reponova/lang-*` scope.

## Packages

| Package | Description | Status |
|---|---|---|
| [`@reponova/lang-python`](./packages/lang-python) | Python (tree-sitter) | Published |
| [`@reponova/lang-plantuml`](./packages/lang-plantuml) | PlantUML diagrams (regex) | Published |
| [`@reponova/lang-svg`](./packages/lang-svg) | SVG assets (regex) | Published |

Internal (not published):

| Package | Description |
|---|---|
| `@reponova/lang-test-utils` | Shared test helpers |
| `@reponova/scaffold` | Plugin scaffolding CLI |

## Development

Requirements: Node `>=18`, pnpm `9`.

```bash
pnpm install
pnpm grammar-fetch    # download tree-sitter .wasm grammars (one-time per clone / per bump)
pnpm typecheck
pnpm build
pnpm test
```

The `prebuild` and `pretest` hooks of plugins that ship a grammar (e.g. `lang-python`) call `grammar-fetch` automatically, so running `pnpm build` or `pnpm test` from a fresh clone also works without an explicit fetch step.

### Grammars

Tree-sitter `.wasm` grammars are **not committed to git**. They are pinned (version + SHA-256) in [`tools/grammar-fetcher/grammars.json`](./tools/grammar-fetcher/grammars.json), downloaded from upstream GitHub releases at build time, and bundled into each plugin's published npm tarball under `grammars/`.

See [`tools/grammar-fetcher/README.md`](./tools/grammar-fetcher/README.md) for adding or bumping a grammar.

### npm Trusted Publisher (OIDC)

Each `@reponova/lang-*` package on npmjs.com is configured with a GitHub Actions OIDC Trusted Publisher pointing at `release.yml` in this repo. There are no long-lived `NPM_TOKEN` secrets in CI.

Adding a new plugin to npm requires a one-time setup (first manual publish + `pnpm trust:configure --apply`). See [`tools/trust-configure/README.md`](./tools/trust-configure/README.md) for the end-to-end procedure.

```bash
pnpm trust:configure          # dry-run: list packages, show npm trust commands
pnpm trust:configure --apply  # actually configure (requires npm login + npm >= 11.10.0)
```

### Scaffold a new plugin

```bash
pnpm scaffold lang-<id>
```

### Release

Releases are managed via [Changesets](https://github.com/changesets/changesets).

```bash
pnpm changeset           # describe a change
pnpm version-packages    # apply version bumps locally
# push to `main` -> GitHub Actions publishes via changesets/action
```

## Architecture

Plugins are independent npm packages conforming to the `LanguagePlugin` interface defined in [reponova](https://github.com/CristianoCiuti/reponova).

## License

MIT. See [LICENSE](./LICENSE).
