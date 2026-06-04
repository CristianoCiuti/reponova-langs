---
"@reponova/lang-typescript": patch
---

Add complex/ test tier: a 13-file, ~6.6 k LOC verbatim snapshot of `colinhacks/zod` v3.24.1 `src/`. The snapshot exercises real-world TypeScript with heavy generics, conditional types, class hierarchies, and barrel re-exports, and is wired into Vitest as `tests/complex.test.ts`. Provenance and per-file SHA-256 hashes are recorded in `tests/fixtures/complex/zod-v3.24.1/ATTRIBUTION.md`. No runtime behaviour change; this is a test-coverage uplift only.
