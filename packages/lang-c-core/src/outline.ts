/**
 * C-family language support for outline generation.
 *
 * Two extraction strategies, parallel to the extractor:
 *   1. tree-sitter (primary): full AST parsing via WASM grammar
 *   2. regex (fallback): line-oriented pattern matching when WASM is
 *      unavailable (e.g. on cold-start, before grammars are fetched).
 *
 * The regex fallback is deliberately conservative — it only recognises
 * the most common shapes (`#include`, single-line `#define`, plain
 * `static? type name(...)` function definitions, and `struct/enum NAME`
 * declarations) — and is meant as a graceful degradation, not a parser
 * replacement.
 *
 * The factory `createCFamilyOutline({ wasmFile })` lets the C and C++
 * plugins share the same outline implementation while binding to
 * different grammar artefacts. A pre-bound `c` export ships the C
 * default for convenience.
 */
import type { LanguageSupport, SyntaxNode } from "reponova";
import {
  extractDeclaratorName,
  findFunctionDeclarator,
} from "./extractor.js";

interface ImportEntry { module: string; names?: string[]; line: number; }
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

/** Options for `createCFamilyOutline`. */
export interface CFamilyOutlineOptions {
  /** WASM grammar filename (e.g. `"tree-sitter-c.wasm"`, `"tree-sitter-cpp.wasm"`). */
  wasmFile: string;
}

/**
 * Build a `LanguageSupport` instance that produces a `FileOutline` for
 * a C-family source file. The same logic powers both C and C++; the
 * only difference is the `wasmFile` field consumed by the outline
 * loader to find the right grammar artefact.
 */
export function createCFamilyOutline(opts: CFamilyOutlineOptions): LanguageSupport {
  return {
    wasmFile: opts.wasmFile,
    treeSitterExtract,
    regexExtract,
  };
}

/** Default outline implementation bound to `tree-sitter-c.wasm`. */
export const c: LanguageSupport = createCFamilyOutline({ wasmFile: "tree-sitter-c.wasm" });

// ═══════════════════════════════════════════════════════════════════════════
// TREE-SITTER EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

function treeSitterExtract(rootNode: SyntaxNode, filePath: string, lineCount: number): FileOutline {
  const imports: ImportEntry[] = [];
  const functions: FunctionEntry[] = [];
  const classes: ClassEntry[] = [];

  for (const child of rootNode.namedChildren) {
    switch (child.type) {
      case "preproc_include":
        imports.push(tsExtractInclude(child));
        break;
      case "function_definition": {
        const fn = tsExtractFunction(child);
        if (fn) functions.push(fn);
        break;
      }
      case "struct_specifier":
      case "union_specifier": {
        const cls = tsExtractRecord(child);
        if (cls) classes.push(cls);
        break;
      }
      case "enum_specifier": {
        const cls = tsExtractEnum(child);
        if (cls) classes.push(cls);
        break;
      }
      case "type_definition": {
        // Surface inline struct/union/enum specifiers buried in
        // typedefs as outline classes.
        const inner = child.childForFieldName("type");
        if (
          inner &&
          (inner.type === "struct_specifier" || inner.type === "union_specifier")
        ) {
          const cls = tsExtractRecord(inner);
          if (cls) classes.push(cls);
        } else if (inner && inner.type === "enum_specifier") {
          const cls = tsExtractEnum(inner);
          if (cls) classes.push(cls);
        }
        break;
      }
    }
  }

  return { file_path: filePath, line_count: lineCount, imports, functions, classes };
}

function tsExtractInclude(node: SyntaxNode): ImportEntry {
  const pathNode = node.childForFieldName("path");
  let modulePath = "";
  if (pathNode) {
    if (pathNode.type === "system_lib_string") {
      modulePath = pathNode.text;
    } else if (pathNode.type === "string_literal") {
      const inner = pathNode.namedChildren.find((c) => c.type === "string_content");
      modulePath = inner ? inner.text : pathNode.text.replace(/^"|"$/g, "");
    } else {
      modulePath = pathNode.text;
    }
  }
  return { module: modulePath, line: node.startPosition.row + 1 };
}

