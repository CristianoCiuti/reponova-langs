/**
 * TypeScript-family language extractor (shared between lang-typescript and lang-tsx).
 *
 * Produces a FileExtraction for TypeScript-family source files using a
 * `tree-sitter-typescript`-compatible WASM grammar. Coverage:
 *
 *   - Symbols: functions, classes, methods, interfaces, type aliases,
 *     enums, top-level constants (UPPER_SNAKE_CASE only)
 *   - Imports: default, named, namespace, side-effect, type-only,
 *     `export ... from` re-exports
 *   - References: extends/implements (classes), call expressions
 *   - Module-level docstring: leading JSDoc /** ... *\/ comment
 *   - Symbol docstring: JSDoc directly preceding the declaration
 *
 * The class is parameterised so the same logic drives both:
 *   - `@reponova/lang-typescript` (`.ts/.mts/.cts` + `tree-sitter-typescript.wasm`)
 *   - `@reponova/lang-tsx`        (`.tsx`            + `tree-sitter-tsx.wasm`)
 *
 * Defaults match the TypeScript flavor; consumers override via
 * `TypescriptExtractorOptions` at construction time.
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
import { dirname, join } from "node:path";

type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "variable"
  | "constant"
  | "interface"
  | "type"
  | "enum"
  | "namespace";

// ─── Path helpers (inlined; do not depend on reponova internals) ─────────────

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function posixBasename(p: string): string {
  const normalized = toPosix(p);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}

/** Default extensions for the TypeScript flavor. */
export const DEFAULT_TS_EXTENSIONS = [".ts", ".mts", ".cts"] as const;

/** Default candidate file extensions tried when resolving a relative import (TS flavor). */
export const DEFAULT_RESOLVE_CANDIDATES = [".ts", ".mts", ".cts", ".d.ts"] as const;

/** Default index file names tried when resolving a directory import (TS flavor). */
export const DEFAULT_INDEX_CANDIDATES = [
  "index.ts",
  "index.mts",
  "index.cts",
  "index.d.ts",
] as const;

/**
 * Knobs for adapting the same extractor logic to TypeScript or TSX.
 *
 * All fields are optional; omitting a field reverts to the TypeScript-flavor
 * default. The expected override shape for each consumer is:
 *
 *   - lang-typescript: pass `{}` (or omit entirely).
 *   - lang-tsx: pass
 *       {
 *         languageId: "tsx",
 *         extensions: [".tsx"],
 *         wasmFile: "tree-sitter-tsx.wasm",
 *         resolveCandidates: [".ts", ".tsx", ".mts", ".cts", ".d.ts"],
 *         indexCandidates: ["index.tsx", "index.ts", "index.mts", "index.cts", "index.d.ts"],
 *       }
 */
export interface TypescriptExtractorOptions {
  /** Language id surfaced as `FileExtraction.language` and on the extractor instance. */
  readonly languageId?: string;
  /** Source-file extensions handled by this extractor instance. */
  readonly extensions?: readonly string[];
  /** WASM grammar filename, registered against `LanguageExtractor.wasmFile`. */
  readonly wasmFile?: string;
  /** Extensions tried (in order) when resolving a relative import. */
  readonly resolveCandidates?: readonly string[];
  /** Index file names tried (in order) when resolving a directory import. */
  readonly indexCandidates?: readonly string[];
}

export class TypescriptExtractor implements LanguageExtractor {
  readonly languageId: string;
  readonly extensions: string[];
  readonly wasmFile: string;
  private readonly resolveCandidates: readonly string[];
  private readonly indexCandidates: readonly string[];

  constructor(options: TypescriptExtractorOptions = {}) {
    this.languageId = options.languageId ?? "typescript";
    this.extensions = options.extensions
      ? [...options.extensions]
      : [...DEFAULT_TS_EXTENSIONS];
    this.wasmFile = options.wasmFile ?? "tree-sitter-typescript.wasm";
    this.resolveCandidates = options.resolveCandidates
      ? [...options.resolveCandidates]
      : [...DEFAULT_RESOLVE_CANDIDATES];
    this.indexCandidates = options.indexCandidates
      ? [...options.indexCandidates]
      : [...DEFAULT_INDEX_CANDIDATES];
  }

