/**
 * C-family language extractor (C and C++ shared base).
 *
 * Extracts top-level functions, function declarations (`extern`), struct
 * / union / enum definitions and their members, typedefs, object-like
 * and function-like macros, global variables, plus their `#include`
 * imports and intra-function call references from C/C++ source via
 * tree-sitter AST parsing.
 *
 * Qualified names are derived from the file path (POSIX dirs joined by
 * `.`), mirroring `lang-python`. For `src/util.c`:
 *   - module = `src.util`
 *   - `add` (function)              → qualifiedName `src.util.add`
 *   - `Point` (struct)              → qualifiedName `src.util.Point`
 *   - `Point.x` (field)             → qualifiedName `src.util.Point.x`
 *   - `Color.RED` (enum constant)   → qualifiedName `src.util.Color.RED`
 *
 * The extractor exposes a `scope` parameter on every dispatch / extract
 * method that defaults to the file's module name. C++ subclasses
 * extend the scope when walking into `namespace_definition` nodes
 * (`module + ".ns1.ns2"`) so symbols emitted from inside a namespace
 * carry the correct qualified path.
 *
 * `#include "x.h"` is treated as a wildcard import (every public symbol
 * in the included header is brought into scope). `#include <x.h>` is
 * recorded as-is (with literal angle brackets preserved in `module`) so
 * the resolver can tell apart user includes from system includes: the
 * latter return no candidates because we can't resolve against unknown
 * system include paths.
 */
import type {
  LanguageExtractor,
  SyntaxTree,
  SyntaxNode,
  FileExtraction,
  FileNodeDeclaration,
  SymbolNode,
  ImportDeclaration,
  SymbolReference,
} from "reponova";

/**
 * Symbol kinds emitted by the C-family extractor. Aligned with the
 * conventional `SymbolKind` strings the graph builder recognises.
 */
export type CFamilyKind =
  | "function"
  | "class"
  | "method"
  | "variable"
  | "constant"
  | "enum"
  | "type"
  | "module";

/**
 * Top-level node types we descend into for symbol extraction in pure C.
 * C++ subclasses extend this set in their own `TOP_LEVEL_DECLARATIONS`
 * (or simply via their `dispatchTopLevel` override).
 */
export const C_TOP_LEVEL_DECLARATIONS: ReadonlySet<string> = new Set([
  "function_definition",
  "declaration",
  "struct_specifier",
  "union_specifier",
  "enum_specifier",
  "type_definition",
  "preproc_include",
  "preproc_def",
  "preproc_function_def",
]);

/**
 * Container nodes we recurse through transparently when scanning for
 * top-level declarations. C/C++ headers commonly bury everything inside
 * `#ifndef HEADER_H ... #endif` guards plus `extern "C" { ... }`
 * blocks, and platform-specific declarations live in `#if defined(...)`
 * branches. We surface declarations from every branch (including
 * `preproc_else` and `preproc_elif`) so the graph reflects the
 * combined public surface a downstream consumer might see across
 * different build configurations — under-extraction here is far
 * costlier than over-extraction.
 */
export const PREPROC_CONDITIONAL_CONTAINERS: ReadonlySet<string> = new Set([
  "preproc_ifdef",
  "preproc_if",
  "preproc_else",
  "preproc_elif",
  "preproc_elifdef",
  "preproc_elifndef",
]);

/** Constructor options for `CFamilyExtractor`. */
export interface CFamilyExtractorOptions {
  /** Language id (e.g. `"c"`, `"cpp"`). */
  languageId: string;
  /** File extensions handled by the parent plugin (e.g. `[".c", ".h"]`). */
  extensions: readonly string[];
  /** WASM grammar filename used by the parent plugin. */
  wasmFile: string;
}

/**
 * Shared `LanguageExtractor` for the C family.
 *
 * Most methods are `protected` so C++ subclasses can extend or
 * override individual extraction stages. The default `dispatchTopLevel`
 * handles the C subset (functions, structs, unions, enums, typedefs,
 * macros, globals, includes). Subclasses add C++-specific cases
 * (`namespace_definition`, `class_specifier`, `template_declaration`,
 * `using_declaration`, …) and chain back via `super.dispatchTopLevel`.
 */
export class CFamilyExtractor implements LanguageExtractor {
  readonly languageId: string;
  readonly extensions: string[];
  readonly wasmFile: string;

  constructor(opts: CFamilyExtractorOptions) {
    this.languageId = opts.languageId;
    this.extensions = [...opts.extensions];
    this.wasmFile = opts.wasmFile;
  }

