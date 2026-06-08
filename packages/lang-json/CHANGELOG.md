# @reponova/lang-json

## 0.3.0

### Minor Changes

- e6c20e7: Align official plugins with reponova v0.6 manifest spec.

  - `package.json.keywords` switches to the single canonical token
    `reponova-language` (the legacy `reponova-plugin` / `language-plugin`
    keywords are removed). This is the only keyword now consulted by
    `reponova lang suggest` on the npm registry.
  - `package.json.reponova.extensions[]` is now the single source of truth
    for file extensions. The previously-duplicated `extensions` field on the
    exported `LanguagePlugin` object has been removed — the loader reads
    extensions from the manifest exclusively.
  - `peerDependencies.reponova` bumped to `^0.6.0` (the host release that
    introduced the new manifest validation).

## 0.2.0

### Minor Changes

- 2dd4bba: Generic JSON / JSONC fallback now caps top-level-key extraction at **200** symbols (up from 50). The previous limit was conservative enough to truncate hand-written `eslint.config.json` / `firebase.json` / large `lerna.json` files in real codebases.

  The new limit is also configurable. Callers that consume the plugin programmatically can override it via the `JsonExtractor` constructor:

  ```ts
  import { JsonExtractor } from "@reponova/lang-json";

  const tighter = new JsonExtractor({ maxGenericKeys: 50 }); // restore old behaviour
  const wider = new JsonExtractor({ maxGenericKeys: 1000 });
  const uncapped = new JsonExtractor({ maxGenericKeys: Infinity });
  ```

  The plugin also declares `configDefaults: { maxGenericKeys: 200 }` so the value shows up in `reponova lang list` and is documented for future RepoNova versions that pipe per-plugin config through to extractors.

  The cap only applies to files that fall into the **generic** schema kind — schemas like `package.json`, `tsconfig*`, `nx.json`, `project.json`, `lerna.json`, `turbo.json` are already structured and ignore `maxGenericKeys`.

- de698f3: Initial release of `@reponova/lang-json` — schema-aware JSON / JSONC support for RepoNova.

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