  extract(
    tree: SyntaxTree,
    sourceCode: string,
    filePath: string,
  ): FileExtraction {
    const symbols: SymbolNode[] = [];
    const imports: ImportDeclaration[] = [];
    const references: SymbolReference[] = [];

    const moduleName = this.filePathToModuleName(filePath);
    const fileName = posixBasename(filePath);

    const fileNode: FileNodeDeclaration = {
      kind: "module",
      label: fileName,
      docstring: this.extractModuleDocstring(tree),
    };

    this.handleSiblings(tree.rootNode, sourceCode, symbols, imports, references, moduleName);

    // Dedupe overloads: tree-sitter-typescript represents function /
    // method overloads as one or more `function_signature` /
    // `method_signature` nodes (no body) followed by the actual
    // `function_declaration` / `method_definition` (with body). We
    // extract all of them so .d.ts files still produce symbols, then
    // collapse same-`qualifiedName` entries to the LAST one, which is
    // either the implementation or the only signature in an ambient
    // declaration file.
    const dedupedSymbols = this.dedupeByQualifiedName(symbols);

    const exports = this.computeExports(tree, sourceCode, dedupedSymbols);
    return {
      filePath,
      language: this.languageId,
      fileNode,
      symbols: dedupedSymbols,
      imports,
      references,
      exports,
    };
  }

  /**
   * Collapse same-name overload entries to the LAST occurrence (which is
   * the implementation in normal TS source files, or the only signature
   * in `.d.ts`). Getters and setters share their `qualifiedName` but are
   * conceptually distinct members, so we add `#getter` / `#setter` to
   * the dedup key — never to the public qualifiedName itself — so a
   * `class Foo { get name() {…}; set name(v) {…} }` produces two
   * symbols with a clean `mod.Foo.name` qualifiedName each.
   */
  private dedupeByQualifiedName(symbols: SymbolNode[]): SymbolNode[] {
    const result: SymbolNode[] = [];
    const indexByKey = new Map<string, number>();
    for (const sym of symbols) {
      const decorators = sym.decorators ?? [];
      let key = sym.qualifiedName;
      if (decorators.includes("getter")) key += "#getter";
      else if (decorators.includes("setter")) key += "#setter";
      const existing = indexByKey.get(key);
      if (existing !== undefined) {
        result[existing] = sym;
      } else {
        indexByKey.set(key, result.length);
        result.push(sym);
      }
    }
    return result;
  }

  resolveImportPath(importModule: string, currentFilePath: string): string[] {
    if (!importModule.startsWith(".") && !importModule.startsWith("/")) {
      return [];
    }

    const normalized = toPosix(currentFilePath);
    const baseDir = dirname(normalized);
    const target = toPosix(join(baseDir, importModule));

    if (this.hasKnownExtension(target)) {
      return [target];
    }

    const candidates: string[] = [];
    for (const ext of this.resolveCandidates) candidates.push(`${target}${ext}`);
    for (const idx of this.indexCandidates) candidates.push(`${target}/${idx}`);
    return candidates;
  }

  // ─── Sibling-aware dispatch ─────────────────────────────────────────────
  //
  // Tree-sitter-typescript represents leading JSDoc comments and decorators
  // as SIBLINGS (not children) of the declaration they document, inside
  // their common parent (program, export_statement, class_body, …). So we
  // iterate children in order, accumulate pending decorators + jsDoc, and
  // attach them to the next non-comment / non-decorator declaration.

