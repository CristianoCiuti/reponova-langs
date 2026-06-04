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
pnpm typecheck
pnpm build
pnpm test
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
