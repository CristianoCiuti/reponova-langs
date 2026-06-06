# @reponova/scaffold

CLI generator for new `@reponova/lang-*` plugin packages.

## Usage

From the monorepo root:

```bash
pnpm scaffold lang-<id> [--ext=.<ext1>,.<ext2>] [--archetype=A|B|C] [--desc="..."]
```

Examples:

```bash
pnpm scaffold lang-rust --ext=.rs --archetype=A --desc="Rust language support"
pnpm scaffold lang-mermaid --ext=.mmd,.mermaid --archetype=B
```

Archetypes:

- `A` - programming language (`fileNode.kind = "module"`, typical tree-sitter + outline). Reference: `@reponova/lang-python`, `@reponova/lang-typescript-core`.
- `B` - diagram (`fileNode.kind = "diagram"`, typical regex / hand-rolled parser). Reference: `@reponova/lang-plantuml`.
- `C` - visual asset (`fileNode.kind = "diagram"`, regex over text content). Reference: `@reponova/lang-svg`.

The generated package is created in `packages/lang-<id>/` and is ready to be
filled in: extractor stub, fixtures placeholders, test scaffolds, README, all
in place.
