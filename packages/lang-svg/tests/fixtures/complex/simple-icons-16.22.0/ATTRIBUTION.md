# Third-Party Notice — simple-icons 16.22.0 snapshot

This directory contains a verbatim subset of the upstream
[`simple-icons/simple-icons`](https://github.com/simple-icons/simple-icons)
project, pinned at tag **`16.22.0`** and used **only as a read-only test
fixture** for the `@reponova/lang-svg` extractor.

- **Upstream**: <https://github.com/simple-icons/simple-icons>
- **Commit ref**: `16.22.0`
- **License**: CC0-1.0 (public domain dedication) — see `LICENSE.md`
  (verbatim copy of upstream `LICENSE.md`)
- **Original notice**: brand names referenced by the icon slugs remain
  trademarks of their respective owners. The SVG glyphs themselves are
  dedicated to the public domain by the simple-icons project.

We make no modifications to the source files. Any failure to parse these
files indicates a regression in our extractor, not in simple-icons itself.

## Why a snapshot, not a git submodule?

The upstream repository ships thousands of icons; a submodule would inflate
clone time and tie tests to network availability. We snapshot a curated
subset of 75 icons that span the variety of SVG features we want to
exercise: pure paths, polygons, fills, transforms, simple clip paths.

## Snapshot scope

Included: 75 icon SVG files curated to cover common stack technologies
(languages, frameworks, databases, tools, CDNs). The list was hand-picked
to maximise diversity of glyph complexity rather than completeness.
Originally we requested 80 slugs; 5 were removed or renamed in the
upstream `16.22.0` release and have been omitted (logged at snapshot time).

Excluded: tests, scripts, build tooling, JSON metadata, the rest of the
icon set.

## File integrity

Every file was downloaded over HTTPS from
`raw.githubusercontent.com/simple-icons/simple-icons/16.22.0/icons/...`
and hashed with SHA-256 at rest. The hashes live in `_manifest.json`.

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

The full per-file index — including SHA-256 hashes and byte sizes — lives
in [`_manifest.json`](./_manifest.json). The snapshot totals 75 files and
~97 KB.
