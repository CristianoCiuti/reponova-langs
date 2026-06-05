/**
 * TypeScript-family language support for the outline pipeline.
 *
 * Two strategies, mirroring the python plugin:
 *   1. tree-sitter (primary): full AST via a tree-sitter-typescript-compatible WASM
 *   2. regex (fallback): pattern matching when WASM is unavailable
 *
 * The two strategies above are language-flavor agnostic: they walk the same
 * node types produced by both `tree-sitter-typescript.wasm` and
 * `tree-sitter-tsx.wasm`. The only flavor-specific bit is which WASM file
 * the host RepoNova process should load, which is what the
 * `createTypescriptOutline({ wasmFile })` factory parameterizes.
 */
import type { LanguageSupport, SyntaxNode } from "reponova";

interface ImportEntry {
  module: string;
  names?: string[];
  line: number;
}

interface FunctionEntry {
  name: string;
  signature: string;
  decorators: string[];
  docstring?: string;
  start_line: number;
  end_line: number;
  calls: string[];
}

interface ClassEntry {
  name: string;
  bases: string[];
  docstring?: string;
  start_line: number;
  end_line: number;
  methods: FunctionEntry[];
}

interface FileOutline {
  file_path: string;
  line_count: number;
  imports: ImportEntry[];
  functions: FunctionEntry[];
  classes: ClassEntry[];
}

/** Options for {@link createTypescriptOutline}. */
export interface TypescriptOutlineOptions {
  /** WASM grammar filename. Defaults to `tree-sitter-typescript.wasm`. */
  readonly wasmFile?: string;
}

/**
 * Build a `LanguageSupport` for the outline pipeline, parameterised on the
 * grammar wasm filename. Pass `{ wasmFile: "tree-sitter-tsx.wasm" }` from
 * the `lang-tsx` plugin; pass `{}` (or omit) from `lang-typescript`.
 */
export function createTypescriptOutline(
  options: TypescriptOutlineOptions = {},
): LanguageSupport {
  return {
    wasmFile: options.wasmFile ?? "tree-sitter-typescript.wasm",
    treeSitterExtract,
    regexExtract,
  };
}

/** Default TypeScript-flavor `LanguageSupport` (back-compat re-export). */
export const typescript: LanguageSupport = createTypescriptOutline();

// ═══════════════════════════════════════════════════════════════════════════
// TREE-SITTER EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

function treeSitterExtract(rootNode: SyntaxNode, filePath: string, lineCount: number): FileOutline {
  const imports: ImportEntry[] = [];
  const functions: FunctionEntry[] = [];
  const classes: ClassEntry[] = [];

  walkTopLevel(rootNode, imports, functions, classes);

  return { file_path: filePath, line_count: lineCount, imports, functions, classes };
}

function walkTopLevel(
  node: SyntaxNode,
  imports: ImportEntry[],
  functions: FunctionEntry[],
  classes: ClassEntry[],
): void {
  for (const child of node.namedChildren) {
    switch (child.type) {
      case "import_statement":
        imports.push(tsExtractImport(child));
        break;
      case "export_statement": {
        // Re-export with a source: capture the module + names
        const sourceNode = child.childForFieldName("source")
          ?? child.namedChildren.find((c) => c.type === "string");
        if (sourceNode) {
          imports.push(tsExtractReExport(child, sourceNode));
        }
        // Drill into the wrapped declaration (export class/function/...)
        for (const inner of child.namedChildren) {
          if (
            inner.type === "function_declaration"
            || inner.type === "class_declaration"
            || inner.type === "abstract_class_declaration"
            || inner.type === "interface_declaration"
            || inner.type === "lexical_declaration"
            || inner.type === "variable_declaration"
          ) {
            collectDeclarationOutline(inner, functions, classes);
          }
        }
        break;
      }
      case "function_declaration":
      case "generator_function_declaration":
      case "class_declaration":
      case "abstract_class_declaration":
      case "interface_declaration":
      case "lexical_declaration":
      case "variable_declaration":
        // For lexical/variable declarations we ALSO sniff out CommonJS
        // `require()` patterns and surface them as imports — keeps the
        // outline graph homogeneous between ESM and CJS files.
        if (child.type === "lexical_declaration" || child.type === "variable_declaration") {
          tsExtractRequireImports(child, imports);
        }
        collectDeclarationOutline(child, functions, classes);
        break;
    }
  }
}

/**
 * CommonJS `require()` imports for the outline pipeline. Mirror of the
 * extractor's `extractRequireImports` but emitting the lighter
 * `ImportEntry` shape used by the outline view.
 */
