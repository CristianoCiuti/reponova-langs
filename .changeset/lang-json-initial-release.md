---
"@reponova/lang-json": minor
---

Initial release of `@reponova/lang-json` — schema-aware JSON / JSONC support for RepoNova.

The plugin recognises the canonical configuration files of the JS/TS ecosystem and surfaces them as first-class graph entities:

- `package.json` → npm scripts as functions, `bin` entries as functions, every dep (runtime/dev/peer/optional) as an import edge with version-spec metadata, `workspaces` (array form **and** object form) as wildcard imports, file-level tags (`private`, `workspaces`).
- `tsconfig*.json` → `extends` (string form **and** TS 5.0 array form) as imports, `references[].path` as imports, `compilerOptions.paths` aliases expanded into one import per target with the alias preserved, file-level tags (`extends`, `project-references`).
- `nx.json` → `targetDefaults.*` as functions, `namedInputs.*` as variables, `plugins[]` and `generators.*` as imports.
- `project.json` (Nx) → `targets.*` as functions, `tags[]` as variables (so Nx scope rules become graph facets), `implicitDependencies[]` as graph references, `projectType` as a tag.
- `lerna.json`, `turbo.json` → workspace globs and pipeline / tasks surfaced as appropriate.
- Generic JSON / JSONC → `description` as docstring + first 50 top-level keys as variable symbols (capped to avoid graph explosion).

JSONC syntax (`//` line comments, `/* … */` block comments, trailing commas) is supported transparently for every file shape via Microsoft's [`jsonc-parser`](https://github.com/microsoft/node-jsonc-parser) — the same parser VS Code and TypeScript's tsconfig loader use.

`resolveImportPath()` understands tsconfig-style relative specs and offers the implicit `<dir>/tsconfig.json` candidate so directory-style references resolve correctly. Bare specifiers delegate to RepoNova's upstream `node_modules` resolver.

The plugin clears every quality gate introduced in the previous tooling PR: 99.81% line coverage on `src/extractor.ts` (well above the 80% bar) and an 18 KB `dist/index.js` (well under the 50 KB ceiling).