  extract(tree: SyntaxTree, _sourceCode: string, filePath: string): FileExtraction {
    const symbols: SymbolNode[] = [];
    const imports: ImportDeclaration[] = [];
    const references: SymbolReference[] = [];

    const moduleName = filePathToModule(filePath);
    const fileName = posixBasename(filePath);
    const fileDocstring = this.extractFileDocstring(tree.rootNode);

    const fileNode: FileNodeDeclaration = {
      kind: "module",
      label: fileName,
      docstring: fileDocstring,
    };

    this.walkTopLevel(tree.rootNode, (node) => {
      this.dispatchTopLevel(node, symbols, references, imports, moduleName, moduleName);
    });

    const exports = this.computeExports(symbols, moduleName);
    return {
      filePath,
      language: this.languageId,
      fileNode,
      symbols,
      imports,
      references,
      exports,
    };
  }

  /**
   * Resolve a `#include` path to candidate file paths relative to repo
   * root. The graph builder matches the candidates against extracted
   * file paths by trailing-suffix match.
   *
   * Conventions:
   *   - `<stdio.h>` (angle-bracket / system include) — `module` is
   *     stored with the literal angle brackets preserved. We return no
   *     candidates because we don't know the project's system include
   *     paths.
   *   - `"util.h"`  (user include) — we return:
   *       1. the path relative to the including file's directory
   *          (the canonical C semantics), and
   *       2. the include path interpreted as repo-root-relative
   *          (covers `-I include/` style projects that pass the repo
   *          root or a subdir to the compiler with `-I`).
   *     We deduplicate the two candidates if they coincide.
   *
   * We make no attempt to consult a real compile_commands.json — the
   * extractor is intentionally a single-file operation and project-level
   * include search paths are a graph-builder concern.
   */
  resolveImportPath(importModule: string, currentFilePath: string): string[] {
    return resolveCInclude(importModule, currentFilePath);
  }

  // ─── Top-level dispatch ──────────────────────────────────────────────────

  /**
   * Walk the root node and any transparent container nodes
   * (`linkage_specification`, `preproc_ifdef`, `preproc_if`,
   * `preproc_else`, `preproc_elif`, `declaration_list`) applying
   * `action` to each real top-level statement. This lets us pick up
   * declarations buried inside an `extern "C" { ... }` block or behind
   * a `#ifndef HEADER_H ... #endif` guard or `#if defined(...)`
   * platform branch without duplicating dispatch logic at each call
   * site.
   *
   * The `isLeaf` predicate decides whether a node should be passed to
   * `action` or descended through. The default (`isCLeaf`) matches the
   * C subset; subclasses can override `topLevelLeafTypes` to include
   * additional node types (`namespace_definition`, `class_specifier`,
   * `template_declaration`, …) for C++.
   */
  protected walkTopLevel(node: SyntaxNode, action: (stmt: SyntaxNode) => void): void {
    const leafTypes = this.topLevelLeafTypes();
    for (const child of node.namedChildren) {
      if (child.type === "linkage_specification") {
        const body = child.namedChildren.find(
          (c) => c.type === "declaration_list" || c.type === "compound_statement",
        );
        if (body) {
          this.walkTopLevel(body, action);
        } else {
          this.walkTopLevel(child, action);
        }
        continue;
      }
      if (PREPROC_CONDITIONAL_CONTAINERS.has(child.type)) {
        this.walkTopLevel(child, action);
        continue;
      }
      if (child.type === "declaration_list" || child.type === "compound_statement") {
        this.walkTopLevel(child, action);
        continue;
      }
      if (leafTypes.has(child.type) || child.type === "comment") {
        action(child);
      }
    }
  }

  /**
   * Return the set of node types that should be treated as terminal
   * top-level statements by `walkTopLevel`. Subclasses can override to
   * extend the recognised vocabulary (e.g. add `namespace_definition`,
   * `class_specifier`, `template_declaration` for C++).
   */
  protected topLevelLeafTypes(): ReadonlySet<string> {
    return C_TOP_LEVEL_DECLARATIONS;
  }