function tsExtractRequireImports(
  declarationNode: SyntaxNode,
  imports: ImportEntry[],
): void {
  for (const declarator of declarationNode.namedChildren) {
    if (declarator.type !== "variable_declarator") continue;
    const value = declarator.childForFieldName("value");
    if (!value || value.type !== "call_expression") continue;
    const fn = value.childForFieldName("function");
    if (!fn || fn.type !== "identifier" || fn.text !== "require") continue;
    const args = value.childForFieldName("arguments");
    if (!args) continue;
    const stringArg = args.namedChildren.find((c) => c.type === "string");
    if (!stringArg) continue;
    const module = unquoteString(stringArg.text);

    const names: string[] = [];
    const binding = declarator.childForFieldName("name");
    if (binding) {
      if (binding.type === "identifier") {
        names.push(binding.text);
      } else if (binding.type === "object_pattern") {
        for (const prop of binding.namedChildren) {
          if (prop.type === "shorthand_property_identifier_pattern") {
            names.push(prop.text);
          } else if (prop.type === "pair_pattern") {
            const keyNode = prop.childForFieldName("key");
            if (keyNode) names.push(keyNode.text);
          }
        }
      }
    }

    imports.push({
      module,
      names: names.length > 0 ? names : undefined,
      line: declarationNode.startPosition.row + 1,
    });
  }
}

function collectDeclarationOutline(
  node: SyntaxNode,
  functions: FunctionEntry[],
  classes: ClassEntry[],
): void {
  switch (node.type) {
    case "function_declaration":
    case "generator_function_declaration":
      functions.push(tsExtractFunction(node));
      return;

    case "class_declaration":
    case "abstract_class_declaration":
      classes.push(tsExtractClass(node));
      return;

    case "interface_declaration":
      classes.push(tsExtractInterface(node));
      return;

    case "lexical_declaration":
    case "variable_declaration": {
      for (const declarator of node.namedChildren) {
        if (declarator.type !== "variable_declarator") continue;
        const value = declarator.childForFieldName("value");
        if (!value) continue;
        if (value.type !== "arrow_function" && value.type !== "function_expression") continue;
        const nameNode = declarator.childForFieldName("name")
          ?? declarator.namedChildren.find((c) => c.type === "identifier");
        if (!nameNode || nameNode.type !== "identifier") continue;
        functions.push(tsExtractArrowFunction(value, nameNode.text, node));
      }
      return;
    }
  }
}

function tsExtractImport(node: SyntaxNode): ImportEntry {
  const sourceNode = node.childForFieldName("source")
    ?? node.namedChildren.find((c) => c.type === "string");
  const module = sourceNode ? unquoteString(sourceNode.text) : "";
  const names: string[] = [];
  const clause = node.namedChildren.find((c) => c.type === "import_clause");
  if (clause) {
    for (const c of clause.namedChildren) {
      if (c.type === "identifier") {
        names.push(c.text);
      } else if (c.type === "namespace_import") {
        const id = c.namedChildren.find((cc) => cc.type === "identifier");
        if (id) names.push(`* as ${id.text}`);
      } else if (c.type === "named_imports") {
        for (const spec of c.namedChildren) {
          if (spec.type === "import_specifier") {
            const id = spec.childForFieldName("name") ?? spec.namedChildren.find((cc) => cc.type === "identifier");
            if (id) names.push(id.text);
          }
        }
      }
    }
  }
  return { module, names: names.length > 0 ? names : undefined, line: node.startPosition.row + 1 };
}

function tsExtractReExport(node: SyntaxNode, sourceNode: SyntaxNode): ImportEntry {
  const module = unquoteString(sourceNode.text);
  const names: string[] = [];
  const clause = node.namedChildren.find((c) => c.type === "export_clause");
  if (clause) {
    for (const spec of clause.namedChildren) {
      if (spec.type === "export_specifier") {
        const id = spec.childForFieldName("name") ?? spec.namedChildren.find((c) => c.type === "identifier");
        if (id) names.push(id.text);
      }
    }
  }
  return { module, names: names.length > 0 ? names : undefined, line: node.startPosition.row + 1 };
}

function tsExtractFunction(node: SyntaxNode): FunctionEntry {
  const nameNode = node.childForFieldName("name");
  const name = nameNode?.text ?? "<anonymous>";
  return {
    name,
    signature: buildSignature(node, name),
    decorators: collectDecorators(node),
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    calls: tsExtractCalls(node),
  };
}