function tsExtractFunction(node: SyntaxNode): FunctionEntry | null {
  const declarator = node.childForFieldName("declarator");
  if (!declarator) return null;
  const funcDecl = findFunctionDeclarator(declarator);
  if (!funcDecl) return null;
  const name = extractDeclaratorName(funcDecl.childForFieldName("declarator"));
  if (!name) return null;

  const params = funcDecl.childForFieldName("parameters")?.text ?? "()";
  const returnType = node.childForFieldName("type")?.text ?? "";
  const signature = `${name}${params}${returnType ? `: ${returnType}` : ""}`;
  const decorators = collectModifierTokens(node);
  const docstring = tsExtractDocstring(node);
  const calls = tsExtractCalls(node);

  return {
    name,
    signature,
    decorators,
    docstring,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    calls,
  };
}

function tsExtractRecord(node: SyntaxNode): ClassEntry | null {
  const nameNode = node.childForFieldName("name");
  const body = node.childForFieldName("body");
  if (!nameNode || !body) return null;
  return {
    name: nameNode.text,
    bases: [],
    docstring: tsExtractDocstring(node),
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    methods: [],
  };
}

function tsExtractEnum(node: SyntaxNode): ClassEntry | null {
  const nameNode = node.childForFieldName("name");
  const body = node.childForFieldName("body");
  if (!nameNode || !body) return null;
  return {
    name: nameNode.text,
    bases: [],
    docstring: tsExtractDocstring(node),
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    methods: [],
  };
}

function tsExtractDocstring(node: SyntaxNode): string | undefined {
  const parent = node.parent;
  if (!parent) return undefined;
  const siblings = parent.namedChildren;
  const targetRow = node.startPosition.row;
  const targetCol = node.startPosition.column;
  let idx = -1;
  for (let i = 0; i < siblings.length; i++) {
    const s = siblings[i]!;
    if (
      s.startPosition.row === targetRow &&
      s.startPosition.column === targetCol &&
      s.type === node.type
    ) {
      idx = i;
      break;
    }
  }
  if (idx <= 0) return undefined;
  const prev = siblings[idx - 1]!;
  if (prev.type !== "comment") return undefined;
  const text = prev.text;
  if (!text.startsWith("/**") && !text.startsWith("/*!")) return undefined;
  const body = text.replace(/^\/\*\*|^\/\*!/, "").replace(/\*\/$/, "");
  const lines = body
    .split("\n")
    .map((l) => l.replace(/^\s*\*+\s?/, "").trim())
    .filter((l) => l.length > 0 && !l.startsWith("@") && !l.startsWith("\\"));
  if (lines.length === 0) return undefined;
  const summary = lines[0]!;
  return summary.length > 300 ? summary.slice(0, 297) + "..." : summary;
}

function tsExtractCalls(node: SyntaxNode): string[] {
  const calls: string[] = [];
  const seen = new Set<string>();
  const walk = (n: SyntaxNode): void => {
    if (n.type === "call_expression") {
      const callee = n.namedChildren[0];
      if (callee) {
        const name = calleeText(callee);
        if (name && !seen.has(name)) {
          seen.add(name);
          calls.push(name);
        }
      }
    }
    for (const c of n.namedChildren) walk(c);
  };
  const body = node.childForFieldName("body");
  if (body) walk(body);
  return calls;
}

function calleeText(node: SyntaxNode): string | null {
  if (node.type === "identifier") return node.text;
  if (node.type === "field_expression") {
    const argNode = node.childForFieldName("argument");
    const fieldNode = node.childForFieldName("field");
    if (!fieldNode) return null;
    return argNode ? `${argNode.text}.${fieldNode.text}` : fieldNode.text;
  }
  if (node.type === "parenthesized_expression") {
    const inner = node.namedChildren[0];
    return inner ? calleeText(inner) : null;
  }
  const t = node.text.replace(/\s+/g, " ").trim();
  return t.length > 0 ? t : null;
}

