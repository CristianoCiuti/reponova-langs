/**
 * Argument parsing for the scaffold CLI.
 *
 * Accepts both `pnpm scaffold lang-rust ...` and `pnpm scaffold rust ...`.
 */

export type Archetype = 'A' | 'B' | 'C';

export interface ScaffoldArgs {
  id: string;
  extensions: string[];
  archetype: Archetype;
  description: string;
}

export function parseArgs(argv: string[]): ScaffoldArgs {
  if (argv.length === 0) {
    fail(
      'usage: pnpm scaffold lang-<id> [--ext=.<ext1>,.<ext2>] [--archetype=A|B|C] [--desc="..."]',
    );
  }

  let id: string | undefined;
  let extensions: string[] = [];
  let archetype: Archetype = 'A';
  let description: string | undefined;

  for (const raw of argv) {
    if (raw === '--') {
      continue;
    }
    if (raw.startsWith('--ext=')) {
      extensions = raw
        .slice('--ext='.length)
        .split(',')
        .map((e) => (e.startsWith('.') ? e : `.${e}`))
        .filter(Boolean);
    } else if (raw.startsWith('--archetype=')) {
      const val = raw.slice('--archetype='.length).toUpperCase();
      if (val !== 'A' && val !== 'B' && val !== 'C') {
        fail(`--archetype must be A, B, or C (got "${val}")`);
      }
      archetype = val;
    } else if (raw.startsWith('--desc=')) {
      description = raw.slice('--desc='.length);
    } else if (!raw.startsWith('--')) {
      id = raw.startsWith('lang-') ? raw.slice('lang-'.length) : raw;
    } else {
      fail(`unknown flag: ${raw}`);
    }
  }

  if (!id) fail('missing required <id> argument');
  if (!/^[a-z][a-z0-9-]*$/.test(id!)) {
    fail(`<id> must be lowercase kebab-case (got "${id}")`);
  }
  if (extensions.length === 0) {
    fail('at least one --ext value is required (e.g., --ext=.rs)');
  }
  return {
    id: id!,
    extensions,
    archetype,
    description: description ?? `${capitalize(id!)} support for RepoNova`,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fail(message: string): never {
  console.error(`scaffold: ${message}`);
  process.exit(1);
}