function tsExtractArrowFunction(
  fnNode: SyntaxNode,
  name: string,
  declarationNode: SyntaxNode,
): FunctionEntry {
  return {
    name,
    signature: buildArrowSignature(fnNode, name),
    decorators: [],
    start_line: declarationNode.startPosition.row + 1,
    end_line: declarationNode.endPosition.row + 1,
    calls: tsExtractCalls(fnNode),
  };
}

function tsExtractClass(node: SyntaxNode): ClassEntry {
  const nameNode = node.childForFieldName("name");
  const name = nameNode?.text ?? "<anonymous>";
  const bases: string[] = [];
  const heritage = node.namedChildren.find((c) => c.type === "class_heritage");
  if (heritage) {
    // Two grammar shapes — see extractor.ts `extractHeritage` for the
    // detailed rationale.
    //   TS:  class_heritage > extends_clause > <expression>
    //   JS:  class_heritage > <expression>
    const isHeritageBase = (n: SyntaxNode): boolean =>
      n.type === "identifier"
      || n.type === "type_identifier"
      || n.type === "member_expression"
      || n.type === "generic_type";
    for (const clause of heritage.namedChildren) {
      if (clause.type === "extends_clause" || clause.type === "implements_clause") {
        for (const value of clause.namedChildren) {
          if (isHeritageBase(value)) bases.push(bareTypeName(value));
        }
      } else if (isHeritageBase(clause)) {
        bases.push(bareTypeName(clause));
      }
    }
  }

  const methods: FunctionEntry[] = [];
  const body = node.childForFieldName("body");
  if (body) {
    for (const member of body.namedChildren) {
      if (member.type !== "method_definition") continue;
      const memberName = member.childForFieldName("name");
      if (!memberName) continue;
      methods.push({
        name: memberName.text,
        signature: buildSignature(member, memberName.text),
        decorators: collectDecorators(member),
        start_line: member.startPosition.row + 1,
        end_line: member.endPosition.row + 1,
        calls: tsExtractCalls(member),
      });
    }
  }

  return {
    name,
    bases,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    methods,
  };
}

function tsExtractInterface(node: SyntaxNode): ClassEntry {
  const nameNode = node.childForFieldName("name");
  const name = nameNode?.text ?? "<anonymous>";
  const bases: string[] = [];
  const heritage = node.namedChildren.find((c) => c.type === "extends_type_clause");
  if (heritage) {
    for (const value of heritage.namedChildren) {
      if (
        value.type === "type_identifier"
        || value.type === "generic_type"
        || value.type === "nested_type_identifier"
      ) {
        bases.push(bareTypeName(value));
      }
    }
  }
  return {
    name,
    bases,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    methods: [],
  };
}

function buildSignature(node: SyntaxNode, name: string): string {
  const params = node.childForFieldName("parameters")?.text ?? "()";
  const ret = node.childForFieldName("return_type")?.text ?? "";
  return `${name}${params}${ret ? ` ${ret}` : ""}`;
}

function buildArrowSignature(node: SyntaxNode, name: string): string {
  const paramsNode = node.childForFieldName("parameters")
    ?? node.namedChildren.find((c) => c.type === "formal_parameters");
  const params = paramsNode?.text ?? "()";
  const ret = node.childForFieldName("return_type")?.text ?? "";
  return `${name}${params}${ret ? ` ${ret}` : ""}`;
}

function collectDecorators(node: SyntaxNode): string[] {
  const decs: string[] = [];
  for (const child of node.namedChildren) {
    if (child.type === "decorator") {
      decs.push(child.text.trim().replace(/^@/, ""));
    }
  }
  return decs;
}

function tsExtractCalls(node: SyntaxNode): string[] {
  const calls: string[] = [];
  const seen = new Set<string>();
  const walk = (n: SyntaxNode): void => {
    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function");
      if (fn && !seen.has(fn.text)) {
        seen.add(fn.text);
        calls.push(fn.text);
      }
    } else if (n.type === "new_expression") {
      const ctor = n.childForFieldName("constructor");
      if (ctor && !seen.has(ctor.text)) {
        seen.add(ctor.text);
        calls.push(ctor.text);
      }
    }
    for (const child of n.namedChildren) walk(child);
  };
  const body = node.childForFieldName("body");
  if (body) walk(body);
  return calls;
}

function bareTypeName(node: SyntaxNode): string {
  if (node.type === "generic_type") {
    const inner = node.namedChildren.find(
      (c) => c.type === "type_identifier" || c.type === "nested_type_identifier" || c.type === "identifier",
    );
    if (inner) return inner.text;
  }
  return node.text;
}

