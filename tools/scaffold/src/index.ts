/**
 * @reponova/scaffold - CLI to generate a new @reponova/lang-* package.
 *
 * Invoked from monorepo root: `pnpm scaffold lang-<id> [flags]`.
 * The arguments are forwarded by pnpm after the package selector.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, type Archetype } from './args.js';
import { renderFiles } from './templates.js';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = resolve(SELF_DIR, '..', '..', '..');

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const pkgDir = resolve(MONOREPO_ROOT, 'packages', `lang-${args.id}`);

  if (existsSync(pkgDir)) {
    console.error(`Package directory already exists: ${pkgDir}`);
    process.exit(1);
  }

  const files = renderFiles({
    id: args.id,
    extensions: args.extensions,
    archetype: args.archetype,
    description: args.description,
  });

  for (const [relPath, contents] of Object.entries(files)) {
    const absPath = resolve(pkgDir, relPath);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, contents, 'utf8');
  }

  printSummary(args.id, args.archetype, Object.keys(files), pkgDir);
}

function printSummary(
  id: string,
  archetype: Archetype,
  files: string[],
  pkgDir: string,
): void {
  console.log(`Created @reponova/lang-${id} (archetype ${archetype})`);
  console.log(`  Location: ${pkgDir}`);
  console.log(`  Files: ${files.length}`);
  for (const f of files) console.log(`    - ${f}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. pnpm install              # picks up the new workspace package');
  console.log(`  2. cd packages/lang-${id}    # start implementing`);
  console.log('  3. pnpm -F @reponova/lang-' + id + ' typecheck && pnpm -F @reponova/lang-' + id + ' test');
  console.log('  4. pnpm changeset            # describe the new package for the next release');
}

main();
