/**
 * Java language support for outline generation.
 *
 * Two extraction strategies, parallel to the extractor:
 *   1. tree-sitter (primary): full AST parsing via WASM grammar
 *   2. regex (fallback): line-oriented pattern matching when WASM is
 *      unavailable (e.g. on cold-start, before grammars are fetched).
 *
 * The regex fallback is deliberately conservative — it only recognises
 * the most common shapes (single-line declarations of classes /
 * interfaces / enums / methods, plus straight-line `import` lines) and
 * is meant as a graceful degradation, not a parser replacement.
 */
import type { LanguageSupport, SyntaxNode } from "reponova";

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

export const java: LanguageSupport = {
  wasmFile: "tree-sitter-java.wasm",
  treeSitterExtract,
  regexExtract,
};

// ═══════════════════════════════════════════════════════════════════════════
// TREE-SITTER EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

const TYPE_DECLARATIONS = new Set([
  "class_declaration",
  "interface_declaration",
  "enum_declaration",
  "record_declaration",
  "annotation_type_declaration",
]);

function treeSitterExtract(rootNode: SyntaxNode, filePath: string, lineCount: number): FileOutline {
  const imports: ImportEntry[] = [];
  const classes: ClassEntry[] = [];

  for (const child of rootNode.namedChildren) {
    if (child.type === "import_declaration") {
      imports.push(tsExtractImport(child));
    } else if (TYPE_DECLARATIONS.has(child.type)) {
      classes.push(tsExtractType(child));
    }
  }

  // Java has no free-standing top-level functions, so `functions` stays
  // empty by design — the outline mirrors the language surface.
  return { file_path: filePath, line_count: lineCount, imports, functions: [], classes };
}

function tsExtractImport(node: SyntaxNode): ImportEntry {
  let isWildcard = false;
  let dotted = "";
  for (const child of node.namedChildren) {
    if (child.type === "scoped_identifier" || child.type === "identifier") {
      dotted = child.text;
    } else if (child.type === "asterisk") {
      isWildcard = true;
    }
  }
  const idx = dotted.lastIndexOf(".");
  if (isWildcard) {
    return { module: dotted, line: node.startPosition.row + 1 };
  }
  if (idx > 0) {
    return {
      module: dotted.slice(0, idx),
      names: [dotted.slice(idx + 1)],
      line: node.startPosition.row + 1,
    };
  }
  return { module: dotted, line: node.startPosition.row + 1 };
}

function tsExtractType(node: SyntaxNode): ClassEntry {
  const nameNode = node.childForFieldName("name");
  const name = nameNode?.text ?? "<anonymous>";

  const bases: string[] = [];
  for (const child of node.namedChildren) {
    if (child.type === "superclass") {
      for (const c of child.namedChildren) {
        const b = unwrapType(c);
        if (b) bases.push(b);
      }
    } else if (child.type === "super_interfaces" || child.type === "extends_interfaces") {
      for (const list of child.namedChildren) {
        if (list.type === "type_list") {
          for (const t of list.namedChildren) {
            const b = unwrapType(t);
            if (b) bases.push(b);
          }
        } else {
          const b = unwrapType(list);
          if (b) bases.push(b);
        }
      }
    }
  }

  const docstring = tsExtractDocstring(node);

  const methods: FunctionEntry[] = [];
  const body = node.childForFieldName("body");
  if (body) {
    collectMethods(body, methods);
  }

  return {
    name,
    bases,
    docstring,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    methods,
  };
}

function collectMethods(container: SyntaxNode, out: FunctionEntry[]): void {
  for (const child of container.namedChildren) {
    if (child.type === "method_declaration" || child.type === "constructor_declaration") {
      out.push(tsExtractMethod(child));
    } else if (child.type === "enum_body_declarations") {
      collectMethods(child, out);
    }
  }
}

