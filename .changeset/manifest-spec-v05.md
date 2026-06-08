---
"@reponova/lang-python": minor
"@reponova/lang-javascript": minor
"@reponova/lang-typescript": minor
"@reponova/lang-tsx": minor
"@reponova/lang-json": minor
"@reponova/lang-plantuml": minor
"@reponova/lang-svg": minor
---

Align official plugins with reponova v0.5 manifest spec.

- `package.json.keywords` switches to the single canonical token
  `reponova-language` (the legacy `reponova-plugin` / `language-plugin`
  keywords are removed). This is the only keyword now consulted by
  `reponova lang suggest` on the npm registry.
- `package.json.reponova.extensions[]` is now the single source of truth
  for file extensions. The previously-duplicated `extensions` field on the
  exported `LanguagePlugin` object has been removed — the loader reads
  extensions from the manifest exclusively.
- `peerDependencies.reponova` bumped to `^0.5.0` (the host release that
  introduced the new manifest validation).
