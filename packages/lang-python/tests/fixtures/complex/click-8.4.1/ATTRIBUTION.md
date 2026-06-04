# Third-Party Notice — pallets/click 8.4.1 snapshot

This directory contains a verbatim subset of the upstream
[`pallets/click`](https://github.com/pallets/click) project, pinned at tag
**`8.4.1`** and used **only as a read-only test fixture** for the
`@reponova/lang-python` extractor.

- **Upstream**: <https://github.com/pallets/click>
- **Commit ref**: `8.4.1`
- **License**: BSD-3-Clause — see `LICENSE.txt` (verbatim copy of upstream `LICENSE.txt`)
- **Original copyright**: Copyright 2014 Pallets

We make no modifications to the source files. Any failure to parse these
files indicates a regression in our extractor, not in click itself.

## Why a snapshot, not a git submodule?

A submodule would couple our test runner to the network and to the upstream
repository's availability. A pinned snapshot keeps tests hermetic and
deterministic, with the trade-off that we must manually refresh the snapshot
to pick up newer click versions.

## Snapshot scope

Included: every `.py` file under `src/click/` of the upstream tag.
Excluded: tests, docs, packaging metadata, generated artifacts.

The snapshot focuses on production runtime code that exercises Python's
decorator-heavy CLI patterns, deep class hierarchies (`BaseCommand` →
`Command` → `Group` → `MultiCommand`), abstract base classes, generics
via `TypeVar`, and `__all__`-based public APIs.

## File integrity

Every file in this directory was downloaded over HTTPS from
`raw.githubusercontent.com/pallets/click/8.4.1/...`, verified against the
git blob SHA-1 published by the GitHub Trees API, and re-hashed with
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

| File | Size (B) |
|---|---:|
| `src/click/__init__.py` | 4634 |
| `src/click/_compat.py` | 18910 |
| `src/click/_termui_impl.py` | 30411 |
| `src/click/_textwrap.py` | 6270 |
| `src/click/_utils.py` | 996 |
| `src/click/_winconsole.py` | 8543 |
| `src/click/core.py` | 137917 |
| `src/click/decorators.py` | 18467 |
| `src/click/exceptions.py` | 11294 |
| `src/click/formatting.py` | 10370 |
| `src/click/globals.py` | 1923 |
| `src/click/parser.py` | 19052 |
| `src/click/shell_completion.py` | 21748 |
| `src/click/termui.py` | 33000 |
| `src/click/testing.py` | 25717 |
| `src/click/types.py` | 42783 |
| `src/click/utils.py` | 20386 |

Total: 17 files, ~393 KB. Per-file SHA-256 hashes live in `_manifest.json`.
