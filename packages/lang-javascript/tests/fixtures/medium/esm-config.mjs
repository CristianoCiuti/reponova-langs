/**
 * Pure ESM config fixture. Exercises:
 *  - explicit ESM extension `.mjs`
 *  - `import` named + namespace
 *  - `export const` + `export function` + `export default`
 *  - dynamic import returning a promise
 *  - generator function and async function
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";

/** Default timeout for any I/O bound load. */
export const DEFAULT_TIMEOUT_MS = 5000;

/** Aggregates the pre-defined source plugins. */
export const SOURCES = ["github", "gitlab", "bitbucket"];

/**
 * Async loader. Reads a JSON file and merges it on top of defaults.
 */
export async function loadConfig(file, defaults) {
  const resolved = path.resolve(file);
  const raw = await readFile(resolved, "utf8");
  const parsed = JSON.parse(raw);
  return { ...defaults, ...parsed };
}

/**
 * Generator that yields each source name. Exercises the `generator` tag
 * on the extractor's modifier set.
 */
export function* eachSource() {
  for (const s of SOURCES) {
    yield s;
  }
}

/** Dynamic-import bridge: lazy-loads a sibling source plugin by name. */
export async function loadSourcePlugin(name) {
  const mod = await import(`./plugins/${name}.mjs`);
  return mod.default ?? mod;
}

export default loadConfig;
