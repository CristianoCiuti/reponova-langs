/**
 * TypeScript language extractor.
 *
 * Produces a FileExtraction for `.ts/.mts/.cts` source files using
 * `tree-sitter-typescript.wasm`. Coverage:
 *
 *   - Symbols: functions, classes, methods, interfaces, type aliases,
 *     enums, top-level constants (UPPER_SNAKE_CASE only)
 *   - Imports: default, named, namespace, side-effect, type-only,
 *     `export ... from` re-exports
 *   - References: extends/implements (classes), call expressions
 *   - Module-level docstring: leading JSDoc /** ... *\/ comment
 *   - Symbol docstring: JSDoc directly preceding the declaration
 *
 * `.tsx` (JSX) is intentionally NOT in the extension list for v0.1.0:
 * supporting it requires a second grammar (`tree-sitter-tsx.wasm`),
 * which the current `LanguagePlugin` contract does not allow per plugin.
 * See README "Limitations" for the planned v0.2.0 follow-up.
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

const TS_EXTENSIONS = [".ts", ".mts", ".cts"] as const;

/** Candidate file extensions tried when resolving a relative import. */
const RESOLVE_CANDIDATES = [".ts", ".mts", ".cts", ".d.ts"] as const;

/** Index file names tried when resolving a directory import. */
const INDEX_CANDIDATES = [
  "index.ts",
  "index.mts",
  "index.cts",
  "index.d.ts",
] as const;

export class TypescriptExtractor implements LanguageExtractor {
  readonly languageId = "typescript";
  readonly extensions = [...TS_EXTENSIONS];
  readonly wasmFile = "tree-sitter-typescript.wasm";

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

    const exports = this.computeExports(tree, sourceCode, symbols);
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
    for (const ext of RESOLVE_CANDIDATES) candidates.push(`${target}${ext}`);
    for (const idx of INDEX_CANDIDATES) candidates.push(`${target}/${idx}`);
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
        this.extractTopLevelDeclarations(node, symbols, references, moduleName, jsDoc);
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

    symbols.push({
      name,
      qualifiedName,
      kind,
      signature,
      decorators,
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
      if (member.type === "method_definition") {
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
      // public_field_definition, abstract_method_signature, accessibility_modifier, etc.
      // Reset pending so they don't leak to the next method.
      pendingDecorators = [];
      pendingJsDoc = undefined;
    }
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

  private extractTopLevelDeclarations(
    node: SyntaxNode,
    symbols: SymbolNode[],
    references: SymbolReference[],
    moduleName: string,
    docstring: string | undefined,
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
        symbols.push({
          name,
          qualifiedName,
          kind: "function",
          signature,
          decorators: [],
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

      // Heuristic: UPPER_SNAKE_CASE → constant; everything else is not promoted to a graph symbol
      if (/^[A-Z][A-Z0-9_]*$/.test(name)) {
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

    const walk = (n: SyntaxNode): void => {
      if (n.type === "call_expression") {
        const funcNode = n.childForFieldName("function");
        if (funcNode) {
          const callName = funcNode.text;
          if (!visited.has(callName)) {
            visited.add(callName);
            calls.push(callName);
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
    return RESOLVE_CANDIDATES.some((ext) => p.endsWith(ext));
  }

  private filePathToModuleName(filePath: string): string {
    const normalized = toPosix(filePath);
    let modulePath = normalized;
    for (const ext of TS_EXTENSIONS) {
      if (modulePath.endsWith(ext)) {
        modulePath = modulePath.slice(0, -ext.length);
        break;
      }
    }
    if (modulePath.endsWith("/index")) modulePath = modulePath.slice(0, -6);
    return modulePath.replace(/\//g, ".");
  }
}
