---
"@reponova/lang-json": minor
---

Generic JSON / JSONC fallback now caps top-level-key extraction at **200** symbols (up from 50). The previous limit was conservative enough to truncate hand-written `eslint.config.json` / `firebase.json` / large `lerna.json` files in real codebases.

The new limit is also configurable. Callers that consume the plugin programmatically can override it via the `JsonExtractor` constructor:

```ts
import { JsonExtractor } from "@reponova/lang-json";

const tighter = new JsonExtractor({ maxGenericKeys: 50 });   // restore old behaviour
const wider   = new JsonExtractor({ maxGenericKeys: 1000 });
const uncapped = new JsonExtractor({ maxGenericKeys: Infinity });
```

The plugin also declares `configDefaults: { maxGenericKeys: 200 }` so the value shows up in `reponova lang list` and is documented for future RepoNova versions that pipe per-plugin config through to extractors.

The cap only applies to files that fall into the **generic** schema kind — schemas like `package.json`, `tsconfig*`, `nx.json`, `project.json`, `lerna.json`, `turbo.json` are already structured and ignore `maxGenericKeys`.
