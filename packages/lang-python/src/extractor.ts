/**
 * Python language extractor.
 *
 * Extracts functions, classes, methods, imports, calls, type aliases,
 * `TypeVar` / `NewType` / `ParamSpec` symbols, and conditional-block
 * imports from Python source code using tree-sitter AST parsing.
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
  | "enum"
  | "module"
  | "document"
  | "section"
  | "component"
  | "type";

// ─── Path helpers (inlined to avoid depending on reponova internals) ─────────

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function posixBasename(p: string): string {
  const normalized = toPosix(p);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}

/**
 * Tree-sitter-python container node types whose body contains further
 * statements that should be treated as if they were at the same scope as
 * the parent for extraction purposes.
 *
 * The most important real-world cases are:
 *   - `if TYPE_CHECKING:` blocks for runtime-free type imports.
 *   - `try: import x ; except ImportError: import alt as x` for soft deps.
 *
 * We descend through both control-flow scaffolding (`if_statement`,
 * `else_clause`, etc.) and the inner `block` node that actually carries
 * the statement list.
 */
const STATEMENT_CONTAINERS = new Set([
  "module",
  "if_statement",
  "elif_clause",
  "else_clause",
  "try_statement",
  "except_clause",
  "except_group_clause",
  "finally_clause",
  "block",
]);

export class PythonExtractor implements LanguageExtractor {
  readonly languageId = "python";
  readonly extensions = [".py", ".pyw"];
  readonly wasmFile = "tree-sitter-python.wasm";

  extract(tree: SyntaxTree, _sourceCode: string, filePath: string): FileExtraction {
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

    this.walkContainer(tree.rootNode, (child) => {
      this.dispatchTopLevel(child, symbols, imports, references, moduleName, filePath);
    });

    const isInit = filePath.endsWith("__init__.py") || filePath.endsWith("__init__");
    if (isInit) {
      for (const imp of imports) {
        imp.isExport = true;
      }
    }

    const exports = this.computeExports(tree, symbols);
    return { filePath, language: "python", fileNode, symbols, imports, references, exports };
  }

  resolveImportPath(importModule: string, currentFilePath: string): string[] {
    if (importModule.startsWith(".")) {
      return this.resolveRelativeImport(importModule, currentFilePath);
    }
    const parts = importModule.split(".");
    const basePath = parts.join("/");
    return [`${basePath}.py`, `${basePath}/__init__.py`];
  }

  // ─── Top-level dispatch ──────────────────────────────────────────────────

  /**
   * Walk a statement container and apply `action` to every direct
   * statement child. Container nodes (if/try/else/except/finally and the
   * inner `block`) are recursively descended so that imports and
   * declarations buried inside `if TYPE_CHECKING:` or `try / except
   * ImportError:` blocks are still surfaced at the module level.
   */
  private walkContainer(node: SyntaxNode, action: (stmt: SyntaxNode) => void): void {
    for (const child of node.namedChildren) {
      if (STATEMENT_CONTAINERS.has(child.type)) {
        this.walkContainer(child, action);
      } else {
        action(child);
      }
    }
  }

  private dispatchTopLevel(
    child: SyntaxNode,
    symbols: SymbolNode[],
    imports: ImportDeclaration[],
    references: SymbolReference[],
    moduleName: string,
    filePath: string,
  ): void {
    switch (child.type) {
      case "import_statement":
        imports.push(this.extractImport(child));
        return;
      case "import_from_statement":
        imports.push(this.extractFromImport(child));
        return;
      case "future_import_statement":
        imports.push(this.extractFutureImport(child));
        return;
      case "function_definition":
        this.extractFunction(child, symbols, references, moduleName, filePath);
        return;
      case "class_definition":
        this.extractClass(child, symbols, references, moduleName, filePath);
        return;
      case "decorated_definition":
        this.extractDecorated(child, symbols, references, moduleName, filePath);
        return;
      case "type_alias_statement":
        this.extractPep695TypeAlias(child, symbols, moduleName);
        return;
      case "expression_statement": {
        const expr = child.namedChildren[0];
        if (expr && expr.type === "assignment") {
          this.extractAssignment(expr, symbols, moduleName);
        }
        return;
      }
    }
  }

