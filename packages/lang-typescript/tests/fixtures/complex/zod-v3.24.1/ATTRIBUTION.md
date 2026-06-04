# Third-Party Notice — zod v3.24.1 snapshot

This directory contains a verbatim subset of the upstream
[`colinhacks/zod`](https://github.com/colinhacks/zod) project, pinned at tag
**`v3.24.1`** and used **only as a read-only test fixture** for the
`@reponova/lang-typescript` extractor.

- **Upstream**: <https://github.com/colinhacks/zod>
- **Commit ref**: `v3.24.1`
- **License**: MIT — see `LICENSE` (verbatim copy of upstream `LICENSE`)
- **Original copyright**: Copyright (c) 2020 Colin McDonnell

We make no modifications to the source files. Any failure to parse these
files indicates a regression in our extractor, not in zod itself.

## Why a snapshot, not a git submodule?

A submodule would couple our test runner to the network and to the upstream
repository's availability. A pinned snapshot keeps tests hermetic and
deterministic, with the trade-off that we must manually refresh the snapshot
to pick up newer zod versions. Refreshes go through the same
`tools/grammar-fetcher`-style verification flow.

## Snapshot scope

Included: all `.ts` files under `src/` **except** `__tests__/` and
`benchmarks/`. The snapshot focuses on production runtime code that is
representative of "complex" TypeScript (heavy generics, conditional types,
class hierarchies, type-only imports/exports).

Excluded: tests (use upstream's own infra), benchmarks (not part of the
public API surface), package metadata.

## File integrity

Every file in this directory was downloaded over HTTPS from
`raw.githubusercontent.com/colinhacks/zod/v3.24.1/...`, verified against
the git blob SHA-1 published by the GitHub Trees API, and re-hashed with
SHA-256 for storage in `_manifest.json`.

To re-verify integrity locally:

```bash
python3 -c "
import hashlib, json
with open('_manifest.json') as f: m = json.load(f)
for entry in m['files']:
    with open(entry['path'], 'rb') as h: data = h.read()
    actual = hashlib.sha256(data).hexdigest()
    assert actual == entry['sha256'], entry['path']
    print('OK', entry['path'])
"
```

## File index

| File | Size | SHA-256 |
|---|---:|---|
| `src/ZodError.ts` | 8909 | `fdc5a8114a138f8eda17d58a83dc9f46c2db885397c953da3c86069e90326612` |
| `src/errors.ts` | 299 | `c744e98e5586c29dbebddd9bab6b46886e67e313321793edabc3106ec7c7c438` |
| `src/external.ts` | 187 | `f5ef066942e4f0bd98200aa6a6694b831e73200c9b3ade77ad0aa2409e8fe1b1` |
| `src/helpers/enumUtil.ts` | 612 | `54efc393cc9860e687d8b81ff52e980def00fa67377ad0bf8b3104f8a5bf698c` |
| `src/helpers/errorUtil.ts` | 338 | `7a77328240be7b847af6de9189963bd9f79cab32bbc61502a9db4fe6683e2ea7` |
| `src/helpers/parseUtil.ts` | 5323 | `2d8d845fbeb48634ea926223d530fdcef141ea5c9e97cbd3abe030e0832e2c24` |
| `src/helpers/partialUtil.ts` | 2579 | `45ea3afb272487961758dac5c37d53df741804d389dfc62e048ebccd4eea15ed` |
| `src/helpers/typeAliases.ts` | 151 | `0fda31a063c6736fc3cf9090dd94865c811dfff4f3cb8707b932bf937c6f2c3e` |
| `src/helpers/util.ts` | 5625 | `30c273131661ca5dc973f2cfb196fa23caf3a43e224cdde7a683b72e101a31fc` |
| `src/index.ts` | 93 | `b9e99cd94f4166a245f5158f7286c05406e2a4c694619bceb7a4f3519d1d768e` |
| `src/locales/en.ts` | 5228 | `5e32b6ce594b5b09ab73612e4a008143b7f5dfda5850b4922292ff76e78bfa29` |
| `src/standard-schema.ts` | 2706 | `4abb2e7bd784fb95d219584673971bb317e74fb4fd0c74c196b558ba46df4456` |
| `src/types.ts` | 160050 | `aa45bac361c1c287ca379aa0391fad2a6af9f0355b79ec13f3f50cc9faac321b` |

Total: 13 files, ~6620 LOC, ~187 KB.
