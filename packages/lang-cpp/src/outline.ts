/**
 * C++ outline factory.
 *
 * Builds on the shared `createCFamilyOutline` helper from
 * `@reponova/lang-c-core` (bound to `tree-sitter-cpp.wasm` instead of
 * `tree-sitter-c.wasm`) and wraps the tree-sitter extraction step to
 * additionally surface C++-only top-level shapes: namespace bodies
 * (recursed into) and class declarations (emitted as outline classes
 * with their member methods).
 *
 * For the regex fallback we extend the C-family regex to recognise
 * `class Foo` and `namespace foo` openings; both are surfaced as
 * outline classes with empty `methods` arrays. The fallback is
 * deliberately conservative — exact AST-grade analysis is out of
 * scope for the regex path, which only runs when the WASM grammar is
 * unavailable.
 */
import type { LanguageSupport, SyntaxNode } from "reponova";
import {
  createCFamilyOutline,
  extractDeclaratorName,
  findFunctionDeclarator,
} from "@reponova/lang-c-core";

const cFamily = createCFamilyOutline({ wasmFile: "tree-sitter-cpp.wasm" });

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
interface ImportEntry { module: string; names?: string[]; line: number; }
interface FileOutline {
  file_path: string;
  line_count: number;
  imports: ImportEntry[];
  functions: FunctionEntry[];
  classes: ClassEntry[];
}

/**
 * `LanguageSupport` for C++ outlines. Tree-sitter path enhances the
 * shared C-family outline with namespace recursion and class
 * extraction; the regex fallback adds `class`/`namespace` openings.
 */
export const cpp: LanguageSupport = {
  wasmFile: "tree-sitter-cpp.wasm",
  treeSitterExtract: (root, filePath, lineCount) => {
    const base = cFamily.treeSitterExtract!(root, filePath, lineCount) as FileOutline;
    enrichWithCppShapes(root, base);
    return base;
  },
  regexExtract: (filePath, source, lineCount) => {
    const base = cFamily.regexExtract!(filePath, source, lineCount) as FileOutline;
    enrichRegex(source, base);
    return base;
  },
};

// ─── Tree-sitter enrichment ───────────────────────────────────────────────

/**
 * Walk the root looking for `namespace_definition` and `class_specifier`
 * nodes the C outline ignored. We descend through namespaces so a
 * class inside `namespace foo { … }` still surfaces. The base outline
 * already covered top-level functions and structs/enums.
 */
function enrichWithCppShapes(root: SyntaxNode, outline: FileOutline): void {
  const seen = new Set<string>(outline.classes.map((c) => `${c.name}@${c.start_line}`));

  const walk = (node: SyntaxNode): void => {
    for (const child of node.namedChildren) {
      if (child.type === "namespace_definition") {
        const body = child.childForFieldName("body");
        if (body) walk(body);
        continue;
      }
      if (child.type === "template_declaration") {
        // Walk inside the template to find the wrapped class.
        walk(child);
        continue;
      }
      if (child.type === "class_specifier") {
        const cls = extractClassOutline(child);
        if (cls) {
          const key = `${cls.name}@${cls.start_line}`;
          if (!seen.has(key)) {
            seen.add(key);
            outline.classes.push(cls);
          }
        }
        continue;
      }
      // `declaration_list` and similar containers inside namespaces
      // are handled by recursing here.
      if (child.type === "declaration_list" || child.type === "linkage_specification") {
        walk(child);
      }
    }
  };

  walk(root);
}

function extractClassOutline(node: SyntaxNode): ClassEntry | null {
  const nameNode = node.childForFieldName("name");
  const body = node.childForFieldName("body");
  if (!nameNode || !body) return null;

  const bases: string[] = [];
  for (const child of node.namedChildren) {
    if (child.type === "base_class_clause") {
      for (const baseChild of child.namedChildren) {
        if (
          baseChild.type === "type_identifier" ||
          baseChild.type === "template_type" ||
          baseChild.type === "qualified_identifier"
        ) {
          bases.push(baseChild.text);
        }
      }
    }
  }

  const methods: FunctionEntry[] = [];
  for (const child of body.namedChildren) {
    if (child.type === "function_definition") {
      const fn = methodFromFunctionDefinition(child);
      if (fn) methods.push(fn);
      continue;
    }
    if (child.type === "field_declaration") {
      // Method declaration (no body) — declarator is a function_declarator.
      const fn = methodFromFieldDeclaration(child);
      if (fn) methods.push(fn);
      continue;
    }
    if (child.type === "declaration") {
      // ctor / dtor declaration in class body.
      const fn = methodFromCtorOrDtor(child);
      if (fn) methods.push(fn);
      continue;
    }
  }

  return {
    name: nameNode.text,
    bases,
    docstring: extractClassDocstring(node),
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    methods,
  };
}

