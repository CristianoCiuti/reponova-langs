/**
 * JSON / JSONC extractor with schema-aware extraction.
 *
 * The extractor recognises a small set of well-known JSON files in the
 * JavaScript / TypeScript ecosystem and surfaces them as graph nodes:
 *
 *   - package.json  → module symbol; deps as imports; scripts / bin entries
 *                     as function symbols.
 *   - tsconfig*.json → file extends/references chain as imports;
 *                     compilerOptions.paths as a synthetic import map.
 *   - nx.json       → plugins[] as imports; targetDefaults.* as functions.
 *   - project.json  → name → file label; targets.* as functions; implicit
 *                     dependencies / tags as references.
 *   - generic       → file `description` (if any) as docstring; top-level
 *                     keys as variable symbols.
 *
 * JSONC support comes for free via `jsonc-parser` (Microsoft's JSON-with-
 * comments parser, the same one used by VS Code and TypeScript's tsconfig
 * loader). It tolerates double-slash line comments, slash-star block
 * comments and trailing commas, so `tsconfig.json` files written in their
 * idiomatic JSONC form are parsed cleanly.
 */
import type {
  FileExtraction,
  FileNodeDeclaration,
  ImportDeclaration,
  LanguageExtractor,
  SymbolNode,
  SymbolReference,
  SyntaxTree,
} from "reponova";
import { type Node as JsoncNode, parseTree } from "jsonc-parser";

const JSON_EXTENSIONS = [".json", ".jsonc"] as const;

/**
 * Default cap on the number of top-level keys surfaced as `variable`
 * symbols when a JSON file does NOT match a known schema (`package.json`,
 * `tsconfig*`, `nx.json`, `project.json`, `lerna.json`, `turbo.json`).
 *
 * The cap exists to prevent graph bloat on JSON files that are actually
 * **data** rather than configuration — translation tables, lookup
 * dumps, large vendored fixtures, etc. Without it, an `i18n.json` with
 * a few thousand keys would create a few thousand graph nodes that add
 * no analytical value.
 *
 * 200 is sized to comfortably contain the largest hand-written config
 * files we've seen in real codebases (heavily-customised
 * `eslint.config.json`, full `firebase.json` with dozens of resources,
 * top-level monorepo manifests). Files that legitimately need more can
 * be unblocked by instantiating the extractor manually:
 *
 *     new JsonExtractor({ maxGenericKeys: 500 })
 */
export const DEFAULT_MAX_GENERIC_KEYS = 200;

/** Construction-time options for {@link JsonExtractor}. */
export interface JsonExtractorOptions {
  /**
   * Override the cap on generic top-level-key extraction. Only applies
   * to files that fall into the `generic` schema kind — schemas like
   * `package.json` already structure their output so the cap has no
   * effect there. Set to `Infinity` to disable the cap.
   */
  maxGenericKeys?: number;
}

/**
 * Resolve the effective `maxGenericKeys` cap by trying the candidates
 * in order — the first one that is a finite non-negative number wins.
 *
 * Hoisted to a free function rather than a private method so the same
 * fallback ladder is trivially testable in isolation and identical
 * across all call sites (today there is only one, but the type contract
 * may grow if the extractor ever surfaces additional per-call knobs).
 */
function resolveMaxGenericKeys(
  fromPluginConfig: unknown,
  fromConstructor: number,
): number {
  if (typeof fromPluginConfig === "number" && fromPluginConfig >= 0) {
    return fromPluginConfig;
  }
  return fromConstructor;
}

/** What kind of well-known JSON file we are looking at, by filename. */
export type JsonKind =
  | "package"
  | "tsconfig"
  | "nx"
  | "project"
  | "lerna"
  | "turbo"
  | "pnpm-workspace"
  | "generic";

const TSCONFIG_FILENAME_RE = /^tsconfig(?:\.[a-z0-9-]+)?\.json$/i;