  // ─── Import Extraction ───────────────────────────────────────────────────

  private extractImport(node: SyntaxNode): ImportDeclaration {
    const names: string[] = [];
    let module = "";

    for (const child of node.namedChildren) {
      if (child.type === "dotted_name") {
        if (!module) module = child.text;
        else names.push(child.text);
      } else if (child.type === "aliased_import") {
        const nameNode = child.namedChildren[0];
        if (nameNode) {
          if (!module) module = nameNode.text;
          else names.push(nameNode.text);
        }
      }
    }

    return { module, names, isWildcard: false, line: node.startPosition.row + 1 };
  }

  /**
   * `from __future__ import annotations` is parsed by tree-sitter-python as
   * `future_import_statement`, distinct from a regular `import_from_statement`.
   * We surface it under the synthetic module name `__future__` so that
   * downstream tooling sees the directive uniformly with other imports.
   */
  private extractFutureImport(node: SyntaxNode): ImportDeclaration {
    const names: string[] = [];
    for (const child of node.namedChildren) {
      if (child.type === "dotted_name") {
        names.push(child.text);
      } else if (child.type === "aliased_import") {
        const nameNode = child.namedChildren[0];
        if (nameNode) names.push(nameNode.text);
      }
    }
    return {
      module: "__future__",
      names,
      isWildcard: false,
      line: node.startPosition.row + 1,
    };
  }

  private extractFromImport(node: SyntaxNode): ImportDeclaration {
    let module = "";
    const names: string[] = [];
    let isWildcard = false;

    for (const child of node.namedChildren) {
      if (child.type === "dotted_name" || child.type === "relative_import") {
        if (!module) module = child.text;
        else names.push(child.text);
      } else if (child.type === "aliased_import") {
        const nameNode = child.namedChildren[0];
        if (nameNode) names.push(nameNode.text);
      } else if (child.type === "wildcard_import") {
        isWildcard = true;
      }
    }

    if (!module) {
      const match = node.text.match(/from\s+(\S+)\s+import/);
      if (match) module = match[1]!;
    }

    return { module, names, isWildcard, line: node.startPosition.row + 1 };
  }

  // ─── Function Extraction ─────────────────────────────────────────────────