function methodFromFunctionDefinition(node: SyntaxNode): FunctionEntry | null {
  const declarator = node.childForFieldName("declarator");
  if (!declarator) return null;
  const funcDecl = findFunctionDeclarator(declarator);
  if (!funcDecl) return null;
  const name = extractDeclaratorName(funcDecl.childForFieldName("declarator"));
  if (!name) return null;
  const params = funcDecl.childForFieldName("parameters")?.text ?? "()";
  const returnType = node.childForFieldName("type")?.text ?? "";
  return {
    name,
    signature: `${name}${params}${returnType ? `: ${returnType}` : ""}`,
    decorators: [],
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    calls: [],
  };
}

function methodFromFieldDeclaration(node: SyntaxNode): FunctionEntry | null {
  const declarator = node.childForFieldName("declarator");
  if (!declarator || declarator.type !== "function_declarator") return null;
  const name = extractDeclaratorName(declarator.childForFieldName("declarator"));
  if (!name) return null;
  const params = declarator.childForFieldName("parameters")?.text ?? "()";
  const returnType = node.childForFieldName("type")?.text ?? "";
  return {
    name,
    signature: `${name}${params}${returnType ? `: ${returnType}` : ""}`,
    decorators: ["declaration"],
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    calls: [],
  };
}

function methodFromCtorOrDtor(node: SyntaxNode): FunctionEntry | null {
  const declarator = node.childForFieldName("declarator");
  if (!declarator) return null;
  const funcDecl = findFunctionDeclarator(declarator);
  if (!funcDecl) return null;
  const name = extractDeclaratorName(funcDecl.childForFieldName("declarator"));
  if (!name) return null;
  const params = funcDecl.childForFieldName("parameters")?.text ?? "()";
  return {
    name,
    signature: `${name}${params}`,
    decorators: ["declaration"],
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    calls: [],
  };
}

function extractClassDocstring(node: SyntaxNode): string | undefined {
  const parent = node.parent;
  if (!parent) return undefined;
  const siblings = parent.namedChildren;
  const targetRow = node.startPosition.row;
  let idx = -1;
  for (let i = 0; i < siblings.length; i++) {
    if (siblings[i]!.startPosition.row === targetRow && siblings[i]!.type === node.type) {
      idx = i;
      break;
    }
  }
  if (idx <= 0) return undefined;
  const prev = siblings[idx - 1]!;
  if (prev.type !== "comment") return undefined;
  const t = prev.text;
  if (!t.startsWith("/**") && !t.startsWith("/*!")) return undefined;
  const body = t.replace(/^\/\*\*|^\/\*!/, "").replace(/\*\/$/, "");
  const lines = body
    .split("\n")
    .map((l) => l.replace(/^\s*\*+\s?/, "").trim())
    .filter((l) => l.length > 0 && !l.startsWith("@") && !l.startsWith("\\"));
  return lines[0];
}

// ─── Regex enrichment ─────────────────────────────────────────────────────

const CLASS_RE = /^\s*(?:template\s*<[^>]*>\s*)?(?:class|struct)\s+([A-Za-z_][A-Za-z_0-9]*)\s*(?::[^{]*)?[{]/;
const NAMESPACE_RE = /^\s*namespace\s+([A-Za-z_][A-Za-z_0-9]*)\s*[{]/;

function enrichRegex(source: string, outline: FileOutline): void {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const classMatch = CLASS_RE.exec(line);
    if (classMatch) {
      const name = classMatch[1]!;
      const exists = outline.classes.some((c) => c.name === name);
      if (!exists) {
        outline.classes.push({
          name,
          bases: [],
          start_line: i + 1,
          end_line: i + 1,
          methods: [],
        });
      }
      continue;
    }
    const nsMatch = NAMESPACE_RE.exec(line);
    if (nsMatch) {
      const name = nsMatch[1]!;
      const exists = outline.classes.some((c) => c.name === name);
      if (!exists) {
        outline.classes.push({
          name,
          bases: [],
          start_line: i + 1,
          end_line: i + 1,
          methods: [],
        });
      }
    }
  }
}