/** Detects the schema kind from the file path / basename. */
export function detectJsonKind(filePath: string): JsonKind {
  const base = posixBasename(filePath).toLowerCase();
  if (base === "package.json") return "package";
  if (TSCONFIG_FILENAME_RE.test(base)) return "tsconfig";
  if (base === "nx.json") return "nx";
  if (base === "project.json") return "project";
  if (base === "lerna.json") return "lerna";
  if (base === "turbo.json") return "turbo";
  if (base === "pnpm-workspace.yaml") return "pnpm-workspace"; // unreachable here, kept for future YAML-as-JSON support
  return "generic";
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function posixBasename(p: string): string {
  const normalized = toPosix(p);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}

function posixDirname(p: string): string {
  const normalized = toPosix(p);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? "" : normalized.slice(0, lastSlash);
}

/**
 * Convert a relative path expression (the kind found in tsconfig `extends`
 * / `references[].path`, or in npm workspaces) into a normalised module
 * specifier preserving leading `./` / `../` so reponova's import resolver
 * can route it back to a file.
 */
function normaliseRelativeSpec(spec: string): string {
  const t = spec.trim();
  if (!t) return t;
  if (t.startsWith("/") || t.startsWith("./") || t.startsWith("../")) {
    return toPosix(t);
  }
  // Bare specifiers (npm package names, like "@tsconfig/node20/tsconfig.json"
  // or workspace package names) are kept verbatim.
  return t;
}

/** Build the file-relative module name for qualified symbols. */
function moduleNameFromPath(filePath: string): string {
  // Drop the `.json[c]?` extension and convert separators to dots so
  // qualified symbol names look like other reponova plugins.
  const normalized = toPosix(filePath);
  return normalized.replace(/\.jsonc?$/i, "").replace(/\//g, ".");
}

/**
 * Convert a `jsonc-parser` offset into a 1-indexed line number against
 * the original source. We materialise the line break offsets once per
 * extraction so each conversion is O(log n) via binary search.
 */
function makeOffsetToLine(source: string): (offset: number) => number {
  const breaks: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 0x0a /* \n */) {
      breaks.push(i + 1);
    }
  }
  return (offset: number) => {
    if (offset <= 0) return 1;
    let lo = 0;
    let hi = breaks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (breaks[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * Lightweight typed wrappers around the `jsonc-parser` AST. The parser
 * returns `Node | undefined` for missing nodes; we keep the helpers
 * non-throwing because real-world files routinely lack many of the
 * fields we look for, and the goal is to surface what's there rather
 * than crash on what isn't.
 */
function findProperty(obj: JsoncNode | undefined, key: string): JsoncNode | undefined {
  if (!obj || obj.type !== "object" || !obj.children) return undefined;
  for (const prop of obj.children) {
    if (prop.type !== "property" || !prop.children || prop.children.length < 2) continue;
    const k = prop.children[0]!;
    if (k.type === "string" && k.value === key) {
      return prop.children[1];
    }
  }
  return undefined;
}

function asObjectEntries(
  obj: JsoncNode | undefined,
): Array<{ key: string; value: JsoncNode; keyOffset: number }> {
  if (!obj || obj.type !== "object" || !obj.children) return [];
  const out: Array<{ key: string; value: JsoncNode; keyOffset: number }> = [];
  for (const prop of obj.children) {
    if (prop.type !== "property" || !prop.children || prop.children.length < 2) continue;
    const k = prop.children[0]!;
    if (k.type === "string" && typeof k.value === "string") {
      out.push({ key: k.value, value: prop.children[1]!, keyOffset: k.offset });
    }
  }
  return out;
}

function asArrayItems(arr: JsoncNode | undefined): JsoncNode[] {
  if (!arr || arr.type !== "array" || !arr.children) return [];
  return arr.children;
}

function asStringValue(node: JsoncNode | undefined): string | undefined {
  if (!node || node.type !== "string") return undefined;
  return typeof node.value === "string" ? node.value : undefined;
}

function nodeEndOffset(node: JsoncNode): number {
  return node.offset + node.length;
}

/**
 * Internal context shared by the per-schema extractors. Bundled into a
 * single argument so each schema function stays a clean pure-ish reducer
 * over the AST.
 */
interface ExtractCtx {
  filePath: string;
  source: string;
  moduleName: string;
  fileBasename: string;
  offsetToLine: (offset: number) => number;
  symbols: SymbolNode[];
  imports: ImportDeclaration[];
  references: SymbolReference[];
}

/** Unique-name helper that auto-suffixes `_2`, `_3`, … on collisions. */
function uniqueQualifiedName(
  ctx: ExtractCtx,
  bare: string,
  taken: Map<string, number>,
): string {
  const count = (taken.get(bare) ?? 0) + 1;
  taken.set(bare, count);
  return count === 1 ? `${ctx.moduleName}.${bare}` : `${ctx.moduleName}.${bare}_${count}`;
}

/* ─────────────────────────  package.json  ──────────────────────────── */

const DEP_FIELDS = [
  ["dependencies", "dependency"],
  ["devDependencies", "dev-dependency"],
  ["peerDependencies", "peer-dependency"],
  ["optionalDependencies", "optional-dependency"],
] as const;

function extractPackageJson(root: JsoncNode | undefined, ctx: ExtractCtx): FileNodeDeclaration {
  const packageName = asStringValue(findProperty(root, "name"));
  const description = asStringValue(findProperty(root, "description"));
  const version = asStringValue(findProperty(root, "version"));

  const tags = ["package.json"];
  // `"private"` is canonically a JSON boolean (not a string). We accept
  // both the JSON-boolean form (the common case) and the legacy string
  // form (`"private": "true"`) some hand-edited files use.
  const privateNode = findProperty(root, "private");
  const isPrivate =
    (privateNode?.type === "boolean" && privateNode.value === true) ||
    (privateNode?.type === "string" && privateNode.value === "true");
  if (isPrivate) tags.push("private");
  if (findProperty(root, "workspaces")) tags.push("workspaces");

  const fileNode: FileNodeDeclaration = {
    kind: "module",
    label: packageName ?? ctx.fileBasename,
    docstring: description,
    tags,
  };

  // Dependencies → imports (one entry per dep). The dep "kind" is recorded
  // via the `names` field as `[<dep-name>@<version-spec>]` so consumers
  // that need the version range can recover it. The dep CLASS (dev / peer
  // / optional / runtime) flows through `isExport` only for runtime deps
  // (false everywhere) — the actual class lives on the per-symbol kind
  // we attach below.
  for (const [field, _depKind] of DEP_FIELDS) {
    const node = findProperty(root, field);
    for (const { key: depName, value } of asObjectEntries(node)) {
      const versionSpec = asStringValue(value) ?? "*";
      ctx.imports.push({
        module: depName,
        names: [`${depName}@${versionSpec}`],
        isWildcard: false,
        line: ctx.offsetToLine((value).offset),
      });
    }
  }

  // Workspaces field: either array of glob patterns or { packages: [...] }
  // — both forms surface as wildcard imports so reponova's resolver can
  // walk them later.
  const workspacesNode = findProperty(root, "workspaces");
  const workspaceArr =
    workspacesNode?.type === "array"
      ? workspacesNode
      : findProperty(workspacesNode, "packages");
  for (const item of asArrayItems(workspaceArr)) {
    const pattern = asStringValue(item);
    if (!pattern) continue;
    ctx.imports.push({
      module: normaliseRelativeSpec(pattern),
      names: [],
      isWildcard: true,
      isExport: true,
      line: ctx.offsetToLine(item.offset),
    });
  }

  // Scripts → function symbols. The shell command is preserved as
  // docstring so downstream tools can render the actual command line.
  const taken = new Map<string, number>();
  const scripts = findProperty(root, "scripts");
  for (const { key, value, keyOffset } of asObjectEntries(scripts)) {
    const command = asStringValue(value) ?? "";
    ctx.symbols.push({
      name: key,
      qualifiedName: uniqueQualifiedName(ctx, `scripts.${key}`, taken),
      kind: "function",
      decorators: ["npm-script"],
      docstring: command,
      startLine: ctx.offsetToLine(keyOffset),
      endLine: ctx.offsetToLine(nodeEndOffset(value)),
      parent: ctx.fileBasename,
    });
  }

  // bin entries: either `"bin": "path"` (single binary) or
  // `"bin": { name: path, ... }` (multiple).
  const bin = findProperty(root, "bin");
  if (bin?.type === "string") {
    const binPath = asStringValue(bin) ?? "";
    const name = packageName?.split("/").pop() ?? ctx.fileBasename;
    ctx.symbols.push({
      name,
      qualifiedName: uniqueQualifiedName(ctx, `bin.${name}`, taken),
      kind: "function",
      decorators: ["npm-bin"],
      docstring: binPath,
      startLine: ctx.offsetToLine(bin.offset),
      endLine: ctx.offsetToLine(nodeEndOffset(bin)),
      parent: ctx.fileBasename,
    });
  } else {
    for (const { key, value, keyOffset } of asObjectEntries(bin)) {
      ctx.symbols.push({
        name: key,
        qualifiedName: uniqueQualifiedName(ctx, `bin.${key}`, taken),
        kind: "function",
        decorators: ["npm-bin"],
        docstring: asStringValue(value),
        startLine: ctx.offsetToLine(keyOffset),
        endLine: ctx.offsetToLine(nodeEndOffset(value)),
        parent: ctx.fileBasename,
      });
    }
  }

  // Surface the package's identity as a module-level constant so
  // `graph_search` queries against the package name resolve to the
  // file. The version is included in the docstring for context.
  if (packageName) {
    ctx.symbols.push({
      name: packageName,
      qualifiedName: uniqueQualifiedName(ctx, `name`, taken),
      kind: "constant",
      decorators: ["package-name"],
      docstring: version ? `${packageName}@${version}` : packageName,
      startLine: ctx.offsetToLine((findProperty(root, "name")!).offset),
      endLine: ctx.offsetToLine(nodeEndOffset(findProperty(root, "name")!)),
      parent: ctx.fileBasename,
    });
  }

  return fileNode;
}

/* ──────────────────────────  tsconfig*.json  ────────────────────────── */

function extractTsConfig(root: JsoncNode | undefined, ctx: ExtractCtx): FileNodeDeclaration {
  const tags = ["tsconfig"];
  if (findProperty(root, "extends")) tags.push("extends");
  if (findProperty(root, "references")) tags.push("project-references");

  const fileNode: FileNodeDeclaration = {
    kind: "module",
    label: ctx.fileBasename,
    tags,
  };

  // `extends`: in modern TS this can be either a single string OR an
  // array of strings (TS 5.0+). We surface every entry as an import.
  const extendsNode = findProperty(root, "extends");
  if (extendsNode?.type === "string") {
    const spec = asStringValue(extendsNode);
    if (spec) {
      ctx.imports.push({
        module: normaliseRelativeSpec(spec),
        names: ["extends"],
        isWildcard: false,
        line: ctx.offsetToLine(extendsNode.offset),
      });
    }
  } else if (extendsNode?.type === "array") {
    for (const item of asArrayItems(extendsNode)) {
      const spec = asStringValue(item);
      if (!spec) continue;
      ctx.imports.push({
        module: normaliseRelativeSpec(spec),
        names: ["extends"],
        isWildcard: false,
        line: ctx.offsetToLine(item.offset),
      });
    }
  }

  // `references`: array of { path: string, ... } — each surfaces as an
  // import edge so the project-graph reconstructs the build dependency
  // chain.
  for (const ref of asArrayItems(findProperty(root, "references"))) {
    const pathNode = findProperty(ref, "path");
    const spec = asStringValue(pathNode);
    if (!spec) continue;
    ctx.imports.push({
      module: normaliseRelativeSpec(spec),
      names: ["reference"],
      isWildcard: false,
      line: ctx.offsetToLine(pathNode!.offset),
    });
  }

  // `compilerOptions.paths`: synthetic imports modelling the path-alias
  // table. Each alias key emits one import per target. The wildcard
  // `*` is preserved so reponova can route arbitrary specifiers later.
  const paths = findProperty(findProperty(root, "compilerOptions"), "paths");
  for (const { key: alias, value } of asObjectEntries(paths)) {
    for (const target of asArrayItems(value)) {
      const spec = asStringValue(target);
      if (!spec) continue;
      ctx.imports.push({
        module: normaliseRelativeSpec(spec),
        names: [alias],
        isWildcard: alias.includes("*"),
        line: ctx.offsetToLine(target.offset),
      });
    }
  }

  return fileNode;
}

/* ──────────────────────────────  nx.json  ──────────────────────────── */

function extractNx(root: JsoncNode | undefined, ctx: ExtractCtx): FileNodeDeclaration {
  const fileNode: FileNodeDeclaration = {
    kind: "module",
    label: "nx.json",
    tags: ["nx", "monorepo"],
  };

  // plugins: either string entries or { plugin: "...", options: {...} }
  for (const item of asArrayItems(findProperty(root, "plugins"))) {
    const spec = item.type === "string" ? asStringValue(item) : asStringValue(findProperty(item, "plugin"));
    if (!spec) continue;
    ctx.imports.push({
      module: spec,
      names: ["nx-plugin"],
      isWildcard: false,
      line: ctx.offsetToLine(item.offset),
    });
  }

  const taken = new Map<string, number>();

  // targetDefaults.<name> → function symbols (the "executor" / "command"
  // defaults) so that calls from project.json resolve back here.
  for (const { key, value, keyOffset } of asObjectEntries(findProperty(root, "targetDefaults"))) {
    const executor = asStringValue(findProperty(value, "executor")) ?? asStringValue(findProperty(value, "command"));
    ctx.symbols.push({
      name: key,
      qualifiedName: uniqueQualifiedName(ctx, `targetDefaults.${key}`, taken),
      kind: "function",
      decorators: ["nx-target-default"],
      docstring: executor,
      startLine: ctx.offsetToLine(keyOffset),
      endLine: ctx.offsetToLine(nodeEndOffset(value)),
      parent: "nx.json",
    });
  }

  // namedInputs.<name> → variable symbols.
  for (const { key, value, keyOffset } of asObjectEntries(findProperty(root, "namedInputs"))) {
    ctx.symbols.push({
      name: key,
      qualifiedName: uniqueQualifiedName(ctx, `namedInputs.${key}`, taken),
      kind: "variable",
      decorators: ["nx-named-input"],
      startLine: ctx.offsetToLine(keyOffset),
      endLine: ctx.offsetToLine(nodeEndOffset(value)),
      parent: "nx.json",
    });
  }

  // generators: external schematic packages → imports.
  for (const { key } of asObjectEntries(findProperty(root, "generators"))) {
    ctx.imports.push({
      module: key,
      names: ["nx-generator"],
      isWildcard: false,
      line: 1,
    });
  }

  return fileNode;
}

/* ──────────────────────────  project.json (Nx)  ────────────────────── */

function extractProjectJson(root: JsoncNode | undefined, ctx: ExtractCtx): FileNodeDeclaration {
  const projectName = asStringValue(findProperty(root, "name"));
  const projectType = asStringValue(findProperty(root, "projectType"));
  const sourceRoot = asStringValue(findProperty(root, "sourceRoot"));

  const tags = ["nx-project"];
  if (projectType) tags.push(`nx-${projectType}`);

  const fileNode: FileNodeDeclaration = {
    kind: "module",
    label: projectName ?? ctx.fileBasename,
    docstring: sourceRoot,
    tags,
  };

  const taken = new Map<string, number>();

  // targets → function symbols. Each target's executor goes into the
  // docstring so consumers see "what does this target do" at a glance.
  for (const { key, value, keyOffset } of asObjectEntries(findProperty(root, "targets"))) {
    const executor =
      asStringValue(findProperty(value, "executor")) ??
      asStringValue(findProperty(value, "command")) ??
      undefined;
    ctx.symbols.push({
      name: key,
      qualifiedName: uniqueQualifiedName(ctx, `targets.${key}`, taken),
      kind: "function",
      decorators: ["nx-target"],
      docstring: executor,
      startLine: ctx.offsetToLine(keyOffset),
      endLine: ctx.offsetToLine(nodeEndOffset(value)),
      parent: projectName ?? ctx.fileBasename,
    });
  }

  // implicitDependencies[]: surface as graph references so the impact
  // analyser can hop from project to project.
  for (const item of asArrayItems(findProperty(root, "implicitDependencies"))) {
    const dep = asStringValue(item);
    if (!dep) continue;
    ctx.references.push({
      name: dep,
      fromSymbol: projectName ?? ctx.fileBasename,
      kind: "references",
      line: ctx.offsetToLine(item.offset),
    });
  }

  // tags[]: emitted as variable symbols hung off the project — they
  // carry classification metadata (`scope:foo`, `type:lib`, …) used
  // by Nx's dependency-rules ESLint plugin and useful as graph filter
  // facets.
  for (const item of asArrayItems(findProperty(root, "tags"))) {
    const tag = asStringValue(item);
    if (!tag) continue;
    ctx.symbols.push({
      name: tag,
      qualifiedName: uniqueQualifiedName(ctx, `tags.${sanitiseSymbol(tag)}`, taken),
      kind: "variable",
      decorators: ["nx-tag"],
      docstring: tag,
      startLine: ctx.offsetToLine(item.offset),
      endLine: ctx.offsetToLine(nodeEndOffset(item)),
      parent: projectName ?? ctx.fileBasename,
    });
  }

  return fileNode;
}

function sanitiseSymbol(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "tag";
}

/* ──────────────────────────  lerna.json / turbo.json  ──────────────── */

function extractLerna(root: JsoncNode | undefined, ctx: ExtractCtx): FileNodeDeclaration {
  const fileNode: FileNodeDeclaration = {
    kind: "module",
    label: "lerna.json",
    tags: ["lerna", "monorepo"],
  };
  // Workspaces / packages
  const packagesArr = findProperty(root, "packages");
  for (const item of asArrayItems(packagesArr)) {
    const pattern = asStringValue(item);
    if (!pattern) continue;
    ctx.imports.push({
      module: normaliseRelativeSpec(pattern),
      names: [],
      isWildcard: true,
      isExport: true,
      line: ctx.offsetToLine(item.offset),
    });
  }
  return fileNode;
}

function extractTurbo(root: JsoncNode | undefined, ctx: ExtractCtx): FileNodeDeclaration {
  const fileNode: FileNodeDeclaration = {
    kind: "module",
    label: "turbo.json",
    tags: ["turborepo", "monorepo"],
  };
  const taken = new Map<string, number>();

  // pipeline (turbo <2) / tasks (turbo 2+) → function symbols.
  const pipeline = findProperty(root, "pipeline") ?? findProperty(root, "tasks");
  for (const { key, value, keyOffset } of asObjectEntries(pipeline)) {
    ctx.symbols.push({
      name: key,
      qualifiedName: uniqueQualifiedName(ctx, `pipeline.${sanitiseSymbol(key)}`, taken),
      kind: "function",
      decorators: ["turbo-task"],
      startLine: ctx.offsetToLine(keyOffset),
      endLine: ctx.offsetToLine(nodeEndOffset(value)),
      parent: "turbo.json",
    });
  }

  const extendsNode = findProperty(root, "extends");
  for (const item of asArrayItems(extendsNode)) {
    const spec = asStringValue(item);
    if (!spec) continue;
    ctx.imports.push({
      module: normaliseRelativeSpec(spec),
      names: ["extends"],
      isWildcard: false,
      line: ctx.offsetToLine(item.offset),
    });
  }
  return fileNode;
}

/* ────────────────────────────  generic JSON  ───────────────────────── */

function extractGeneric(
  root: JsoncNode | undefined,
  ctx: ExtractCtx,
  maxGenericKeys: number,
): FileNodeDeclaration {
  const description = asStringValue(findProperty(root, "description"));
  const fileNode: FileNodeDeclaration = {
    kind: "module",
    label: ctx.fileBasename,
    docstring: description,
    tags: ["json"],
  };

  // Top-level keys at most as a hint of structure, capped to avoid
  // explosion on data-style documents (translation tables, lookup
  // dumps, vendored fixtures). The cap is configurable via the
  // {@link JsonExtractorOptions.maxGenericKeys} constructor option;
  // see {@link DEFAULT_MAX_GENERIC_KEYS} for rationale.
  if (root?.type === "object") {
    const taken = new Map<string, number>();
    let cap = maxGenericKeys;
    for (const { key, value, keyOffset } of asObjectEntries(root)) {
      if (cap-- <= 0) break;
      const safe = sanitiseSymbol(key);
      if (!safe) continue;
      ctx.symbols.push({
        name: key,
        qualifiedName: uniqueQualifiedName(ctx, safe, taken),
        kind: "variable",
        decorators: ["json-key"],
        startLine: ctx.offsetToLine(keyOffset),
        endLine: ctx.offsetToLine(nodeEndOffset(value)),
        parent: ctx.fileBasename,
      });
    }
  }

  return fileNode;
}

/* ───────────────────────────  the extractor  ───────────────────────── */

export class JsonExtractor implements LanguageExtractor {
  readonly languageId = "json";
  readonly extensions = [...JSON_EXTENSIONS];
  readonly wasmFile = undefined;

  private readonly maxGenericKeys: number;

  constructor(options: JsonExtractorOptions = {}) {
    const v = options.maxGenericKeys;
    this.maxGenericKeys =
      typeof v === "number" && v >= 0 ? v : DEFAULT_MAX_GENERIC_KEYS;
  }

  /**
   * Extract symbols, imports, and references from a JSON / JSONC file.
   *
   * The optional `pluginConfig` argument is forwarded by RepoNova >= 0.7
   * after merging the plugin's `configDefaults` with the user's
   * `plugins.json` block in `reponova.yml`. The only key currently
   * honoured here is `maxGenericKeys`. Precedence, highest first:
   *
   *   1. `pluginConfig.maxGenericKeys` — user value from `reponova.yml`
   *      (or the configDefaults baseline of 200, since the loader
   *      always merges defaults into the payload).
   *   2. `this.maxGenericKeys`         — value passed at construction
   *      time via {@link JsonExtractorOptions} — kept as a fallback for
   *      programmatic consumers that instantiate the extractor
   *      directly and never go through the plugin loader.
   *   3. {@link DEFAULT_MAX_GENERIC_KEYS} (`200`) — used only when both
   *      of the above are absent or invalid.
   *
   * Invalid values (non-numeric, negative, `NaN`) at either level fall
   * through to the next tier rather than disabling the cap.
   */
  extract(
    _tree: SyntaxTree | null,
    sourceCode: string,
    filePath: string,
    pluginConfig?: Readonly<Record<string, unknown>>,
  ): FileExtraction {
    const root = parseTree(sourceCode);
    const ctx: ExtractCtx = {
      filePath,
      source: sourceCode,
      moduleName: moduleNameFromPath(filePath),
      fileBasename: posixBasename(filePath),
      offsetToLine: makeOffsetToLine(sourceCode),
      symbols: [],
      imports: [],
      references: [],
    };

    const effectiveMaxGenericKeys = resolveMaxGenericKeys(
      pluginConfig?.maxGenericKeys,
      this.maxGenericKeys,
    );

    const kind = detectJsonKind(filePath);
    let fileNode: FileNodeDeclaration;
    switch (kind) {
      case "package":
        fileNode = extractPackageJson(root, ctx);
        break;
      case "tsconfig":
        fileNode = extractTsConfig(root, ctx);
        break;
      case "nx":
        fileNode = extractNx(root, ctx);
        break;
      case "project":
        fileNode = extractProjectJson(root, ctx);
        break;
      case "lerna":
        fileNode = extractLerna(root, ctx);
        break;
      case "turbo":
        fileNode = extractTurbo(root, ctx);
        break;
      default:
        fileNode = extractGeneric(root, ctx, effectiveMaxGenericKeys);
    }

    return {
      filePath,
      language: this.languageId,
      fileNode,
      symbols: ctx.symbols,
      imports: ctx.imports,
      references: ctx.references,
    };
  }

  /**
   * Resolve a relative spec (extends, references, workspace pattern) into
   * a concrete file path candidate list. The graph builder then probes
   * the filesystem against this list to wire up edges.
   *
   * For tsconfig-style `extends`:
   *   - `"./base.json"` against `apps/web/tsconfig.json`
   *     → `["apps/web/base.json", "apps/web/base"]`
   *   - `"@tsconfig/node20/tsconfig.json"` (bare specifier)
   *     → `[]` (let reponova's bare-spec resolver take over)
   */
  resolveImportPath(importModule: string, currentFilePath: string): string[] {
    if (!importModule) return [];
    const dir = posixDirname(currentFilePath);
    const m = importModule.trim();

    // Bare specifiers (no leading slash, dot, or backslash) — the
    // resolver upstream knows how to walk node_modules.
    if (!/^(?:\.\.?\/|\/|\.\.?\\|\\)/.test(m) && !m.startsWith("./") && !m.startsWith("../") && !m.startsWith("/")) {
      return [];
    }

    const joined = m.startsWith("/") ? m.slice(1) : (dir ? `${dir}/${m}` : m);
    const normalized = toPosix(joined).replace(/\/\.\//g, "/");
    // Collapse `a/b/../c` → `a/c` until stable.
    const segments: string[] = [];
    for (const seg of normalized.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") segments.pop();
      else segments.push(seg);
    }
    const cleaned = segments.join("/");

    // Candidate set: as-is, with `.json` if missing, plus the implicit
    // `/tsconfig.json` for tsconfig directories.
    const out = new Set<string>();
    out.add(cleaned);
    if (!/\.jsonc?$/i.test(cleaned)) out.add(`${cleaned}.json`);
    out.add(`${cleaned}/tsconfig.json`);
    return Array.from(out);
  }
}
