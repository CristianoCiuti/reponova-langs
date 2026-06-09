---
"@reponova/lang-json": minor
---

Honour `maxGenericKeys` from `reponova.yml` at runtime.

Until now the `configDefaults: { maxGenericKeys: 200 }` declared by the plugin was inert with respect to the YAML config: `reponova lang add` wrote it into `reponova.yml`, but the plugin loader instantiated `new JsonExtractor()` with no arguments, and the value never reached the extractor. The knob was effectively reachable only via the programmatic constructor option.

RepoNova `0.7.0` introduces per-plugin config threading — the loader merges `configDefaults` with the user's `plugins.json` block and forwards the result as the new optional 4th argument of `LanguageExtractor.extract()`. This release wires `JsonExtractor.extract()` against that argument:

```typescript
// reponova.yml
plugins:
  json:
    maxGenericKeys: 50    // → finally honoured

// programmatic use — unchanged, still works as a fallback
new JsonExtractor({ maxGenericKeys: 50 });
```

Effective-cap precedence (highest first):

1. `pluginConfig.maxGenericKeys` (call-site value from `reponova.yml` or the merged `configDefaults` baseline of `200`)
2. Constructor option (only used when the call-site value is absent or invalid — kept for programmatic consumers)
3. `DEFAULT_MAX_GENERIC_KEYS` (`200`)

Invalid values (non-numeric, negative, `NaN`) at any tier fall through to the next one rather than disabling the cap.

`peerDependencies.reponova` is bumped from `^0.6.0` to `^0.7.0` — the new behaviour relies on the 4-arg `extract()` signature shipped in `reponova@0.7.0`. No source-level breaking change: the schema-aware path (`package.json`, `tsconfig*`, `nx.json`, `project.json`, `lerna.json`, `turbo.json`) does not consult `maxGenericKeys` and is unaffected.