function unquoteString(raw: string): string {
  if (raw.length < 2) return raw;
  const f = raw[0];
  const l = raw[raw.length - 1];
  if ((f === '"' || f === "'" || f === "`") && f === l) return raw.slice(1, -1);
  return raw;
}

// ═══════════════════════════════════════════════════════════════════════════
// REGEX EXTRACTION (FALLBACK)
// ═══════════════════════════════════════════════════════════════════════════

function regexExtract(filePath: string, source: string, lineCount: number): FileOutline {
  const lines = source.split("\n");
  const imports: ImportEntry[] = [];
  const functions: FunctionEntry[] = [];
  const classes: ClassEntry[] = [];

  const importRe = /^\s*import(?:\s+type)?\s+([^;]+?)\s+from\s+['"]([^'"]+)['"]/;
  const sideEffectRe = /^\s*import\s+['"]([^'"]+)['"]/;
  const reExportRe = /^\s*export(?:\s+type)?\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/;
  const fnRe = /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/;
  const arrowRe = /^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::[^=]+)?=>/;
  const classRe = /^\s*(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+([^\s{]+))?(?:\s+implements\s+([^\s{]+(?:\s*,\s*[^\s{]+)*))?/;
  const interfaceRe = /^\s*(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([^\s{]+(?:\s*,\s*[^\s{]+)*))?/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const imp = importRe.exec(line);
    if (imp) {
      imports.push({
        module: imp[2]!,
        names: parseImportNames(imp[1]!),
        line: i + 1,
      });
      continue;
    }
    const side = sideEffectRe.exec(line);
    if (side) {
      imports.push({ module: side[1]!, line: i + 1 });
      continue;
    }
    const re = reExportRe.exec(line);
    if (re) {
      imports.push({ module: re[1]!, line: i + 1 });
      continue;
    }

    const fn = fnRe.exec(line);
    if (fn) {
      functions.push({
        name: fn[1]!,
        signature: `${fn[1]}(${fn[2]})`,
        decorators: [],
        start_line: i + 1,
        end_line: rxFindBlockEnd(lines, i),
        calls: [],
      });
      continue;
    }

    const arr = arrowRe.exec(line);
    if (arr) {
      functions.push({
        name: arr[1]!,
        signature: `${arr[1]}(${arr[2]})`,
        decorators: [],
        start_line: i + 1,
        end_line: rxFindBlockEnd(lines, i),
        calls: [],
      });
      continue;
    }

    const cls = classRe.exec(line);
    if (cls) {
      const bases: string[] = [];
      if (cls[2]) bases.push(cls[2]);
      if (cls[3]) bases.push(...cls[3].split(",").map((b) => b.trim()));
      classes.push({
        name: cls[1]!,
        bases,
        start_line: i + 1,
        end_line: rxFindBlockEnd(lines, i),
        methods: [],
      });
      continue;
    }

    const iface = interfaceRe.exec(line);
    if (iface) {
      const bases = iface[2] ? iface[2].split(",").map((b) => b.trim()) : [];
      classes.push({
        name: iface[1]!,
        bases,
        start_line: i + 1,
        end_line: rxFindBlockEnd(lines, i),
        methods: [],
      });
    }
  }

  return { file_path: filePath, line_count: lineCount, imports, functions, classes };
}

function parseImportNames(spec: string): string[] {
  const trimmed = spec.trim();
  // Remove `* as ns` namespace imports → normalize to one entry
  if (trimmed.startsWith("*")) return [trimmed];

  const names: string[] = [];
  const namedMatch = /\{([^}]+)\}/.exec(trimmed);
  if (namedMatch) {
    for (const part of namedMatch[1]!.split(",")) {
      const clean = part.trim().split(/\s+as\s+/)[0]!.trim();
      if (clean) names.push(clean);
    }
  }
  // Default import (anything before the optional `,`)
  const defaultPart = trimmed.split(",")[0]!.trim();
  if (defaultPart && !defaultPart.startsWith("{")) {
    names.unshift(defaultPart);
  }
  return names;
}

function rxFindBlockEnd(lines: string[], startIdx: number): number {
  let depth = 0;
  let opened = false;
  for (let k = startIdx; k < lines.length; k++) {
    const line = lines[k]!;
    for (const ch of line) {
      if (ch === "{") {
        depth++;
        opened = true;
      } else if (ch === "}") {
        depth--;
        if (opened && depth === 0) return k + 1;
      }
    }
  }
  return lines.length;
}