  private handleSiblings(
    parent: SyntaxNode,
    sourceCode: string,
    symbols: SymbolNode[],
    imports: ImportDeclaration[],
    references: SymbolReference[],
    moduleName: string,
  ): void {
    let pendingDecorators: string[] = [];
    let pendingJsDoc: string | undefined;

    for (const child of parent.namedChildren) {
      if (child.type === "comment") {
        const text = child.text;
        if (text.startsWith("/**") && text.endsWith("*/")) {
          pendingJsDoc = this.cleanJsDoc(text.slice(3, -2));
        }
        continue;
      }
      if (child.type === "decorator") {
        pendingDecorators.push(child.text.trim().replace(/^@/, ""));
        continue;
      }

      this.handleDeclaration(
        child,
        sourceCode,
        symbols,
        imports,
        references,
        moduleName,
        pendingDecorators,
        pendingJsDoc,
        false,
      );
      pendingDecorators = [];
      pendingJsDoc = undefined;
    }
  }

  private handleDeclaration(
    node: SyntaxNode,
    sourceCode: string,
    symbols: SymbolNode[],
    imports: ImportDeclaration[],
    references: SymbolReference[],
    moduleName: string,
    decorators: string[],
    jsDoc: string | undefined,
    isExported: boolean,
  ): void {
    switch (node.type) {
      case "import_statement":
        imports.push(this.extractImport(node));
        return;

      case "export_statement":
        this.handleExportStatement(
          node,
          sourceCode,
          symbols,
          imports,
          references,
          moduleName,
          decorators,
          jsDoc,
        );
        return;

      case "function_declaration":
      case "function_signature":
        // function_signature covers `.d.ts` ambient declarations and
        // function overload signatures. We extract them so the graph
        // sees the symbol; same-name duplicates are deduped at the
        // tail of `extract()`.
        this.extractFunction(node, symbols, references, moduleName, undefined, decorators, jsDoc, isExported);
        return;

      case "class_declaration":
      case "abstract_class_declaration":
        this.extractClass(node, sourceCode, symbols, references, moduleName, decorators, jsDoc, isExported);
        return;

      case "interface_declaration":
        this.extractInterface(node, symbols, references, moduleName, jsDoc);
        return;

      case "type_alias_declaration":
        this.extractTypeAlias(node, symbols, moduleName, jsDoc);
        return;

      case "enum_declaration":
        this.extractEnum(node, symbols, moduleName, jsDoc);
        return;

      case "internal_module":
      case "module":
        this.extractNamespace(node, sourceCode, symbols, imports, references, moduleName, jsDoc);
        return;

      case "lexical_declaration":
      case "variable_declaration":
        this.extractTopLevelDeclarations(node, symbols, references, moduleName, jsDoc, isExported);
        return;
    }
  }

  // ─── Imports / exports ──────────────────────────────────────────────────

  private extractImport(node: SyntaxNode): ImportDeclaration {
    const sourceNode = node.childForFieldName("source")
      ?? node.namedChildren.find((c) => c.type === "string");
    const module = sourceNode ? this.unquoteString(sourceNode.text) : "";
    const names: string[] = [];
    let isWildcard = false;

    const clause = node.namedChildren.find((c) => c.type === "import_clause");
    if (clause) {
      for (const c of clause.namedChildren) {
        if (c.type === "identifier") {
          names.push(c.text); // default import binding
        } else if (c.type === "namespace_import") {
          isWildcard = true;
          const id = c.namedChildren.find((cc) => cc.type === "identifier");
          if (id) names.push(`* as ${id.text}`);
        } else if (c.type === "named_imports") {
          for (const spec of c.namedChildren) {
            if (spec.type === "import_specifier") {
              const nameNode = spec.childForFieldName("name")
                ?? spec.namedChildren.find((cc) => cc.type === "identifier");
              if (nameNode) names.push(nameNode.text);
            }
          }
        }
      }
    }

    return {
      module,
      names,
      isWildcard,
      line: node.startPosition.row + 1,
    };
  }