  private extractFunction(
    node: SyntaxNode,
    symbols: SymbolNode[],
    references: SymbolReference[],
    moduleName: string,
    _filePath: string,
    parentClass?: string,
    decorators: string[] = [],
  ): void {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "<anonymous>";
    const kind: SymbolKind = parentClass ? "method" : "function";

    const paramsNode = node.childForFieldName("parameters");
    const returnType = node.childForFieldName("return_type");
    const params = paramsNode?.text ?? "()";
    const ret = returnType ? ` -> ${returnType.text}` : "";
    const signature = `${name}${params}${ret}`;

    const docstring = this.extractDocstring(node);
    const calls = this.extractCalls(node);

    const finalDecorators = this.isAsyncFunction(node)
      ? ["async", ...decorators]
      : decorators;

    const qualifiedName = parentClass
      ? `${moduleName}.${parentClass}.${name}`
      : `${moduleName}.${name}`;

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
   * `async def foo(...)`: tree-sitter-python attaches the `async` keyword
   * as an anonymous child token of `function_definition`. We have to
   * inspect `node.children` (not `namedChildren`) to see it.
   */
  private isAsyncFunction(node: SyntaxNode): boolean {
    for (const child of node.children) {
      if (child.type === "async") return true;
    }
    return false;
  }

  // ─── Class Extraction ────────────────────────────────────────────────────

  private extractClass(
    node: SyntaxNode,
    symbols: SymbolNode[],
    references: SymbolReference[],
    moduleName: string,
    filePath: string,
    decorators: string[] = [],
  ): void {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "<anonymous>";
    const qualifiedName = `${moduleName}.${name}`;

    const bases: string[] = [];
    const superclassNode = node.childForFieldName("superclasses")
      ?? node.namedChildren.find((c) => c.type === "argument_list");
    if (superclassNode) {
      for (const arg of superclassNode.namedChildren) {
        if (arg.type === "keyword_argument") continue;
        const baseName = this.unwrapBase(arg);
        if (baseName) bases.push(baseName);
      }
    }

    const docstring = this.extractDocstring(node);

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
      for (const child of body.namedChildren) {
        if (child.type === "function_definition") {
          this.extractFunction(child, symbols, references, moduleName, filePath, name);
        } else if (child.type === "decorated_definition") {
          const decs = this.extractDecoratorList(child);
          const funcNode = child.namedChildren.find((c) => c.type === "function_definition");
          if (funcNode) {
            this.extractFunction(funcNode, symbols, references, moduleName, filePath, name, decs);
          }
          const classNode = child.namedChildren.find((c) => c.type === "class_definition");
          if (classNode) {
            this.extractClass(classNode, symbols, references, moduleName, filePath, decs);
          }
        } else if (child.type === "class_definition") {
          this.extractClass(child, symbols, references, moduleName, filePath);
        }
      }
    }
  }

  /**
   * Reduce a class-base argument node to its bare type name. Supports
   * plain identifiers, dotted names, attributes, and parameterised
   * generics like `Cache[K, V]` / `typing.Generic[K, V]` / `Mapping[K,
   * list[V]]` (which collapses to the outermost name).
   */
  private unwrapBase(node: SyntaxNode): string | null {
    switch (node.type) {
      case "identifier":
      case "dotted_name":
      case "attribute":
        return node.text;
      case "subscript": {
        const value = node.childForFieldName("value") ?? node.namedChildren[0];
        return value ? this.unwrapBase(value) : null;
      }
      default:
        return null;
    }
  }

  // ─── Decorated Definition ────────────────────────────────────────────────

  private extractDecorated(
    node: SyntaxNode,
    symbols: SymbolNode[],
    references: SymbolReference[],
    moduleName: string,
    filePath: string,
  ): void {
    const decorators = this.extractDecoratorList(node);
    const definition = node.namedChildren.find(
      (c) => c.type === "function_definition" || c.type === "class_definition",
    );
    if (!definition) return;

    if (definition.type === "function_definition") {
      this.extractFunction(definition, symbols, references, moduleName, filePath, undefined, decorators);
    } else {
      this.extractClass(definition, symbols, references, moduleName, filePath, decorators);
    }
  }

  // ─── Assignment Extraction ───────────────────────────────────────────────