  /**
   * Dispatch a single top-level node to the appropriate extract
   * method.  `scope` is the current containing scope's qualified name
   * (defaults to `moduleName` for plain C files; C++ subclasses extend
   * it through `namespace_definition` recursion). `moduleName` is the
   * file-derived module name — only `computeExports` uses it separately.
   */
  protected dispatchTopLevel(
    node: SyntaxNode,
    symbols: SymbolNode[],
    references: SymbolReference[],
    imports: ImportDeclaration[],
    scope: string,
    _moduleName: string,
  ): void {
    switch (node.type) {
      case "preproc_include":
        imports.push(this.extractInclude(node));
        return;
      case "preproc_def":
        this.extractObjectMacro(node, symbols, scope);
        return;
      case "preproc_function_def":
        this.extractFunctionMacro(node, symbols, scope);
        return;
      case "function_definition":
        this.extractFunctionDefinition(node, symbols, references, scope);
        return;
      case "declaration":
        this.extractDeclaration(node, symbols, scope);
        return;
      case "struct_specifier":
      case "union_specifier":
        this.extractRecord(node, symbols, scope, undefined);
        return;
      case "enum_specifier":
        this.extractEnum(node, symbols, scope, undefined);
        return;
      case "type_definition":
        this.extractTypedef(node, symbols, scope);
        return;
    }
  }

  // ─── Includes ───────────────────────────────────────────────────────────

  protected extractInclude(node: SyntaxNode): ImportDeclaration {
    const pathNode = node.childForFieldName("path");
    let modulePath = "";
    if (pathNode) {
      if (pathNode.type === "system_lib_string") {
        // Keep the literal `<…>` so resolveImportPath can tell this is a
        // system include and bail out cleanly.
        modulePath = pathNode.text;
      } else if (pathNode.type === "string_literal") {
        const inner = pathNode.namedChildren.find((c) => c.type === "string_content");
        modulePath = inner ? inner.text : stripStringQuotes(pathNode.text);
      } else {
        modulePath = pathNode.text;
      }
    }
    return {
      module: modulePath,
      names: [],
      isWildcard: true,
      line: node.startPosition.row + 1,
    };
  }

  // ─── Macros ─────────────────────────────────────────────────────────────

  protected extractObjectMacro(
    node: SyntaxNode,
    symbols: SymbolNode[],
    scope: string,
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const name = nameNode.text;
    const valueNode = node.childForFieldName("value");
    const valueText = valueNode ? valueNode.text.trim() : "";
    const docstring = this.extractDeclarationDocstring(node);
    symbols.push({
      name,
      qualifiedName: `${scope}.${name}`,
      kind: "constant",
      signature: valueText ? `${name} = ${truncate(valueText, 80)}` : name,
      decorators: ["macro"],
      docstring,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    });
  }

  protected extractFunctionMacro(
    node: SyntaxNode,
    symbols: SymbolNode[],
    scope: string,
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const name = nameNode.text;
    const paramsNode = node.childForFieldName("parameters");
    const params = paramsNode ? paramsNode.text : "()";
    const docstring = this.extractDeclarationDocstring(node);
    symbols.push({
      name,
      qualifiedName: `${scope}.${name}`,
      kind: "function",
      signature: `${name}${params}`,
      decorators: ["macro", "function_like"],
      docstring,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    });
  }

  // ─── Functions ──────────────────────────────────────────────────────────

  protected extractFunctionDefinition(
    node: SyntaxNode,
    symbols: SymbolNode[],
    references: SymbolReference[],
    scope: string,
  ): void {
    const declarator = node.childForFieldName("declarator");
    if (!declarator) return;
    const funcDecl = findFunctionDeclarator(declarator);
    if (!funcDecl) return;
    const name = extractDeclaratorName(funcDecl.childForFieldName("declarator"));
    if (!name) return;

    const decorators = collectStorageAndQualifierKeywords(node);
    const returnTypeNode = node.childForFieldName("type");
    const returnType = returnTypeNode ? returnTypeNode.text : "";
    const params = funcDecl.childForFieldName("parameters")?.text ?? "()";
    const signature = `${name}${params}${returnType ? `: ${returnType}` : ""}`;

    const docstring = this.extractDeclarationDocstring(node);
    const calls = this.extractCalls(node);
    const qualifiedName = `${scope}.${name}`;

    symbols.push({
      name,
      qualifiedName,
      kind: "function",
      signature,
      decorators,
      docstring,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    });

    for (const call of calls) {
      references.push({
        name: call,
        fromSymbol: qualifiedName,
        kind: "calls",
        line: node.startPosition.row + 1,
      });
    }
  }

