# reponova-langs

Monorepo for official language plugins of [RepoNova](https://github.com/CristianoCiuti/reponova).

Each plugin extends RepoNova's knowledge graph with support for a specific language or asset type and is published independently to npm under the `@reponova/lang-*` scope.

## Packages

| Package | Description | Status |
|---|---|---|
| [`@reponova/lang-python`](./packages/lang-python) | Python (`.py` / `.pyw`, tree-sitter) | Published |
| [`@reponova/lang-javascript`](./packages/lang-javascript) | JavaScript (`.js` / `.mjs` / `.cjs` / `.jsx`, tree-sitter) | Published |
| [`@reponova/lang-typescript`](./packages/lang-typescript) | TypeScript (`.ts` / `.mts` / `.cts`, tree-sitter) | Published |
| [`@reponova/lang-tsx`](./packages/lang-tsx) | TSX / React (`.tsx`, tree-sitter) | Published |
| [`@reponova/lang-json`](./packages/lang-json) | JSON / JSONC with schema-aware extraction for `package.json`, `tsconfig*`, `nx.json`, `project.json`, `lerna.json`, `turbo.json` (jsonc-parser) | Published |
| [`@reponova/lang-plantuml`](./packages/lang-plantuml) | PlantUML diagrams (`.puml` / `.plantuml`, regex) | Published |
| [`@reponova/lang-svg`](./packages/lang-svg) | SVG assets (`.svg`, regex) | Published |

## Install a plugin in your RepoNova project

The fastest path is to let RepoNova suggest the plugins relevant to your repo. Inside a project run:

```bash
reponova lang suggest
```

`lang suggest` scans your sources, queries npm for every package tagged with the `reponova-language` keyword and offers an interactive checkbox to install only the ones you actually need.

If you prefer to install plugins explicitly, the official set is:

```bash
reponova lang add @reponova/lang-python
reponova lang add @reponova/lang-javascript
reponova lang add @reponova/lang-typescript
reponova lang add @reponova/lang-tsx
reponova lang add @reponova/lang-json
reponova lang add @reponova/lang-plantuml
reponova lang add @reponova/lang-svg
```

Each plugin's README documents what it extracts and the available `reponova.yml` configuration.

## Architecture

Every plugin is an independent npm package conforming to the `LanguagePlugin` contract defined by [reponova](https://github.com/CristianoCiuti/reponova). A plugin declares its supported file extensions in `package.json` under `reponova.extensions` — the single source of truth read by both the plugin loader and the registry-side discovery used by `reponova lang suggest`. It optionally ships a tree-sitter `.wasm` grammar bundled inside the published tarball, and exposes an `extractor` that returns symbols, imports, and references for each parsed file.

To be discoverable on the npm registry, a plugin must include `"reponova-language"` in its `package.json` `keywords` — the canonical token consulted by `reponova lang suggest`.

Tree-sitter grammars are pinned by version and SHA-256, downloaded at build time, and re-distributed as part of each plugin's published artefact — consumers never need to manage grammar binaries themselves.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the developer setup, the grammar workflow, the npm trusted-publisher procedure, and the release process.

## License

MIT — see [LICENSE](./LICENSE).