  /**
   * Capture three flavours of module-level assignment as graph symbols:
   *
   *   1. `K = TypeVar("K")` / `Foo = NewType("Foo", int)` /
   *      `P = ParamSpec("P")` / `Ts = TypeVarTuple("Ts")` →
   *      `kind: "type"` with the constructor name as a decorator
   *      (`typevar`, `newtype`, `paramspec`, `typevartuple`). The
   *      function may be qualified (`typing.TypeVar`, `t.TypeVar`).
   *
   *   2. `User = Dict[str, Any]` / `Ids = list[int]` / `T = A | B` →
   *      `kind: "type"`, `decorators: ["alias"]`. The heuristic is
   *      conservative: we only treat the assignment as a type alias when
   *      the LHS is `PascalCase` (uppercase first letter, not all-caps,
   *      no underscores between letters in the rest) and the RHS is a
   *      `subscript`, a `generic_type`, or a PEP 604 union
   *      (`binary_operator` over `|`). Lowercase names like `result =
   *      mapping[key]` are intentionally NOT promoted.
   *
   *   3. `MAX_RETRIES = 3` / `LOG_LINE = "..."` → `kind: "constant"`
   *      (legacy behaviour, preserved verbatim).
   */
  private extractAssignment(node: SyntaxNode, symbols: SymbolNode[], moduleName: string): void {
    const left = node.childForFieldName("left");
    if (!left || left.type !== "identifier") return;
    const name = left.text;
    const right = node.childForFieldName("right");

    // 1. typing constructors
    if (right && right.type === "call") {
      const fnNode = right.childForFieldName("function");
      const fnText = fnNode?.text ?? "";
      const baseFn = fnText.includes(".") ? fnText.split(".").pop()! : fnText;
      const TYPING_CTORS: Record<string, string> = {
        TypeVar: "typevar",
        NewType: "newtype",
        ParamSpec: "paramspec",
        TypeVarTuple: "typevartuple",
      };
      if (baseFn in TYPING_CTORS) {
        symbols.push({
          name,
          qualifiedName: `${moduleName}.${name}`,
          kind: "type",
          decorators: [TYPING_CTORS[baseFn]!],
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
        return;
      }
    }

    // 2. UPPER_SNAKE_CASE constant — checked before the type-alias heuristic
    //    so that a constant named `MAX_RETRIES = 3` is never mis-classified.
    if (/^[A-Z][A-Z0-9_]*$/.test(name)) {
      symbols.push({
        name,
        qualifiedName: `${moduleName}.${name}`,
        kind: "constant",
        decorators: [],
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      });
      return;
    }

    // 3. Conservative type-alias heuristic
    if (right && /^[A-Z][a-zA-Z0-9_]*$/.test(name) && this.looksLikeTypeAlias(right)) {
      symbols.push({
        name,
        qualifiedName: `${moduleName}.${name}`,
        kind: "type",
        decorators: ["alias"],
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      });
    }
  }

  /**
   * RHS shape that we take to indicate a type-alias assignment.
   *   - `subscript`        : `Dict[str, Any]`, `list[int]`
   *   - `generic_type`     : annotated generic literal (rarely produced)
   *   - PEP 604 union      : `binary_operator` over `|` between two type expressions
   */
  private looksLikeTypeAlias(rhs: SyntaxNode): boolean {
    if (rhs.type === "subscript" || rhs.type === "generic_type") return true;
    if (rhs.type === "binary_operator") {
      for (const c of rhs.children) {
        if (c.type === "|") return true;
      }
    }
    return false;
  }

  /**
   * PEP 695 `type Foo = Dict[str, Any]` (Python 3.12+). tree-sitter-python
   * exposes this as a top-level `type_alias_statement`. The first
   * identifier child holds the alias name.
   */
  private extractPep695TypeAlias(
    node: SyntaxNode,
    symbols: SymbolNode[],
    moduleName: string,
  ): void {
    const nameNode = node.namedChildren.find(
      (c) => c.type === "type" || c.type === "identifier",
    );
    if (!nameNode) return;
    // `type` nodes wrap an inner identifier in 0.25.x; both shapes appear
    // depending on grammar version, so we unwrap one level if needed.
    const inner = nameNode.namedChildren.find((c) => c.type === "identifier") ?? nameNode;
    const name = inner.text;
    if (!name) return;

    symbols.push({
      name,
      qualifiedName: `${moduleName}.${name}`,
      kind: "type",
      decorators: ["pep695"],
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    });
  }

  private computeExports(tree: SyntaxTree, symbols: SymbolNode[]): string[] {
    const allList = this.extractDunderAll(tree);
    if (allList) return allList;
    return symbols.filter((s) => !s.name.startsWith("_")).map((s) => s.name);
  }

  private extractDunderAll(tree: SyntaxTree): string[] | null {
    let result: string[] | null = null;
    this.walkContainer(tree.rootNode, (child) => {
      if (result) return;
      if (child.type !== "expression_statement") return;
      const expr = child.namedChildren[0];
      if (!expr || expr.type !== "assignment") return;
      const left = expr.childForFieldName("left");
      if (!left || left.text !== "__all__") return;
      const right = expr.childForFieldName("right");
      if (!right || right.type !== "list") return;
      const names: string[] = [];
      for (const element of right.namedChildren) {
        if (element.type === "string") {
          const text = element.text.replace(/^["']|["']$/g, "");
          if (text) names.push(text);
        }
      }
      if (names.length > 0) result = names;
    });
    return result;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private extractModuleDocstring(tree: SyntaxTree): string | undefined {
    const firstChild = tree.rootNode.namedChildren[0];
    if (!firstChild || firstChild.type !== "expression_statement") return undefined;
    const expr = firstChild.namedChildren[0];
    if (!expr || (expr.type !== "string" && expr.type !== "concatenated_string")) return undefined;

    let text = expr.text;
    if (text.startsWith('"""') || text.startsWith("'''")) {
      text = text.slice(3, -3).trim();
    } else if (text.startsWith('"') || text.startsWith("'")) {
      text = text.slice(1, -1).trim();
    }

    const firstLine = text.split("\n")[0]?.trim() ?? text;
    return firstLine.length > 300 ? firstLine.slice(0, 297) + "..." : firstLine;
  }

  private extractDecoratorList(node: SyntaxNode): string[] {
    return node.namedChildren
      .filter((c) => c.type === "decorator")
      .map((c) => {
        const text = c.text.trim();
        return text.startsWith("@") ? text.slice(1) : text;
      });
  }

  private extractDocstring(node: SyntaxNode): string | undefined {
    const body = node.childForFieldName("body");
    if (!body) return undefined;
    const firstChild = body.namedChildren[0];
    if (!firstChild || firstChild.type !== "expression_statement") return undefined;
    const expr = firstChild.namedChildren[0];
    if (!expr || (expr.type !== "string" && expr.type !== "concatenated_string")) return undefined;

    let text = expr.text;
    if (text.startsWith('"""') || text.startsWith("'''")) {
      text = text.slice(3, -3).trim();
    } else if (text.startsWith('"') || text.startsWith("'")) {
      text = text.slice(1, -1).trim();
    }

    const firstLine = text.split("\n")[0]?.trim() ?? text;
    return firstLine.length > 300 ? firstLine.slice(0, 297) + "..." : firstLine;
  }

  private extractCalls(node: SyntaxNode): string[] {
    const calls: string[] = [];
    const visited = new Set<string>();

    const walk = (n: SyntaxNode): void => {
      if (n.type === "call") {
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

  private filePathToModuleName(filePath: string): string {
    const normalized = toPosix(filePath);
    let modulePath = normalized;
    if (modulePath.endsWith(".py")) modulePath = modulePath.slice(0, -3);
    if (modulePath.endsWith(".pyw")) modulePath = modulePath.slice(0, -4);
    if (modulePath.endsWith("/__init__")) modulePath = modulePath.slice(0, -9);
    return modulePath.replace(/\//g, ".");
  }

  private resolveRelativeImport(importModule: string, currentFilePath: string): string[] {
    const normalized = toPosix(currentFilePath);
    let currentDir = dirname(normalized);

    let dots = 0;
    while (dots < importModule.length && importModule[dots] === ".") dots++;
    for (let i = 1; i < dots; i++) currentDir = dirname(currentDir);

    const remainder = importModule.slice(dots);
    if (!remainder) {
      return [toPosix(join(currentDir, "__init__.py"))];
    }

    const parts = remainder.split(".");
    const basePath = toPosix(join(currentDir, ...parts));
    return [`${basePath}.py`, `${basePath}/__init__.py`];
  }
}