  private handleExportStatement(
    node: SyntaxNode,
    sourceCode: string,
    symbols: SymbolNode[],
    imports: ImportDeclaration[],
    references: SymbolReference[],
    moduleName: string,
    outerDecorators: string[],
    outerJsDoc: string | undefined,
  ): void {
    // `export ... from 'mod'` → re-export, equivalent to an import + flag
    const sourceNode = node.childForFieldName("source")
      ?? node.namedChildren.find((c) => c.type === "string");
    if (sourceNode) {
      const module = this.unquoteString(sourceNode.text);
      const names: string[] = [];
      let isWildcard = false;

      const namespaceExport = node.namedChildren.find((c) => c.type === "namespace_export");
      if (namespaceExport) {
        isWildcard = true;
        const id = namespaceExport.namedChildren.find((cc) => cc.type === "identifier");
        if (id) names.push(`* as ${id.text}`);
      }

      const exportClause = node.namedChildren.find((c) => c.type === "export_clause");
      if (exportClause) {
        for (const spec of exportClause.namedChildren) {
          if (spec.type === "export_specifier") {
            const nameNode = spec.childForFieldName("name")
              ?? spec.namedChildren.find((cc) => cc.type === "identifier");
            if (nameNode) names.push(nameNode.text);
          }
        }
      }

      // Bare `export * from 'mod'` (no namespace alias)
      if (!isWildcard && !exportClause && node.text.includes("export *")) {
        isWildcard = true;
      }

      imports.push({
        module,
        names,
        isWildcard,
        isExport: true,
        line: node.startPosition.row + 1,
      });
      return;
    }

    // `export class/function/...`, `export const X = ...`, `export default ...`
    let pendingDecorators = [...outerDecorators];
    let pendingJsDoc = outerJsDoc;

    for (const child of node.namedChildren) {
      if (child.type === "comment") {
        const text = child.text;
        if (text.startsWith("/**") && text.endsWith("*/")) {
          pendingJsDoc = this.cleanJsDoc(text.slice(3, -2));
        }
        continue;
      }
      if (child.type === "decorator") {
        pendingDecorators.push(child.text.trim().replace(/^@/, ""));
        continue;
      }

      this.handleDeclaration(
        child,
        sourceCode,
        symbols,
        imports,
        references,
        moduleName,
        pendingDecorators,
        pendingJsDoc,
        true,
      );
      pendingDecorators = [];
      pendingJsDoc = undefined;
    }
  }

  // ─── Functions ──────────────────────────────────────────────────────────