function tsExtractMethod(node: SyntaxNode): FunctionEntry {
  const nameNode = node.childForFieldName("name") ?? node.namedChildren.find((c) => c.type === "identifier");
  const name = nameNode?.text ?? "<anonymous>";
  const paramsNode = node.childForFieldName("parameters");
  const params = paramsNode?.text ?? "()";
  const returnType = node.childForFieldName("type");
  const ret = returnType ? `: ${returnType.text}` : "";
  const signature = `${name}${params}${ret}`;
  const decorators = tsExtractAnnotations(node);
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

function tsExtractAnnotations(node: SyntaxNode): string[] {
  const out: string[] = [];
  const modifiers = node.namedChildren.find((c) => c.type === "modifiers");
  if (!modifiers) return out;
  for (const child of modifiers.namedChildren) {
    if (child.type === "marker_annotation" || child.type === "annotation") {
      const idNode = child.namedChildren.find(
        (c) => c.type === "identifier" || c.type === "scoped_identifier",
      );
      if (idNode) out.push(idNode.text);
    }
  }
  return out;
}

function tsExtractDocstring(node: SyntaxNode): string | undefined {
  const parent = node.parent;
  if (!parent) return undefined;
  const siblings = parent.namedChildren;
  const idx = siblings.indexOf(node);
  if (idx <= 0) return undefined;
  const prev = siblings[idx - 1]!;
  if (prev.type !== "block_comment") return undefined;
  const text = prev.text;
  if (!text.startsWith("/**")) return undefined;
  const stripped = text
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").trim())
    .filter((l) => l.length > 0 && !l.startsWith("@"));
  if (stripped.length === 0) return undefined;
  const summary = stripped[0]!;
  return summary.length > 300 ? summary.slice(0, 297) + "..." : summary;
}

function tsExtractCalls(node: SyntaxNode): string[] {
  const calls: string[] = [];
  const seen = new Set<string>();
  const walk = (n: SyntaxNode): void => {
    if (n.type === "method_invocation") {
      const obj = n.childForFieldName("object");
      const nm = n.childForFieldName("name");
      if (nm) {
        const callName = obj ? `${obj.text}.${nm.text}` : nm.text;
        if (!seen.has(callName)) {
          seen.add(callName);
          calls.push(callName);
        }
      }
    } else if (n.type === "object_creation_expression") {
      const t = n.childForFieldName("type");
      if (t) {
        const callName = unwrapType(t) ?? t.text;
        if (!seen.has(callName)) {
          seen.add(callName);
          calls.push(callName);
        }
      }
    }
    for (const c of n.namedChildren) walk(c);
  };
  const body = node.childForFieldName("body");
  if (body) walk(body);
  return calls;
}

function unwrapType(node: SyntaxNode): string | null {
  switch (node.type) {
    case "type_identifier":
    case "identifier":
    case "scoped_identifier":
    case "scoped_type_identifier":
      return node.text;
    case "generic_type": {
      const inner = node.namedChildren.find(
        (c) => c.type === "type_identifier" || c.type === "scoped_type_identifier" || c.type === "scoped_identifier",
      );
      return inner ? inner.text : null;
    }
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// REGEX EXTRACTION (FALLBACK)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Strip line comments (`// …`) and block comments (`/* … *\/`) so the
 * line-oriented regexes downstream don't trip over them. We replace
 * comment spans with spaces (not removed) to preserve column / line
 * counts. Strings are not specially handled — Java string content rarely
 * looks like a top-level declaration, and the regex pass is best-effort
 * by design.
 */
function stripComments(source: string): string {
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
    i++;
  }
  return out.join("");
}

function regexExtract(filePath: string, source: string, lineCount: number): FileOutline {
  const stripped = stripComments(source);
  const lines = stripped.split("\n");
  const imports: ImportEntry[] = [];
  const classes: ClassEntry[] = [];
  let currentClass: ClassEntry | null = null;
  let braceDepth = 0;
  let classBraceDepth = -1;

  const importRe = /^\s*import\s+(static\s+)?([\w.$]+)(\.\*)?\s*;/;
  const typeRe = /^\s*(?:(?:public|private|protected|static|final|abstract|sealed|non-sealed|default)\s+)*(class|interface|enum|record|@interface)\s+(\w+)/;
  const methodRe = /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|default|native)\s+)*[\w<>[\],\s.?$]+?\s+(\w+)\s*\(([^)]*)\)\s*(?:throws[\w\s,.]*)?\s*[{;]/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const importMatch = importRe.exec(line);
    if (importMatch && currentClass === null) {
      const dotted = importMatch[2]!;
      const isWildcard = !!importMatch[3];
      if (isWildcard) {
        imports.push({ module: dotted, line: i + 1 });
      } else {
        const idx = dotted.lastIndexOf(".");
        if (idx > 0) {
          imports.push({
            module: dotted.slice(0, idx),
            names: [dotted.slice(idx + 1)],
            line: i + 1,
          });
        } else {
          imports.push({ module: dotted, line: i + 1 });
        }
      }
      continue;
    }

    if (braceDepth === 0) {
      const typeMatch = typeRe.exec(line);
      if (typeMatch) {
        if (currentClass) {
          currentClass.end_line = i;
          classes.push(currentClass);
        }
        currentClass = {
          name: typeMatch[2]!,
          bases: regexExtractBases(line),
          start_line: i + 1,
          end_line: lineCount,
          methods: [],
        };
        classBraceDepth = braceDepth;
      }
    } else if (currentClass !== null && braceDepth === classBraceDepth + 1) {
      const methodMatch = methodRe.exec(line);
      if (methodMatch) {
        const name = methodMatch[1]!;
        const params = methodMatch[2] ?? "";
        if (name !== "if" && name !== "for" && name !== "while" && name !== "switch" && name !== "return" && name !== "catch") {
          currentClass.methods.push({
            name,
            signature: `${name}(${params})`,
            decorators: [],
            start_line: i + 1,
            end_line: i + 1,
            calls: [],
          });
        }
      }
    }

    for (const ch of line) {
      if (ch === "{") braceDepth++;
      else if (ch === "}") {
        braceDepth--;
        if (currentClass && braceDepth === classBraceDepth) {
          currentClass.end_line = i + 1;
          classes.push(currentClass);
          currentClass = null;
          classBraceDepth = -1;
        }
      }
    }
  }

  if (currentClass) {
    currentClass.end_line = lineCount;
    classes.push(currentClass);
  }

  return { file_path: filePath, line_count: lineCount, imports, functions: [], classes };
}

function regexExtractBases(line: string): string[] {
  const bases: string[] = [];
  const extMatch = /extends\s+([\w<>,\s.$]+?)(?:\s+implements|\s*\{)/.exec(line);
  if (extMatch) {
    for (const t of extMatch[1]!.split(",")) {
      const cleaned = t.replace(/<[^>]*>/g, "").trim();
      if (cleaned) bases.push(cleaned);
    }
  }
  const impMatch = /implements\s+([\w<>,\s.$]+?)\s*\{/.exec(line);
  if (impMatch) {
    for (const t of impMatch[1]!.split(",")) {
      const cleaned = t.replace(/<[^>]*>/g, "").trim();
      if (cleaned) bases.push(cleaned);
    }
  }
  return bases;
}
