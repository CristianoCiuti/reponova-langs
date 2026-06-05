---
"@reponova/lang-typescript": patch
---

Internal refactor: the `TypescriptExtractor` and outline implementation move to the workspace-internal `@reponova/lang-typescript-core` package and are now bundled inline at publish time. Public API and on-the-wire tarball contents are unchanged for consumers; the extractor is now parameterizable so it can be reused as-is by the upcoming `@reponova/lang-tsx` sibling plugin.
