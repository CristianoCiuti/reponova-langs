# @reponova/lang-json

JSON / JSONC support for [RepoNova](https://github.com/CristianoCiuti/reponova). Schema-aware: recognises the canonical configuration files of the JS/TS ecosystem (`package.json`, `tsconfig*`, `nx.json`, `project.json`, `lerna.json`, `turbo.json`) and surfaces them as first-class graph entities. Falls back to a generic top-level-keys-as-symbols extraction for everything else. Backed by Microsoft's [`jsonc-parser`](https://github.com/microsoft/node-jsonc-parser) — no tree-sitter grammar required, JSONC syntax (`//` line comments, `/* … */` block comments, trailing commas) is supported transparently for every file shape.

## Install

```bash
reponova lang add @reponova/lang-json
```

## What it extracts

- **Symbols**:
  - **`package.json`** — the package's `name` as a `constant` (so `graph_search` against the package name resolves to the file), every `scripts.*` as a `function` (the shell command becomes the docstring), every `bin` entry (string AND map form) as a `function`.
  - **`tsconfig*.json`** — surfaces structural metadata only via `imports` / file-level tags; no per-key symbol noise.
  - **`nx.json`** — `targetDefaults.*` as `function` symbols (executor / command in the docstring), `namedInputs.*` as `variable` symbols.
  - **`project.json`** (Nx) — `targets.*` as `function` symbols (executor / command in docstring), `tags[]` as `variable` symbols (so Nx scope rules like `scope:auth` / `type:lib` become graph facets).
  - **`turbo.json`** — `pipeline.*` (Turbo 1) AND `tasks.*` (Turbo 2) as `function` symbols.
  - **Generic JSON / JSONC** (anything that doesn't match a known schema) — top-level keys as `variable` symbols, capped to the configured `maxGenericKeys` (default `200`, see Configuration).
- **Decorators**: every symbol carries a single decorator describing its provenance — `npm-script`, `npm-bin`, `package-name`, `nx-target`, `nx-target-default`, `nx-named-input`, `nx-tag`, `turbo-task`, `json-key`. This lets downstream queries filter by source schema.
- **Edges**:
  - **Imports**: `dependencies` / `devDependencies` / `peerDependencies` / `optionalDependencies` from `package.json` (each carries `<dep>@<spec>` in `names[0]`); tsconfig `extends` (string AND TS 5.0 array form) and `references[].path`; `compilerOptions.paths.<alias>` expanded into one import per target with the alias preserved in `names[0]` (wildcard aliases carry `isWildcard: true`); npm `workspaces` (array form AND `{ packages: [...] }` form), `lerna.json` `packages[]`, and `turbo.json` `extends[]`; Nx `plugins[]` (string AND `{ plugin, options }` forms) and `generators.*`.
  - **References**: Nx `project.json` `implicitDependencies[]` as `references` edges from the project to each declared dependency.
- **File docstring**: the package / generic-JSON `description` field, when present.
- **File-level tags**: `package.json` (always), `private` and `workspaces` (when set on a `package.json`); `tsconfig`, `extends`, `project-references`; `nx`, `monorepo`; `nx-project`, `nx-application` / `nx-library`; `lerna`, `turborepo`; plain `json` for the generic fallback.
- **File node kind**: `module`.

## Extensions

`.json`, `.jsonc`

The schema kind is detected from the basename (case-insensitive, Windows path separators normalised). Custom-suffix `tsconfig` files (`tsconfig.spec.json`, `tsconfig.lib.json`, `tsconfig.<anything>.json`) are recognised as `tsconfig`.

## Configuration

In `reponova.yml`:

```yaml
plugins:
  json:
    enabled: true                # default: true
    maxGenericKeys: 200          # default: 200 — cap on generic-fallback symbols per file
    # patterns: []               # override global patterns for JSON files
    # exclude: []                # override global exclude for JSON files
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable JSON file detection and extraction |
| `maxGenericKeys` | number | `200` | Cap on top-level keys surfaced as `variable` symbols for files that fall into the **generic** fallback (no recognised schema). Stops large data dumps / translation tables / lookup files from creating thousands of nodes. The cap does NOT apply to schema-recognised files (`package.json`, `tsconfig*`, `nx.json`, `project.json`, …) which are already structured. Set to a large number (or `Infinity`) to disable. |
| `patterns` | string[] | `[]` | Glob patterns to override global file matching for this plugin |
| `exclude` | string[] | `[]` | Glob patterns to override global exclusions for this plugin |

`maxGenericKeys` is also accepted as a constructor option for callers that consume the plugin programmatically:

```ts
import { JsonExtractor } from "@reponova/lang-json";

const ext = new JsonExtractor({ maxGenericKeys: 500 });   // raise the cap
// or
const ext = new JsonExtractor({ maxGenericKeys: Infinity }); // disable entirely
```

## Resolution semantics

- Relative tsconfig-style specs (`extends`, `references[].path`, `paths` aliases) resolve against the importing file's directory: `"./foo.json"` from `apps/web/tsconfig.json` → `apps/web/foo.json`. Path traversal (`../`) and `./` are normalised.
- The `.json` extension is appended when the spec lacks one: `"../shared/base"` from `apps/web/tsconfig.json` → `apps/shared/base.json`.
- Directory-style references (`"./libs/core"`) also offer the implicit `libs/core/tsconfig.json` candidate so directory-style references resolve to the directory's tsconfig.
- Bare specifiers (`react`, `@tsconfig/node20/tsconfig.json`, workspace package names) return `[]` and are treated as external. `node_modules` walks, `package.json` `exports` field rewriting, and workspace alias resolution are deliberately delegated to RepoNova's upstream import resolver — this plugin only handles relative-path semantics.
- The `bin` field on `package.json` accepts both the single-string form (`"bin": "./cli.js"` — the synthesised symbol takes the package's short name) and the map form (`"bin": { "tool-a": "./a.js", "tool-b": "./b.js" }` — one symbol per entry).
- The `private` flag on `package.json` is recognised as both the canonical JSON boolean (`"private": true`) and the legacy string form (`"private": "true"`) some hand-edited files use.
- Comments inside JSON files are NOT preserved as symbol docstrings — only the structured `description` / per-script command body fields are surfaced. Trailing commas and JSONC comments do not break parsing in any file (including `package.json`, although strict tooling like npm itself does not accept them there).
- The schema-detection step is filename-only: a `package.json` placed at `/data/package.json` is still extracted as a package even if its content is not a real npm manifest. If the content is malformed JSON, the parser tolerates partial recovery and the extractor surfaces whatever it could parse without throwing.

## License

MIT — see [LICENSE](./LICENSE).