  private extractFunction(
    node: SyntaxNode,
    symbols: SymbolNode[],
    references: SymbolReference[],
    moduleName: string,
    parentClass: string | undefined,
    decorators: string[],
    docstring: string | undefined,
    _isExported = false,
  ): void {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "<anonymous>";
    const kind: SymbolKind = parentClass ? "method" : "function";

    const signature = this.buildFunctionSignature(node, name);
    const calls = this.extractCalls(node);

    const qualifiedName = parentClass
      ? `${moduleName}.${parentClass}.${name}`
      : `${moduleName}.${name}`;

    const finalDecorators = this.augmentDecoratorsWithModifiers(node, decorators);

    symbols.push({
      name,
      qualifiedName,
      kind,
      signature,
      decorators: finalDecorators,
      docstring,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parent: parentClass,
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
   * Prepend implicit modifier markers to the decorator list so consumers
   * can distinguish:
   *   - `async function fetch(...)` → `async`
   *   - `class Foo { get name() { … } }` → `getter`
   *   - `class Foo { set name(v) { … } }` → `setter`
   *   - `function* gen()` / `async function* gen()` → `generator`
   *
   * tree-sitter-typescript exposes these as anonymous keyword tokens in
   * `node.children` (NOT `namedChildren`), so we sweep through the raw
   * children list looking for the relevant token types.
   */
  private augmentDecoratorsWithModifiers(node: SyntaxNode, decorators: string[]): string[] {
    const modifiers: string[] = [];
    for (const child of node.children) {
      switch (child.type) {
        case "async":
          if (!modifiers.includes("async")) modifiers.push("async");
          break;
        case "get":
          if (!modifiers.includes("getter")) modifiers.push("getter");
          break;
        case "set":
          if (!modifiers.includes("setter")) modifiers.push("setter");
          break;
        case "*":
          if (!modifiers.includes("generator")) modifiers.push("generator");
          break;
      }
    }
    return modifiers.length > 0 ? [...modifiers, ...decorators] : decorators;
  }

  // ─── Classes ────────────────────────────────────────────────────────────

  private extractClass(
    node: SyntaxNode,
    sourceCode: string,
    symbols: SymbolNode[],
    references: SymbolReference[],
    moduleName: string,
    decorators: string[],
    docstring: string | undefined,
    _isExported = false,
  ): void {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "<anonymous>";
    const qualifiedName = `${moduleName}.${name}`;

    const bases = this.extractHeritage(node);

    symbols.push({
      name,
      qualifiedName,
      kind: "class",
      decorators,
      docstring,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      bases,
    });

    for (const base of bases) {
      references.push({
        name: base,
        fromSymbol: qualifiedName,
        kind: "extends",
        line: node.startPosition.row + 1,
      });
    }

    const body = node.childForFieldName("body");
    if (body) {
      this.extractClassBody(body, sourceCode, symbols, references, moduleName, name);
    }
  }

  /**
   * Iterate a class_body and accumulate decorators / JSDoc as siblings,
   * then attach them to the next method_definition.
   */
  private extractClassBody(
    body: SyntaxNode,
    _sourceCode: string,
    symbols: SymbolNode[],
    references: SymbolReference[],
    moduleName: string,
    className: string,
  ): void {
    let pendingDecorators: string[] = [];
    let pendingJsDoc: string | undefined;

    for (const member of body.namedChildren) {
      if (member.type === "comment") {
        const text = member.text;
        if (text.startsWith("/**") && text.endsWith("*/")) {
          pendingJsDoc = this.cleanJsDoc(text.slice(3, -2));
        }
        continue;
      }
      if (member.type === "decorator") {
        pendingDecorators.push(member.text.trim().replace(/^@/, ""));
        continue;
      }
      if (member.type === "method_definition" || member.type === "method_signature") {
        // method_signature covers method overloads (`bar(x: number): void;`)
        // and members of `interface`-shaped class hierarchies. They're
        // emitted alongside the implementation; the dedup pass at the
        // end of `extract()` collapses duplicates by qualifiedName.
        this.extractFunction(
          member,
          symbols,
          references,
          moduleName,
          className,
          pendingDecorators,
          pendingJsDoc,
        );
        pendingDecorators = [];
        pendingJsDoc = undefined;
        continue;
      }
      if (member.type === "public_field_definition") {
        this.extractClassField(member, symbols, moduleName, className, pendingDecorators, pendingJsDoc);
        pendingDecorators = [];
        pendingJsDoc = undefined;
        continue;
      }
      if (member.type === "abstract_method_signature") {
        // `abstract bar(): void;` carries no implementation. Treat it
        // exactly like a method so subclasses can resolve `extends`
        // against the abstract member name.
        this.extractFunction(
          member,
          symbols,
          references,
          moduleName,
          className,
          [...pendingDecorators, "abstract"],
          pendingJsDoc,
        );
        pendingDecorators = [];
        pendingJsDoc = undefined;
        continue;
      }
      // accessibility_modifier and other syntactic noise. Reset pending so
      // the buffered jsdoc/decorators don't leak to the next member.
      pendingDecorators = [];
      pendingJsDoc = undefined;
    }
  }

  /**
   * Class fields like `name: string`, `count = 0`, `readonly tag = "foo"`.
   * We surface them as `variable` symbols hung under their class so graph
   * consumers can navigate to the field declaration site. The original
   * accessibility (public / private / protected) and `readonly` keywords
   * are preserved as decorator markers, alongside any TC39 `@`-decorators
   * already buffered by the caller.
   */
  private extractClassField(
    node: SyntaxNode,
    symbols: SymbolNode[],
    moduleName: string,
    className: string,
    decorators: string[],
    docstring: string | undefined,
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const name = nameNode.text;
    if (!name) return;

    const modifiers: string[] = [];
    for (const child of node.children) {
      if (child.type === "accessibility_modifier") modifiers.push(child.text);
      else if (child.type === "readonly") modifiers.push("readonly");
      else if (child.type === "static") modifiers.push("static");
    }

    symbols.push({
      name,
      qualifiedName: `${moduleName}.${className}.${name}`,
      kind: "variable",
      decorators: [...modifiers, ...decorators],
      docstring,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parent: className,
    });
  }

  /**
   * Heritage clauses produce both `extends` and `implements` references.
   */
  private extractHeritage(node: SyntaxNode): string[] {
    const bases: string[] = [];
    const heritage = node.namedChildren.find((c) => c.type === "class_heritage");
    if (!heritage) return bases;
    for (const clause of heritage.namedChildren) {
      if (clause.type !== "extends_clause" && clause.type !== "implements_clause") continue;
      for (const value of clause.namedChildren) {
        if (
          value.type === "identifier"
          || value.type === "type_identifier"
          || value.type === "member_expression"
          || value.type === "generic_type"
        ) {
          bases.push(this.bareTypeName(value));
        }
      }
    }
    return bases;
  }

  // ─── Interface / type / enum / namespace ────────────────────────────────

  private extractInterface(
    node: SyntaxNode,
    symbols: SymbolNode[],
    references: SymbolReference[],
    moduleName: string,
    docstring: string | undefined,
  ): void {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "<anonymous>";
    const qualifiedName = `${moduleName}.${name}`;

    const bases: string[] = [];
    const heritage = node.namedChildren.find((c) => c.type === "extends_type_clause");
    if (heritage) {
      for (const value of heritage.namedChildren) {
        if (
          value.type === "type_identifier"
          || value.type === "generic_type"
          || value.type === "nested_type_identifier"
        ) {
          bases.push(this.bareTypeName(value));
        }
      }
    }

    symbols.push({
      name,
      qualifiedName,
      kind: "interface",
      decorators: [],
      docstring,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      bases,
    });

    for (const base of bases) {
      references.push({
        name: base,
        fromSymbol: qualifiedName,
        kind: "extends",
        line: node.startPosition.row + 1,
      });
    }
  }

  private extractTypeAlias(
    node: SyntaxNode,
    symbols: SymbolNode[],
    moduleName: string,
    docstring: string | undefined,
  ): void {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "<anonymous>";
    symbols.push({
      name,
      qualifiedName: `${moduleName}.${name}`,
      kind: "type",
      decorators: [],
      docstring,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    });
  }

  private extractEnum(
    node: SyntaxNode,
    symbols: SymbolNode[],
    moduleName: string,
    docstring: string | undefined,
  ): void {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "<anonymous>";
    symbols.push({
      name,
      qualifiedName: `${moduleName}.${name}`,
      kind: "enum",
      decorators: [],
      docstring,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    });
  }

  private extractNamespace(
    node: SyntaxNode,
    sourceCode: string,
    symbols: SymbolNode[],
    imports: ImportDeclaration[],
    references: SymbolReference[],
    moduleName: string,
    docstring: string | undefined,
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const name = nameNode.text;
    const qualifiedName = `${moduleName}.${name}`;

    symbols.push({
      name,
      qualifiedName,
      kind: "namespace",
      decorators: [],
      docstring,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    });

    const body = node.childForFieldName("body");
    if (body) {
      this.handleSiblings(body, sourceCode, symbols, imports, references, qualifiedName);
    }
  }

  // ─── Top-level const / let / var ────────────────────────────────────────

  /**
   * Top-level `const` / `let` / `var` declarations.
   *
   * Three classes of declaration produce graph symbols:
   *   1. Arrow / function expressions (`const handler = () => …`,
   *      `const httpClient = function () { … }`) become `kind: "function"`.
   *   2. UPPER_SNAKE_CASE bindings become `kind: "constant"` regardless
   *      of whether they're exported (matches Python's behaviour).
   *   3. Any *exported* binding becomes `kind: "constant"` so consumers
   *      see `export const userService = createUserService()` in the
   *      symbol list. Internal lowercase bindings remain hidden so
   *      garden-variety locals (`const tmp = …`) don't pollute the graph.
   */
  private extractTopLevelDeclarations(
    node: SyntaxNode,
    symbols: SymbolNode[],
    references: SymbolReference[],
    moduleName: string,
    docstring: string | undefined,
    isExported = false,
  ): void {
    for (const declarator of node.namedChildren) {
      if (declarator.type !== "variable_declarator") continue;
      const nameNode = declarator.childForFieldName("name")
        ?? declarator.namedChildren.find((c) => c.type === "identifier");
      if (!nameNode || nameNode.type !== "identifier") continue;
      const name = nameNode.text;

      const value = declarator.childForFieldName("value");
      if (value && (value.type === "arrow_function" || value.type === "function_expression")) {
        const signature = this.buildArrowFunctionSignature(value, name);
        const calls = this.extractCalls(value);
        const qualifiedName = `${moduleName}.${name}`;
        const decorators = this.augmentDecoratorsWithModifiers(value, []);
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
        continue;
      }

      const isUpperSnake = /^[A-Z][A-Z0-9_]*$/.test(name);
      if (isUpperSnake || isExported) {
        symbols.push({
          name,
          qualifiedName: `${moduleName}.${name}`,
          kind: "constant",
          decorators: [],
          docstring,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
      }
    }
  }

  // ─── Exports computation ────────────────────────────────────────────────

  private computeExports(
    tree: SyntaxTree,
    _sourceCode: string,
    symbols: SymbolNode[],
  ): string[] {
    const exported = new Set<string>();
    let sawDefault = false;

    const walk = (node: SyntaxNode): void => {
      if (node.type === "export_statement") {
        const isDefault = node.text.includes("export default");
        if (isDefault) sawDefault = true;
        for (const child of node.namedChildren) {
          this.collectExportedNames(child, exported);
        }
      }
      for (const c of node.namedChildren) walk(c);
    };
    walk(tree.rootNode);

    if (exported.size === 0 && !sawDefault) return [];

    // Filter symbols to only those that are explicitly exported
    const result: string[] = [];
    for (const s of symbols) {
      if (exported.has(s.name)) result.push(s.name);
    }
    if (sawDefault && !result.includes("default")) result.push("default");
    return result;
  }

  private collectExportedNames(node: SyntaxNode, into: Set<string>): void {
    switch (node.type) {
      case "function_declaration":
      case "class_declaration":
      case "abstract_class_declaration":
      case "interface_declaration":
      case "type_alias_declaration":
      case "enum_declaration":
      case "internal_module":
      case "module": {
        const nameNode = node.childForFieldName("name");
        if (nameNode) into.add(nameNode.text);
        break;
      }
      case "lexical_declaration":
      case "variable_declaration": {
        for (const declarator of node.namedChildren) {
          if (declarator.type !== "variable_declarator") continue;
          const nameNode = declarator.childForFieldName("name")
            ?? declarator.namedChildren.find((c) => c.type === "identifier");
          if (nameNode && nameNode.type === "identifier") into.add(nameNode.text);
        }
        break;
      }
      case "export_clause": {
        for (const spec of node.namedChildren) {
          if (spec.type === "export_specifier") {
            const aliasNode = spec.childForFieldName("alias");
            const nameNode = spec.childForFieldName("name")
              ?? spec.namedChildren.find((c) => c.type === "identifier");
            const localName = aliasNode?.text ?? nameNode?.text;
            if (localName) into.add(localName);
          }
        }
        break;
      }
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private buildFunctionSignature(node: SyntaxNode, name: string): string {
    const paramsNode = node.childForFieldName("parameters");
    const returnTypeNode = node.childForFieldName("return_type");
    const params = paramsNode?.text ?? "()";
    const ret = returnTypeNode ? ` ${returnTypeNode.text}` : "";
    return `${name}${params}${ret}`;
  }

  private buildArrowFunctionSignature(node: SyntaxNode, name: string): string {
    const paramsNode = node.childForFieldName("parameters")
      ?? node.namedChildren.find((c) => c.type === "formal_parameters");
    const returnTypeNode = node.childForFieldName("return_type");
    const params = paramsNode?.text ?? "()";
    const ret = returnTypeNode ? ` ${returnTypeNode.text}` : "";
    return `${name}${params}${ret}`;
  }

  private cleanJsDoc(block: string): string | undefined {
    const lines = block.split(/\r?\n/).map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("*")) return trimmed.slice(1).trim();
      return trimmed;
    });
    while (lines.length > 0 && lines[0] === "") lines.shift();
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

    const firstLine = lines[0];
    if (!firstLine) return undefined;
    return firstLine.length > 300 ? `${firstLine.slice(0, 297)}...` : firstLine;
  }

  /**
   * Module-level docstring: the first leading `/** ... *\/` block at file
   * start. tree-sitter-typescript exposes comments as named children of
   * `program`, so we just look at the first one if it's a JSDoc.
   */
  private extractModuleDocstring(tree: SyntaxTree): string | undefined {
    const firstChild = tree.rootNode.namedChildren[0];
    if (!firstChild || firstChild.type !== "comment") return undefined;
    const text = firstChild.text;
    if (!text.startsWith("/**") || !text.endsWith("*/")) return undefined;
    return this.cleanJsDoc(text.slice(3, -2));
  }

  private extractCalls(node: SyntaxNode): string[] {
    const calls: string[] = [];
    const visited = new Set<string>();

    const record = (name: string): void => {
      if (!visited.has(name)) {
        visited.add(name);
        calls.push(name);
      }
    };

    const walk = (n: SyntaxNode): void => {
      if (n.type === "call_expression") {
        const funcNode = n.childForFieldName("function");
        if (funcNode) record(funcNode.text);
      } else if (
        n.type === "jsx_opening_element" ||
        n.type === "jsx_self_closing_element"
      ) {
        // JSX component usages (`<Card />`, `<Card.Header />`,
        // `<ns.Component />`) are recorded as `calls` edges. We skip native
        // HTML / SVG tags whose name starts with a lowercase letter
        // (`<div>`, `<button>`, `<svg>`) because they would only add
        // graph-wide noise — a member expression always wins because it
        // can never be a native tag.
        const nameNode = n.childForFieldName("name");
        if (nameNode) {
          const text = nameNode.text;
          if (text.length > 0) {
            const isMember = nameNode.type === "member_expression";
            const first = text[0]!;
            if (isMember || (first >= "A" && first <= "Z")) {
              record(text);
            }
          }
        }
      }
      for (const child of n.namedChildren) walk(child);
    };

    const body = node.childForFieldName("body");
    if (body) walk(body);
    return calls;
  }

  /**
   * Reduce a generic / qualified type expression to its bare type name.
   * Examples: `EventEmitter` → `EventEmitter`, `Foo<Bar>` → `Foo`,
   * `ns.Mod.Type` → `ns.Mod.Type` (preserved verbatim).
   */
  private bareTypeName(node: SyntaxNode): string {
    if (node.type === "generic_type") {
      const name = node.namedChildren.find(
        (c) => c.type === "type_identifier" || c.type === "nested_type_identifier" || c.type === "identifier",
      );
      if (name) return name.text;
    }
    return node.text;
  }

  private unquoteString(raw: string): string {
    if (raw.length < 2) return raw;
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' || first === "'" || first === "`") && first === last) {
      return raw.slice(1, -1);
    }
    return raw;
  }

  private hasKnownExtension(p: string): boolean {
    return this.resolveCandidates.some((ext) => p.endsWith(ext));
  }

  private filePathToModuleName(filePath: string): string {
    const normalized = toPosix(filePath);
    let modulePath = normalized;
    for (const ext of this.extensions) {
      if (modulePath.endsWith(ext)) {
        modulePath = modulePath.slice(0, -ext.length);
        break;
      }
    }
    if (modulePath.endsWith("/index")) modulePath = modulePath.slice(0, -6);
    return modulePath.replace(/\//g, ".");
  }
}
