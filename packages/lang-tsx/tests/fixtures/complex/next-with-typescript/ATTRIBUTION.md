# Third-Party Notice — vercel/next.js `examples/with-typescript` snapshot

This directory contains a verbatim subset of the upstream
[`vercel/next.js`](https://github.com/vercel/next.js) project, pinned at
commit **`84f9247617f91917bfeecd9c6d95b1dedef4a411`** and used **only as a
read-only test fixture** for the `@reponova/lang-tsx` extractor.

- **Upstream**: <https://github.com/vercel/next.js>
- **Commit ref**: `84f9247617f91917bfeecd9c6d95b1dedef4a411`
- **Subpath**: `examples/with-typescript`
- **License**: MIT — see `LICENSE.txt` (verbatim copy of upstream `license.md`)
- **Original copyright**: Copyright (c) 2025 Vercel, Inc.

We make no modifications to the source files. Any failure to parse these
files indicates a regression in our extractor, not in Next.js itself.

## Why a snapshot, not a git submodule?

A submodule would couple our test runner to the network and to the upstream
repository's availability — and `vercel/next.js` is a multi-GB monorepo,
which would slow every CI run to a crawl. A pinned snapshot keeps tests
hermetic and deterministic, with the trade-off that we must manually
refresh the snapshot to pick up newer Next.js examples.

## Snapshot scope

Included: every file under `examples/with-typescript/` of the upstream
commit, except the auto-generated `.gitignore` (which is not load-bearing
for the extractor and would just clutter `_manifest.json`).

Excluded: the rest of the Next.js monorepo (sources, tests, docs,
packaging metadata).

The snapshot focuses on the TSX patterns most representative of real
production Next.js applications:

- functional components typed with explicit prop interfaces
  (`Layout`, `List`, `ListDetail`, `ListItem`)
- `Pages Router` page components using `GetStaticProps` /
  `GetStaticPaths` (`pages/users/[id].tsx`, `pages/users/index.tsx`)
- Next.js `Link` / `Head` JSX usage in real layouts
- typed sibling `.ts` modules used as imports
  (`interfaces/index.ts`, `utils/sample-data.ts`)
- a typed API route (`pages/api/users/index.ts`) — exercised only as an
  import target by the `.tsx` files, since the `lang-tsx` plugin only
  binds to `.tsx`.

## File integrity

Every file in this directory was downloaded over HTTPS from
`raw.githubusercontent.com/vercel/next.js/<commit>/examples/with-typescript/...`
and re-hashed with SHA-256 for storage in `_manifest.json`. Line endings
are pinned to LF via `.gitattributes` so SHA-256 hashes hold regardless
of `core.autocrlf` settings on the consumer machine.

To re-verify integrity locally:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const m = JSON.parse(readFileSync('_manifest.json', 'utf8'));
for (const e of m.files) {
  const data = readFileSync(e.path);
  const actual = createHash('sha256').update(data).digest('hex');
  if (actual !== e.sha256) { console.error('FAIL', e.path); process.exit(1); }
  console.log('OK', e.path);
}
"
```

## File index

| File | Size (B) |
|---|---:|
| `components/Layout.tsx` | 774 |
| `components/List.tsx` | 324 |
| `components/ListDetail.tsx` | 282 |
| `components/ListItem.tsx` | 288 |
| `interfaces/index.ts` | 273 |
| `LICENSE.txt` | 1079 |
| `package.json` | 390 |
| `pages/about.tsx` | 304 |
| `pages/api/users/index.ts` | 448 |
| `pages/index.tsx` | 285 |
| `pages/users/[id].tsx` | 1714 |
| `pages/users/index.tsx` | 992 |
| `README.md` | 2254 |
| `tsconfig.json` | 529 |
| `utils/sample-data.ts` | 226 |

Total: 15 files, ~10 KB. Per-file SHA-256 hashes live in `_manifest.json`.