function collectModifierTokens(node: SyntaxNode): string[] {
  const out: string[] = [];
  for (const child of node.namedChildren) {
    if (child.type === "storage_class_specifier" || child.type === "type_qualifier") {
      out.push(child.text);
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// REGEX EXTRACTION (FALLBACK)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Strip line comments (`// …`) and block comments (`/* … *\/`) so the
 * line-oriented regexes downstream don't trip over them. We replace
 * comment spans with spaces (not removed) to preserve line/column
 * counts. String and char literals are also neutralised so a `#include`
 * inside a string can't masquerade as a directive.
 */
function stripCommentsAndStrings(source: string): string {
  const out = source.split("");
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i]!;
    const next = i + 1 < n ? source[i + 1] : "";
    if (ch === "/" && next === "/") {
      let j = i;
      while (j < n && source[j] !== "\n") {
        out[j] = " ";
        j++;
      }
      i = j;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      for (let k = i; k < stop; k++) {
        if (out[k] !== "\n") out[k] = " ";
      }
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        if (source[j] === "\\") {
          if (j + 1 < n && source[j + 1] !== "\n") out[j + 1] = " ";
          j += 2;
          continue;
        }
        if (source[j] === quote) break;
        if (source[j] !== "\n") out[j] = " ";
        j++;
      }
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join("");
}

const INCLUDE_RE = /^\s*#\s*include\s+(<[^>]+>|"[^"]+")/;
const DEFINE_OBJECT_RE = /^\s*#\s*define\s+([A-Za-z_][A-Za-z_0-9]*)(?!\s*\()/;
const DEFINE_FN_RE = /^\s*#\s*define\s+([A-Za-z_][A-Za-z_0-9]*)\s*\(([^)]*)\)/;
const RECORD_RE = /^\s*(?:typedef\s+)?(struct|union|enum)\s+([A-Za-z_][A-Za-z_0-9]*)\s*[{]/;
const FUNCTION_RE =
  /^\s*(?:(?:static|extern|inline|const|volatile|register|auto|_Atomic|__inline|__forceinline)\s+)*[\w\s*]+?\s+\*?\s*([A-Za-z_][A-Za-z_0-9]*)\s*\([^)]*\)\s*[{]/;

function regexExtract(filePath: string, source: string, lineCount: number): FileOutline {
  const stripped = stripCommentsAndStrings(source);
  const lines = stripped.split("\n");
  const imports: ImportEntry[] = [];
  const functions: FunctionEntry[] = [];
  const classes: ClassEntry[] = [];

  let braceDepth = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // Only consider top-level shapes (brace depth 0). Inside a body the
    // regexes can't be trusted.
    if (braceDepth === 0) {
      const incMatch = INCLUDE_RE.exec(line);
      if (incMatch) {
        imports.push({ module: incMatch[1]!, line: i + 1 });
      } else {
        const defFnMatch = DEFINE_FN_RE.exec(line);
        if (defFnMatch) {
          functions.push({
            name: defFnMatch[1]!,
            signature: `${defFnMatch[1]!}(${defFnMatch[2]!})`,
            decorators: ["macro", "function_like"],
            start_line: i + 1,
            end_line: i + 1,
            calls: [],
          });
        } else {
          const defMatch = DEFINE_OBJECT_RE.exec(line);
          if (defMatch) {
            // Macros are not free-standing functions in outline terms —
            // they live on the file but neither `functions` nor
            // `classes` quite fit. We surface them as functions tagged
            // `macro` for uniformity with the extractor's surface.
            functions.push({
              name: defMatch[1]!,
              signature: defMatch[1]!,
              decorators: ["macro"],
              start_line: i + 1,
              end_line: i + 1,
              calls: [],
            });
          }
        }
        const recordMatch = RECORD_RE.exec(line);
        if (recordMatch) {
          classes.push({
            name: recordMatch[2]!,
            bases: [],
            start_line: i + 1,
            end_line: i + 1,
            methods: [],
          });
        } else {
          const fnMatch = FUNCTION_RE.exec(line);
          if (fnMatch) {
            const name = fnMatch[1]!;
            if (name !== "if" && name !== "while" && name !== "for" && name !== "switch") {
              functions.push({
                name,
                signature: line.trim().replace(/\s*[{]$/, ""),
                decorators: [],
                start_line: i + 1,
                end_line: i + 1,
                calls: [],
              });
            }
          }
        }
      }
    }

    for (const ch of line) {
      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
    }
    i++;
  }

  return { file_path: filePath, line_count: lineCount, imports, functions, classes };
}
