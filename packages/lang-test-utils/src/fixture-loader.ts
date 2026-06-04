/**
 * Fixture loading helpers.
 *
 * Convention: each plugin has `tests/fixtures/<level>/<name>.ext` where
 * `<level>` is one of `simple` / `medium` / `complex` (see INTEGRATION-PLAN
 * section 8.7).
 */

import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * Resolve an absolute path to a fixture file given the test file's import.meta.url
 * (or any path inside the package) and a relative fixture path.
 */
export function fixturePath(packageRoot: string, relativePath: string): string {
  return resolve(packageRoot, 'tests', 'fixtures', relativePath);
}

/**
 * Read a fixture file as a UTF-8 string.
 */
export function loadFixture(packageRoot: string, relativePath: string): string {
  return readFileSync(fixturePath(packageRoot, relativePath), 'utf8');
}

/**
 * List all fixture files under a given level directory (recursively, one level deep).
 */
export function listFixtures(packageRoot: string, level: string): string[] {
  const dir = resolve(packageRoot, 'tests', 'fixtures', level);
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(level, entry.name));
  } catch {
    return [];
  }
}