  /**
   * A top-level `declaration` is either:
   *   1. a function prototype (`int foo(void);`) — we surface it as a
   *      function symbol decorated with `extern`/`declaration`;
   *   2. a global variable declaration (`int counter;`,
   *      `static const char* greeting = "hi";`) — we surface each
   *      declarator as a `variable` (or `constant` if `const`).
   *
   * Nested record specifiers inside a declaration (`struct X { ... } x;`)
   * surface the record itself as a top-level record symbol AND the
   * variable as a global; we recursively recurse so both are extracted.
   */
  protected extractDeclaration(
    node: SyntaxNode,
    symbols: SymbolNode[],
    scope: string,
  ): void {
    // Detect an inline record/enum specifier in the declaration's `type`
    // field and emit it as its own top-level symbol first.
    const typeNode = node.childForFieldName("type");
    if (typeNode) {
      if (typeNode.type === "struct_specifier" || typeNode.type === "union_specifier") {
        this.extractRecord(typeNode, symbols, scope, undefined);
      } else if (typeNode.type === "enum_specifier") {
        this.extractEnum(typeNode, symbols, scope, undefined);
      }
    }

    // Look for a function_declarator → this is a prototype.
    const declarator = node.childForFieldName("declarator");
    if (declarator) {
      const funcDecl = findFunctionDeclarator(declarator);
      if (funcDecl) {
        const name = extractDeclaratorName(funcDecl.childForFieldName("declarator"));
        if (!name) return;
        // A `declaration` with a function_declarator has no body — by
        // grammar a `function_definition` always carries one. We always
        // tag the symbol with `declaration` (whether or not `extern` is
        // explicit) so the exports filter can cleanly distinguish a
        // prototype from a definition.
        const decorators = collectStorageAndQualifierKeywords(node);
        decorators.push("declaration");
        const params = funcDecl.childForFieldName("parameters")?.text ?? "()";
        const returnType = typeNode ? typeNode.text : "";
        const signature = `${name}${params}${returnType ? `: ${returnType}` : ""}`;
        const docstring = this.extractDeclarationDocstring(node);
        symbols.push({
          name,
          qualifiedName: `${scope}.${name}`,
          kind: "function",
          signature,
          decorators,
          docstring,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
        return;
      }
    }

    // Otherwise it's a global variable / global const. Multiple
    // declarators are possible (`int a, b = 2;`).
    const modifiers = collectStorageAndQualifierKeywords(node);
    const isConst = modifiers.includes("const");
    const kind: CFamilyKind = isConst ? "constant" : "variable";
    const typeText = typeNode ? typeNode.text : "";
    const docstring = this.extractDeclarationDocstring(node);

    for (const child of node.namedChildren) {
      if (
        child.type !== "identifier" &&
        child.type !== "init_declarator" &&
        child.type !== "array_declarator" &&
        child.type !== "pointer_declarator" &&
        child.type !== "function_declarator" // already handled above
      ) {
        continue;
      }
      const declCandidate =
        child.type === "init_declarator" ? child.childForFieldName("declarator") : child;
      const name = extractDeclaratorName(declCandidate);
      if (!name) continue;
      symbols.push({
        name,
        qualifiedName: `${scope}.${name}`,
        kind,
        signature: typeText ? `${name}: ${typeText}` : name,
        decorators: [...modifiers],
        docstring,
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1,
      });
    }
  }

  // ─── Records (struct / union) ───────────────────────────────────────────

  /**
   * Emit a struct/union as a `class`-kind symbol and recurse into its
   * field list. Anonymous records (`struct { int x; } var;`) carry no
   * name and are skipped at the type level; their fields are not
   * surfaced — the enclosing declaration emits them as scalar globals
   * via the regular declaration path.
   */
  protected extractRecord(
    node: SyntaxNode,
    symbols: SymbolNode[],
    scope: string,
    parentTypedef: string | undefined,
  ): void {
    const nameNode = node.childForFieldName("name");
    const body = node.childForFieldName("body");
    if (!nameNode && !parentTypedef) {
      // Anonymous and not typedef'd — skip entirely (no stable identity).
      return;
    }
    const name = nameNode ? nameNode.text : parentTypedef!;
    const qualifiedName = `${scope}.${name}`;
    const kind: CFamilyKind = "class";
    const decorators = [node.type === "union_specifier" ? "union" : "struct"];
    const docstring = this.extractDeclarationDocstring(node);

    // Only emit the record symbol when it actually has a body (i.e. it
    // defines fields). Forward declarations (`struct X;`) are noise.
    if (body) {
      symbols.push({
        name,
        qualifiedName,
        kind,
        decorators,
        docstring,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      });
      this.extractRecordFields(body, symbols, qualifiedName);
    }
  }

  protected extractRecordFields(
    body: SyntaxNode,
    symbols: SymbolNode[],
    parentQualifiedName: string,
  ): void {
    for (const child of body.namedChildren) {
      if (child.type !== "field_declaration") continue;
      const typeNode = child.childForFieldName("type");
      const typeText = typeNode ? typeNode.text : "";
      // Multiple field identifiers may share a type (`int x, y;`).
      const declarators = child.namedChildren.filter(
        (c) =>
          c.type === "field_identifier" ||
          c.type === "array_declarator" ||
          c.type === "pointer_declarator" ||
          c.type === "function_declarator",
      );
      const docstring = this.extractDeclarationDocstring(child);
      for (const decl of declarators) {
        const fieldName = extractDeclaratorName(decl);
        if (!fieldName) continue;
        const isFnPtr = decl.type === "function_declarator" || hasFunctionDeclarator(decl);
        symbols.push({
          name: fieldName,
          qualifiedName: `${parentQualifiedName}.${fieldName}`,
          kind: isFnPtr ? "method" : "variable",
          signature: typeText ? `${fieldName}: ${typeText}` : fieldName,
          decorators: isFnPtr ? ["field", "function_pointer"] : ["field"],
          docstring,
          startLine: child.startPosition.row + 1,
          endLine: child.endPosition.row + 1,
          parent: parentQualifiedName,
        });
      }
    }
  }

  // ─── Enums ──────────────────────────────────────────────────────────────

  protected extractEnum(
    node: SyntaxNode,
    symbols: SymbolNode[],
    scope: string,
    parentTypedef: string | undefined,
  ): void {
    const nameNode = node.childForFieldName("name");
    const body = node.childForFieldName("body");
    if (!nameNode && !parentTypedef) return;
    const name = nameNode ? nameNode.text : parentTypedef!;
    const qualifiedName = `${scope}.${name}`;
    const docstring = this.extractDeclarationDocstring(node);

    if (!body) return;

    symbols.push({
      name,
      qualifiedName,
      kind: "enum",
      decorators: [],
      docstring,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    });

    for (const enumerator of body.namedChildren) {
      if (enumerator.type !== "enumerator") continue;
      const enumNameNode = enumerator.childForFieldName("name");
      if (!enumNameNode) continue;
      const enumName = enumNameNode.text;
      symbols.push({
        name: enumName,
        qualifiedName: `${qualifiedName}.${enumName}`,
        kind: "constant",
        decorators: ["enum_constant"],
        startLine: enumerator.startPosition.row + 1,
        endLine: enumerator.endPosition.row + 1,
        parent: qualifiedName,
      });
    }
  }

  // ─── Typedefs ───────────────────────────────────────────────────────────

  /**
   * A typedef may wrap an inline struct/union/enum specifier
   * (`typedef struct { ... } Foo;`) — in that case the inner type
   * itself is emitted as its own symbol (using the typedef alias as
   * name if the struct is anonymous), and the typedef alias becomes a
   * `type` symbol that aliases it. For plain typedefs
   * (`typedef int counter_t;` or `typedef int (*cb_t)(int);`) we emit
   * only the alias.
   */
  protected extractTypedef(
    node: SyntaxNode,
    symbols: SymbolNode[],
    scope: string,
  ): void {
    const typeNode = node.childForFieldName("type");
    // The typedef may have multiple aliases (`typedef int A, B;`), but
    // tree-sitter exposes a single `declarator` field. Walk the
    // declarators directly to handle the rare comma case.
    const declarators = node.namedChildren.filter((c) =>
      [
        "type_identifier",
        "pointer_declarator",
        "array_declarator",
        "function_declarator",
        "init_declarator",
      ].includes(c.type),
    );

    const aliasNames: string[] = [];
    for (const d of declarators) {
      const aliasName = extractDeclaratorName(d);
      if (aliasName) aliasNames.push(aliasName);
    }
    if (aliasNames.length === 0) return;

    // If the type is an inline anonymous struct/union/enum, give it the
    // alias name as identity and emit the record/enum first.
    if (typeNode) {
      if (typeNode.type === "struct_specifier" || typeNode.type === "union_specifier") {
        this.extractRecord(typeNode, symbols, scope, aliasNames[0]);
      } else if (typeNode.type === "enum_specifier") {
        this.extractEnum(typeNode, symbols, scope, aliasNames[0]);
      }
    }

    const docstring = this.extractDeclarationDocstring(node);
    const typeText = typeNode ? typeNode.text : "";
    for (const alias of aliasNames) {
      symbols.push({
        name: alias,
        qualifiedName: `${scope}.${alias}`,
        kind: "type",
        signature: typeText ? `${alias} = ${truncate(typeText, 100)}` : alias,
        decorators: ["typedef"],
        docstring,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      });
    }
  }

  // ─── Calls ──────────────────────────────────────────────────────────────

  /**
   * Walk a function body and collect every `call_expression`'s callee.
   * The callee may be:
   *   - an `identifier`              (`foo()`)
   *   - a `field_expression`         (`obj.foo()` / `obj->foo()`)
   *   - a `parenthesized_expression` (`(*fp)()`)
   * We keep the textual callee with surrounding whitespace stripped.
   * Duplicates are folded into a single edge per call site to keep the
   * graph stable.
   */
  protected extractCalls(funcDef: SyntaxNode): string[] {
    const calls: string[] = [];
    const seen = new Set<string>();
    const body = funcDef.childForFieldName("body");
    if (!body) return calls;

    const walk = (n: SyntaxNode): void => {
      if (n.type === "call_expression") {
        const callee = n.namedChildren[0];
        if (callee) {
          const callName = simplifyCallee(callee);
          if (callName && !seen.has(callName)) {
            seen.add(callName);
            calls.push(callName);
          }
        }
      }
      for (const c of n.namedChildren) walk(c);
    };

    walk(body);
    return calls;
  }

  // ─── Docstrings ─────────────────────────────────────────────────────────

  /**
   * Extract the leading Doxygen-style docstring for a declaration. We
   * accept block comments starting with `/**`, `/*!`, or contiguous
   * `///` line-comment groups immediately preceding the declaration.
   *
   * Implementation note: `web-tree-sitter` returns a fresh `SyntaxNode`
   * wrapper for every `parent.namedChildren` access, so we locate the
   * declaration by `startPosition` instead of by reference equality.
   */
  protected extractDeclarationDocstring(node: SyntaxNode): string | undefined {
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
    if (text.startsWith("/**") || text.startsWith("/*!")) {
      return cleanDoxyBlock(text);
    }
    if (text.startsWith("///")) {
      // Collect contiguous `///` line-comments going backwards.
      const lines: string[] = [stripLineDoxy(text)];
      for (let i = idx - 2; i >= 0; i--) {
        const s = siblings[i]!;
        if (s.type !== "comment" || !s.text.startsWith("///")) break;
        lines.unshift(stripLineDoxy(s.text));
      }
      return cleanFirstLine(lines.join(" "));
    }
    return undefined;
  }

  /**
   * Pick a file-level docstring from the first block-comment or
   * contiguous `///` group that appears before any declaration. Header
   * guards (`#ifndef HEADER_H`) live inside an inert preproc cascade
   * that doesn't interfere — we simply scan top-level `comment` nodes.
   */
  protected extractFileDocstring(root: SyntaxNode): string | undefined {
    const leafTypes = this.topLevelLeafTypes();
    for (const child of root.namedChildren) {
      if (child.type === "comment") {
        const text = child.text;
        if (text.startsWith("/**") || text.startsWith("/*!")) {
          return cleanDoxyBlock(text);
        }
        if (text.startsWith("///")) {
          return cleanFirstLine(stripLineDoxy(text));
        }
        // A plain `/* … */` block at file head is also accepted as a
        // file docstring — copyright headers commonly use it.
        if (text.startsWith("/*")) {
          return cleanFirstLine(stripBlockComment(text));
        }
        // A plain `//` line comment — accept it too.
        if (text.startsWith("//")) {
          return cleanFirstLine(text.replace(/^\/\/+\s?/, ""));
        }
      } else if (
        leafTypes.has(child.type) &&
        child.type !== "preproc_include" &&
        child.type !== "preproc_def" &&
        child.type !== "preproc_function_def"
      ) {
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Compute the linker-visible export surface of a translation unit.
   *
   * C has no `export` keyword — every non-`static` function definition
   * and every non-`static`/non-`extern` global variable / global const
   * defined here is externally visible to the linker. We exclude:
   *   - `static` storage  (internal linkage),
   *   - `declaration` prototypes (no definition emitted here),
   *   - pure `extern` references (declared, not defined),
   *   - `macro`-tagged symbols (#define is preprocessor-only — not a
   *     linked symbol; macros leak through includes, not links),
   *   - record / typedef / enum names (kinds `class`/`type`/`enum` are
   *     type-level concepts with no link-level symbol attached),
   *   - members (struct fields, enum constants — visibility is gated
   *     by the parent type).
   *
   * C++ symbols inside namespaces are intentionally **excluded** from
   * the top-level exports list: namespace membership is encoded in
   * `qualifiedName` and the namespace itself surfaces as its own
   * top-level symbol — the consumer can walk through it.
   */
  protected computeExports(symbols: SymbolNode[], moduleName: string): string[] {
    const prefix = `${moduleName}.`;
    const LINKABLE_KINDS: ReadonlySet<CFamilyKind> = new Set([
      "function",
      "variable",
      "constant",
    ]);
    return symbols
      .filter((s) => {
        if (s.parent !== undefined) return false;
        if (!s.qualifiedName.startsWith(prefix)) return false;
        const tail = s.qualifiedName.slice(prefix.length);
        if (tail.includes(".")) return false;
        if (!LINKABLE_KINDS.has(s.kind as CFamilyKind)) return false;
        if (s.decorators.includes("static")) return false;
        if (s.decorators.includes("declaration")) return false;
        if (s.decorators.includes("extern")) return false;
        if (s.decorators.includes("macro")) return false;
        return true;
      })
      .map((s) => s.name);
  }
}

// ─── Public utilities ─────────────────────────────────────────────────────

/**
 * Resolve a `#include` path to candidate file paths relative to repo
 * root. Exposed as a free function so non-extractor callers (graph
 * builders, scripts, the C++ subclass) can use the same semantics
 * without instantiating an extractor.
 */
export function resolveCInclude(importModule: string, currentFilePath: string): string[] {
  if (!importModule) return [];
  // System include — `module` keeps the literal `<…>` text. We can't
  // resolve these without a system include path catalogue.
  if (importModule.startsWith("<") && importModule.endsWith(">")) return [];

  const normalized = importModule.replace(/\\/g, "/");
  const fileDir = posixDirname(currentFilePath.replace(/\\/g, "/"));
  const relative = posixJoin(fileDir, normalized);

  const candidates: string[] = [];
  if (relative) candidates.push(relative);
  if (normalized && normalized !== relative) candidates.push(normalized);
  // Dedupe while preserving order.
  return Array.from(new Set(candidates));
}

/**
 * Find the innermost `function_declarator` inside an arbitrary
 * declarator chain (`int* (foo)(int)`, `static int *foo(void)`,
 * `int (*foo)(void)` — function-pointer declarators are deliberately
 * NOT considered here; only true function declarators are returned).
 */
export function findFunctionDeclarator(declarator: SyntaxNode | null): SyntaxNode | null {
  if (!declarator) return null;
  if (declarator.type === "function_declarator") {
    // Only treat as a function-definition declarator when the inner
    // declarator is an identifier (or further wrapper around one) — a
    // `parenthesized_declarator` wrapping a `pointer_declarator` is a
    // function-pointer declaration, not a function definition.
    const inner = declarator.childForFieldName("declarator");
    if (!inner) return null;
    if (inner.type === "parenthesized_declarator") return null;
    return declarator;
  }
  if (declarator.type === "pointer_declarator" || declarator.type === "array_declarator") {
    return findFunctionDeclarator(declarator.childForFieldName("declarator"));
  }
  return null;
}

export function hasFunctionDeclarator(node: SyntaxNode): boolean {
  if (node.type === "function_declarator") return true;
  if (node.type === "pointer_declarator" || node.type === "array_declarator") {
    const inner = node.childForFieldName("declarator");
    return inner ? hasFunctionDeclarator(inner) : false;
  }
  if (node.type === "parenthesized_declarator") {
    const inner = node.namedChildren[0];
    return inner ? hasFunctionDeclarator(inner) : false;
  }
  return false;
}

/**
 * Walk a declarator chain to find the bound identifier. Handles
 * `pointer_declarator`, `array_declarator`, `init_declarator`,
 * `function_declarator`, `parenthesized_declarator`, and direct
 * `identifier` / `field_identifier` / `type_identifier`.
 */
export function extractDeclaratorName(node: SyntaxNode | null): string | null {
  if (!node) return null;
  switch (node.type) {
    case "identifier":
    case "field_identifier":
    case "type_identifier":
      return node.text;
    case "init_declarator":
    case "pointer_declarator":
    case "array_declarator":
    case "function_declarator":
      return extractDeclaratorName(node.childForFieldName("declarator"));
    case "parenthesized_declarator": {
      const inner = node.namedChildren[0];
      return inner ? extractDeclaratorName(inner) : null;
    }
    default:
      return null;
  }
}

/**
 * tree-sitter-c flattens `static`, `extern`, `register`, `auto`,
 * `inline`, `const`, `volatile`, `restrict`, `_Atomic`, etc. as
 * anonymous-but-typed children of a `declaration` /
 * `function_definition` (types `storage_class_specifier` and
 * `type_qualifier`). We collect their textual content as decorators.
 */
export function collectStorageAndQualifierKeywords(node: SyntaxNode): string[] {
  const out: string[] = [];
  for (const child of node.namedChildren) {
    if (child.type === "storage_class_specifier" || child.type === "type_qualifier") {
      out.push(child.text);
    } else if (child.type === "ms_declspec_modifier") {
      // MSVC `__declspec(...)` modifiers — keep the raw text.
      out.push(child.text);
    }
  }
  return out;
}

/**
 * Reduce a call_expression's callee to a stable textual key. For a
 * plain identifier this is just the identifier; for a field expression
 * we keep the dotted form (`obj.foo` / `obj->foo` becomes `obj.foo`
 * after we normalise `->` to `.`); for anything else we fall back to
 * the raw text trimmed of whitespace.
 */
export function simplifyCallee(node: SyntaxNode): string | null {
  switch (node.type) {
    case "identifier":
      return node.text;
    case "field_expression": {
      const argNode = node.childForFieldName("argument");
      const fieldNode = node.childForFieldName("field");
      if (!fieldNode) return null;
      const base = argNode ? argNode.text : "";
      return base ? `${base}.${fieldNode.text}` : fieldNode.text;
    }
    case "parenthesized_expression": {
      const inner = node.namedChildren[0];
      return inner ? simplifyCallee(inner) : null;
    }
    default: {
      const raw = node.text.replace(/\s+/g, " ").trim();
      return raw.length > 0 ? raw : null;
    }
  }
}

// ─── Path helpers ─────────────────────────────────────────────────────────

export function posixBasename(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}

export function posixDirname(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? "" : normalized.slice(0, lastSlash);
}

/**
 * POSIX path join that also normalises `.` and `..` segments. We
 * implement it explicitly (instead of using `node:path`) because the
 * extractor must be deterministic on every platform — Windows
 * `path.join` would emit backslashes.
 */
export function posixJoin(...parts: string[]): string {
  const segments: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    for (const seg of part.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") {
        if (segments.length > 0 && segments[segments.length - 1] !== "..") {
          segments.pop();
        } else {
          segments.push("..");
        }
        continue;
      }
      segments.push(seg);
    }
  }
  return segments.join("/");
}

/**
 * Convert a file path into a dotted module name suitable for qualified
 * names. `src/util.c` → `src.util`. `include/foo/bar.h` →
 * `include.foo.bar`. The extension is stripped; multiple consecutive
 * dots collapse so `foo..bar.c` (illegal but tolerated) becomes
 * `foo.bar`.
 */
export function filePathToModule(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  const dir = lastSlash === -1 ? "" : normalized.slice(0, lastSlash);
  const file = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
  const stem = file.replace(/\.[^.]+$/, "");
  const dirDotted = dir.replace(/\//g, ".");
  const combined = dirDotted ? `${dirDotted}.${stem}` : stem;
  return combined.replace(/\.+/g, ".");
}

export function stripStringQuotes(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

// ─── Comment helpers ──────────────────────────────────────────────────────

/**
 * Clean a Doxygen block (`/** … *\/`, `/*! … *\/`) to a single-line
 * summary: drop the comment delimiters, strip the leading ` * ` on
 * each line, drop empty lines and `@tag`-prefixed lines, and return
 * the first non-empty line truncated to 300 chars.
 */
export function cleanDoxyBlock(raw: string): string | undefined {
  let text = raw.trim();
  if (text.startsWith("/**")) text = text.slice(3);
  else if (text.startsWith("/*!")) text = text.slice(3);
  else if (text.startsWith("/*")) text = text.slice(2);
  if (text.endsWith("*/")) text = text.slice(0, -2);
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^\s*\*+\s?/, "").trim())
    .filter((l) => l.length > 0 && !l.startsWith("@") && !l.startsWith("\\"));
  if (lines.length === 0) return undefined;
  return cleanFirstLine(lines[0]!);
}

export function stripBlockComment(raw: string): string {
  let text = raw.trim();
  if (text.startsWith("/*")) text = text.slice(2);
  if (text.endsWith("*/")) text = text.slice(0, -2);
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^\s*\*+\s?/, "").trim())
    .filter((l) => l.length > 0);
  return lines[0] ?? "";
}

export function stripLineDoxy(raw: string): string {
  // `///` or `//!` followed by an optional space.
  return raw.replace(/^\/\/\/+\s?|^\/\/!+\s?/, "").trim();
}

export function cleanFirstLine(s: string): string | undefined {
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  return trimmed.length > 300 ? trimmed.slice(0, 297) + "..." : trimmed;
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 3) + "..." : s;
}
