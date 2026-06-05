# Third-Party Notice — expressjs/express `lib/` snapshot

This directory contains a verbatim subset of the upstream
[`expressjs/express`](https://github.com/expressjs/express) project, pinned
at tag **`v5.0.1`** (commit `d14b2de782c16fbef39541c9009b01bd6ae90b92`,
released 2025-04-20) and used **only as a read-only test fixture** for the
`@reponova/lang-javascript` extractor.

- **Upstream**: <https://github.com/expressjs/express>
- **Tag**: `v5.0.1`
- **Commit ref**: `d14b2de782c16fbef39541c9009b01bd6ae90b92`
- **Subpath**: `lib/`
- **License**: MIT — see [`LICENSE.txt`](./LICENSE.txt) (verbatim copy of upstream `LICENSE`)
- **Original copyright**:
  - Copyright (c) 2009-2014 TJ Holowaychuk
  - Copyright (c) 2013-2014 Roman Shtylman
  - Copyright (c) 2014-2015 Douglas Christopher Wilson

We make **no modifications** to the source files. Any failure to parse
these files indicates a regression in our extractor, not in Express itself.

## Why a snapshot, not a git submodule?

A submodule would couple our test runner to the network and to the upstream
repository's availability. A pinned snapshot keeps tests hermetic and
deterministic, with the trade-off that we must manually refresh the
snapshot to pick up newer Express releases.

## Snapshot scope

Included: every file under `lib/` of the pinned commit.

  - `lib/application.js` — the `app` prototype with route methods, settings, and middleware mounting (large CommonJS-heavy file, exercises prototype-based class semantics)
  - `lib/express.js` — the `express()` factory and module entry
  - `lib/request.js` — `req` prototype extending `http.IncomingMessage`
  - `lib/response.js` — `res` prototype extending `http.ServerResponse` (largest file in the snapshot)
  - `lib/utils.js` — internal utility functions
  - `lib/view.js` — the `View` class

Excluded: nothing under `lib/`. Express 5.x does not ship a `lib/router/`
folder anymore — the routing layer was extracted to the dedicated
[`router`](https://github.com/pillarjs/router) package.

## Why Express 5.x?

`expressjs/express` is the canonical CommonJS Node.js library: 95+% of all
real-world JavaScript backend codebases share its idioms (`var x = require`
at the top, prototype-based "classes" via `app.prototype.method = …`,
`module.exports = factory`, internal `this.app = …` fields, mixed
`module.exports` + named exports). v5.x is the current stable line and the
default choice for new Express projects since 2024.

## Refreshing the snapshot

To pin a newer Express release:

```bash
REF=$(curl -sSf "https://api.github.com/repos/expressjs/express/git/refs/tags/v<NEW>" | jq -r '.object.sha')
# Then refetch each lib/* file from raw.githubusercontent.com/expressjs/express/$REF/lib/<file>
# and recompute the SHA-256 hashes for _manifest.json.
```

The complex-fixture test (`tests/complex.test.ts`) fails loudly if any
SHA-256 in `_manifest.json` no longer matches the on-disk file, so a
partial / corrupted refresh cannot silently slip into the test suite.
