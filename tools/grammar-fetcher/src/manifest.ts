import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export interface GrammarSource {
  readonly type: "github-release";
  readonly owner: string;
  readonly repo: string;
  readonly tag: string;
  readonly asset: string;
}

export interface GrammarEntry {
  readonly id: string;
  readonly package: string;
  readonly filename: string;
  readonly source: GrammarSource;
  readonly sha256: string;
  readonly size: number;
}

export interface GrammarManifest {
  readonly grammars: readonly GrammarEntry[];
}

const SHA256_RE = /^[a-f0-9]{64}$/;

function assertString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Manifest invalid: ${path} must be a non-empty string`);
  }
  return value;
}

function assertNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Manifest invalid: ${path} must be a positive number`);
  }
  return value;
}

function validateEntry(raw: unknown, index: number): GrammarEntry {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Manifest invalid: grammars[${index}] must be an object`);
  }
  const r = raw as Record<string, unknown>;
  const id = assertString(r.id, `grammars[${index}].id`);
  const pkg = assertString(r.package, `grammars[${index}].package`);
  const filename = assertString(r.filename, `grammars[${index}].filename`);
  const sha256 = assertString(r.sha256, `grammars[${index}].sha256`).toLowerCase();
  if (!SHA256_RE.test(sha256)) {
    throw new Error(`Manifest invalid: grammars[${index}].sha256 must be a 64-char lowercase hex string`);
  }
  const size = assertNumber(r.size, `grammars[${index}].size`);

  const source = r.source as Record<string, unknown> | undefined;
  if (!source || typeof source !== "object") {
    throw new Error(`Manifest invalid: grammars[${index}].source must be an object`);
  }
  if (source.type !== "github-release") {
    throw new Error(`Manifest invalid: grammars[${index}].source.type must be "github-release" (got ${String(source.type)})`);
  }

  return {
    id,
    package: pkg,
    filename,
    sha256,
    size,
    source: {
      type: "github-release",
      owner: assertString(source.owner, `grammars[${index}].source.owner`),
      repo: assertString(source.repo, `grammars[${index}].source.repo`),
      tag: assertString(source.tag, `grammars[${index}].source.tag`),
      asset: assertString(source.asset, `grammars[${index}].source.asset`),
    },
  };
}

export async function loadManifest(path?: string): Promise<{ manifest: GrammarManifest; path: string }> {
  const resolved = path ?? defaultManifestPath();
  const raw = await readFile(resolved, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Manifest is not valid JSON (${resolved}): ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Manifest invalid: root must be an object`);
  }
  const entries = (parsed as Record<string, unknown>).grammars;
  if (!Array.isArray(entries)) {
    throw new Error(`Manifest invalid: "grammars" must be an array`);
  }
  const manifest: GrammarManifest = {
    grammars: entries.map((e, i) => validateEntry(e, i)),
  };
  return { manifest, path: resolved };
}

export function defaultManifestPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "grammars.json");
}

export function repoRootFromManifest(manifestPath: string): string {
  return resolve(dirname(manifestPath), "..", "..");
}

export function buildAssetUrl(source: GrammarSource): string {
  return `https://github.com/${source.owner}/${source.repo}/releases/download/${source.tag}/${source.asset}`;
}
