# @reponova/lang-json

Schema-aware JSON / JSONC support for [RepoNova](https://github.com/CristianoCiuti/reponova). Goes well beyond a "treat every key as a node" generic JSON extractor: it recognises the canonical configuration files of the JavaScript / TypeScript ecosystem and surfaces them as first-class graph entities so monorepo dependency graphs, script catalogs and Nx project topologies all show up in the knowledge graph.

## Install

```bash
reponova lang add @reponova/lang-json
```

Then in `reponova.yml`:

```yaml
plugins:
  json:
    enabled: true
```

## Supported file shapes

| File pattern | Schema kind | Surfaces |
|---|---|---|
| `package.json` | `package` | `name` constant, `description` as docstring, every `scripts.*` as a function symbol with the command in its docstring, every `bin` entry as a function symbol, every dependency (runtime / dev / peer / optional) as an import edge with version-spec metadata, `workspaces` (array form **and** `{ packages: [...] }` form) as wildcard imports, file-level tags (`private`, `workspaces`). |
| `tsconfig*.json` (`tsconfig.json`, `tsconfig.base.json`, `tsconfig.spec.json`, …) | `tsconfig` | `extends` (string form **and** TS 5.0 array form) as imports, `references[].path` as imports, `compilerOptions.paths.<alias>` expanded into one import per target with the alias as the import name, file-level tags (`extends`, `project-references`). |
| `nx.json` | `nx` | `targetDefaults.<name>` as function symbols (executor / command in the docstring), `namedInputs.<name>` as variable symbols, `plugins[]` as imports (string and `{ plugin, options }` forms), `generators.*` as imports. |
| `project.json` | `project` | Project `name` as the file label, `projectType` as a tag (`nx-application` / `nx-library`), `targets.<name>` as function symbols, `tags[]` as variable symbols (so Nx scope rules like `scope:auth` / `type:lib` become graph facets), `implicitDependencies[]` as graph references. |
| `lerna.json` | `lerna` | `packages[]` as wildcard workspace imports. |
| `turbo.json` | `turbo` | `pipeline.*` (Turbo 1) **and** `tasks.*` (Turbo 2) as function symbols, `extends[]` as imports. |
| any other `.json` / `.jsonc` | `generic` | `description` as docstring (when present) and the top-level keys as variable symbols (capped at 50 to avoid graph explosion). |

JSONC syntax — `//` line comments, `/* … */` block comments, trailing commas — is supported transparently for every file type via Microsoft's [`jsonc-parser`](https://github.com/microsoft/node-jsonc-parser) (the same parser used by VS Code and TypeScript's tsconfig loader).

## What it extracts

- **File-level node kind**: `module`. Every recognised JSON file becomes a `module` graph node — that's how it shows up in `graph_search`, `path_finder` and `node_detail` calls alongside source files.
- **Symbol kinds**: `function` (npm scripts, npm `bin` entries, Nx `targets`, Nx `targetDefaults`, Turbo tasks), `constant` (the package's name), `variable` (Nx `namedInputs`, Nx `tags`, generic JSON top-level keys).
- **Imports**: `dependencies` / `devDependencies` / `peerDependencies` / `optionalDependencies` (each carries the version range in `names[0]` as `<dep>@<spec>`), tsconfig `extends` and `references[].path`, `compilerOptions.paths` aliases (the alias is preserved in `names[0]`), workspace globs (`isWildcard: true, isExport: true`), Nx `plugins[]` and `generators.*`, Turbo `extends[]`.
- **References**: Nx `implicitDependencies[]` as `references` edges from project to project.

## Path resolution

`resolveImportPath()` understands tsconfig-style relative specs:

- `"./foo.json"` from `apps/web/tsconfig.json` → `apps/web/foo.json`.
- `"../shared/base"` from `apps/web/tsconfig.json` → `apps/shared/base.json` (the `.json` extension is appended when missing).
- `"./libs/core"` → also offers the implicit `libs/core/tsconfig.json` candidate so directory-style references resolve to the directory's tsconfig.
- Bare specifiers (`@tsconfig/node20/tsconfig.json`, `@scope/pkg`) return an empty list — the upstream `node_modules` resolver takes over.

## Limitations

- Comments inside JSON files are intentionally NOT preserved as docstrings. Only `description` fields and per-script command bodies are surfaced.
- Generic JSON files cap at the first 50 top-level keys per file. Documents larger than that (large seed lists, fixtures, vendored data) will only have their first 50 keys appear as variable symbols.
- The path resolver does not perform `node_modules` walks or workspace alias resolution. That's the responsibility of RepoNova's upstream import resolver, which receives the unresolved spec and walks accordingly.

## Why a dedicated plugin?

Without a JSON-aware extractor, RepoNova would miss the entire dependency edges of a JS/TS repo: there would be no node connecting your project to `react`, no project-references graph for `tsconfig`-driven monorepos, and no way to ask "which Nx project has the `scope:auth` tag?". This plugin fills that gap with the smallest possible API surface.

## Source

This plugin is developed in the [`reponova-langs`](https://github.com/CristianoCiuti/reponova-langs) monorepo. See `packages/lang-json` for the source and `tests/fixtures/` for the simple / medium / complex fixtures that exercise every schema kind end-to-end.
