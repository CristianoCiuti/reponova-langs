# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets).

## How to add a changeset

```bash
pnpm changeset
```

Follow the prompts to describe the change. A new markdown file will be added here.

## How releases happen

1. Push to `main` triggers `.github/workflows/release.yml`
2. If there are unreleased changesets, a "Version Packages" PR is opened
3. Merging that PR runs `pnpm release` which calls `changeset publish` and pushes tags

See [`config.json`](./config.json) for the active configuration.
