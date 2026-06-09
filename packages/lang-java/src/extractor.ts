/**
 * Java language extractor.
 *
 * Extracts top-level + nested classes, interfaces, enums, records, and
 * annotation interfaces, plus their methods, constructors, fields, and
 * enum constants, plus their imports, supertypes (extends/implements),
 * and method-call references from Java source via tree-sitter AST
 * parsing.
 *
 * The qualified-name space is driven by the `package` declaration, not
 * by the on-disk file path — Java source roots (`src/main/java`,
 * `src/test/java`, custom Maven/Gradle layouts) are a project-level
 * concern and unknown to the extractor. `resolveImportPath` returns
 * path candidates relative to repo root that the graph builder can
 * match against extracted file paths.
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

type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "variable"
  | "constant"
  | "interface"
  | "enum"
  | "module"
  | "type";

/**
 * Tree-sitter-java named child types that hold further declarations at
 * the same logical scope. The grammar wraps modifiers around a
 * declaration, so we descend through `modifiers` siblings when
 * harvesting annotations, but the type containers themselves are flat
 * (top-level types live directly under `program`, members under
 * `class_body` / `interface_body` / `enum_body` /
 * `annotation_type_body`).
 *
 * `enum_body_declarations` is the wrapper for non-constant members
 * (methods, fields) inside an enum declaration — we descend through it
 * so methods on `enum X { A; void foo() {} }` are picked up.
 */
const MEMBER_CONTAINERS = new Set([
  "class_body",
  "interface_body",
  "enum_body",
  "annotation_type_body",
  "enum_body_declarations",
  "record_body",
]);

const TYPE_DECLARATIONS = new Set([
  "class_declaration",
  "interface_declaration",
  "enum_declaration",
  "record_declaration",
  "annotation_type_declaration",
]);

export class JavaExtractor implements LanguageExtractor {
  readonly languageId = "java";
  readonly extensions = [".java"];
  readonly wasmFile = "tree-sitter-java.wasm";

  extract(tree: SyntaxTree, _sourceCode: string, filePath: string): FileExtraction {
    const symbols: SymbolNode[] = [];
    const imports: ImportDeclaration[] = [];
    const references: SymbolReference[] = [];

    const fileName = posixBasename(filePath);
    const packageName = this.extractPackage(tree.rootNode);
    const fileDocstring = this.extractFileDocstring(tree.rootNode);

    const fileNode: FileNodeDeclaration = {
      kind: "module",
      label: fileName,
      docstring: fileDocstring,
    };

    for (const child of tree.rootNode.namedChildren) {
      switch (child.type) {
        case "import_declaration":
          imports.push(this.extractImport(child));
          break;
        case "class_declaration":
        case "interface_declaration":
        case "enum_declaration":
        case "record_declaration":
        case "annotation_type_declaration":
          this.extractType(child, symbols, references, packageName, undefined);
          break;
      }
    }

    const exports = this.computeExports(symbols, packageName);
    return { filePath, language: "java", fileNode, symbols, imports, references, exports };
  }

  /**
   * Convert a dotted Java import to candidate `.java` file paths relative
   * to repository root. The extractor does not know the project's source
   * root (`src/main/java`, custom layouts), so the candidates are
   * relative to repo root and the graph builder matches them against
   * extracted file paths by trailing-suffix match.
   *
   * Examples:
   *   `com.example.foo.Bar`              → ["com/example/foo/Bar.java"]
   *   `com.example.util.*` (wildcard)    → ["com/example/util/<*>.java"] (we
   *                                         emit no candidate because we don't
   *                                         know which file under that package
   *                                         was meant; the graph builder
   *                                         resolves by package directory.)
   *   `java.util.Collections.emptyList`  (a static import; the caller passes
   *                                         the full path including the
   *                                         member name. We drop the trailing
   *                                         lowercase-initial segment because
   *                                         Java members are conventionally
   *                                         lowercase and Java types are
   *                                         conventionally PascalCase.)
   */
  resolveImportPath(importModule: string, _currentFilePath: string): string[] {
    if (!importModule) return [];
    if (importModule.endsWith(".*")) {
      // Wildcard — no single candidate file. The graph builder may use the
      // package directory to match by sibling-package conventions; we
      // return an empty array (consistent with other extractors when no
      // specific file can be named).
      return [];
    }
    const parts = importModule.split(".");
    // Static imports include a trailing member name (e.g.
    // `java.util.Collections.emptyList`). Java members are conventionally
    // lowercase and Java types are conventionally PascalCase, so if the
    // last segment starts with a lowercase letter and we still have at
    // least one type-shaped segment above it, we drop it.
    if (parts.length >= 2) {
      const last = parts[parts.length - 1]!;
      const penultimate = parts[parts.length - 2]!;
      if (/^[a-z]/.test(last) && /^[A-Z]/.test(penultimate)) {
        parts.pop();
      }
    }
    return [`${parts.join("/")}.java`];
  }

  // ─── Package + imports ──────────────────────────────────────────────────

  private extractPackage(root: SyntaxNode): string | undefined {
    for (const child of root.namedChildren) {
      if (child.type === "package_declaration") {
        const inner = child.namedChildren.find(
          (c) => c.type === "scoped_identifier" || c.type === "identifier",
        );
        return inner?.text;
      }
    }
    return undefined;
  }

  private extractImport(node: SyntaxNode): ImportDeclaration {
    let isWildcard = false;
    let dotted = "";

    for (const child of node.namedChildren) {
      if (child.type === "scoped_identifier" || child.type === "identifier") {
        dotted = child.text;
      } else if (child.type === "asterisk") {
        isWildcard = true;
      }
    }

    // For type imports (`import java.util.Map`) we surface the type name
    // in `names` and the enclosing package in `module`, matching how the
    // Python extractor models `from x import Y`.
    //
    // For static imports (`import static java.util.Collections.emptyList`)
    // the dotted path additionally includes the member name. We split
    // the member off into `names` and keep the type in `module` (NOT the
    // enclosing package) because the type is what the graph needs to
    // resolve.
    //
    // Wildcards (`import a.b.*`, `import static a.b.C.*`) keep the full
    // dotted prefix in `module` with `isWildcard: true` and no `names`.
    let module = dotted;
    const names: string[] = [];
    if (!isWildcard) {
      const idx = dotted.lastIndexOf(".");
      if (idx > 0) {
        module = dotted.slice(0, idx);
        names.push(dotted.slice(idx + 1));
      }
    }

    return {
      module,
      names,
      isWildcard,
      line: node.startPosition.row + 1,
    };
  }

  // ─── Type extraction (class/interface/enum/record/annotation_type) ──────

  private extractType(
    node: SyntaxNode,
    symbols: SymbolNode[],
    references: SymbolReference[],
    packageName: string | undefined,
    parentQualifiedName: string | undefined,
  ): void {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "<anonymous>";
    const qualifiedName = parentQualifiedName
      ? `${parentQualifiedName}.${name}`
      : packageName
        ? `${packageName}.${name}`
        : name;

    const kind = this.kindForType(node.type);
    const decorators = this.collectAnnotations(node);
    const modifierKeywords = this.collectModifierKeywords(node);
    if (node.type === "record_declaration") decorators.unshift("record");
    if (node.type === "annotation_type_declaration") decorators.unshift("annotation");
    for (const m of modifierKeywords) decorators.push(m);

    const bases: string[] = [];
    for (const child of node.namedChildren) {
      if (child.type === "superclass") {
        for (const c of child.namedChildren) {
          const baseName = this.unwrapType(c);
          if (baseName) bases.push(baseName);
        }
      } else if (child.type === "super_interfaces" || child.type === "extends_interfaces") {
        for (const list of child.namedChildren) {
          // `type_list` wraps the actual type names.
          if (list.type === "type_list") {
            for (const t of list.namedChildren) {
              const baseName = this.unwrapType(t);
              if (baseName) bases.push(baseName);
            }
          } else {
            const baseName = this.unwrapType(list);
            if (baseName) bases.push(baseName);
          }
        }
      }
    }

    const docstring = this.extractDeclarationDocstring(node);

    symbols.push({
      name,
      qualifiedName,
      kind,
      decorators,
      docstring,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parent: parentQualifiedName,
      bases: bases.length > 0 ? bases : undefined,
    });

    for (const base of bases) {
      references.push({
        name: base,
        fromSymbol: qualifiedName,
        kind: "extends",
        line: node.startPosition.row + 1,
      });
    }

    // Record components surface as fields on the synthetic class. We emit
    // them with `kind: "variable"` so the graph treats them like any
    // other declared field, but tag them with `record_component` so
    // downstream filters can distinguish them.
    if (node.type === "record_declaration") {
      const params = node.childForFieldName("parameters");
      if (params) {
        for (const p of params.namedChildren) {
          if (p.type !== "formal_parameter") continue;
          this.extractRecordComponent(p, symbols, qualifiedName);
        }
      }
    }

    // Annotation type elements behave like abstract methods on an
    // interface — we surface them as methods so the symbol shape is
    // uniform across declaration kinds.
    if (node.type === "annotation_type_declaration") {
      const body = node.namedChildren.find((c) => c.type === "annotation_type_body");
      if (body) {
        for (const el of body.namedChildren) {
          if (el.type === "annotation_type_element_declaration") {
            this.extractAnnotationElement(el, symbols, qualifiedName);
          }
        }
      }
    }

    const body = node.childForFieldName("body");
    if (body) {
      this.walkMembers(body, (member) => {
        this.dispatchMember(member, symbols, references, packageName, qualifiedName);
      });
    }
  }

  private walkMembers(container: SyntaxNode, action: (child: SyntaxNode) => void): void {
    for (const child of container.namedChildren) {
      if (MEMBER_CONTAINERS.has(child.type)) {
        this.walkMembers(child, action);
      } else {
        action(child);
      }
    }
  }

  private dispatchMember(
    member: SyntaxNode,
    symbols: SymbolNode[],
    references: SymbolReference[],
    packageName: string | undefined,
    enclosingQualifiedName: string,
  ): void {
    switch (member.type) {
      case "method_declaration":
        this.extractMethod(member, symbols, references, enclosingQualifiedName, false);
        return;
      case "constructor_declaration":
        this.extractMethod(member, symbols, references, enclosingQualifiedName, true);
        return;
      case "field_declaration":
        this.extractField(member, symbols, enclosingQualifiedName);
        return;
      case "enum_constant":
        this.extractEnumConstant(member, symbols, enclosingQualifiedName);
        return;
      case "class_declaration":
      case "interface_declaration":
      case "enum_declaration":
      case "record_declaration":
      case "annotation_type_declaration":
        this.extractType(member, symbols, references, packageName, enclosingQualifiedName);
        return;
    }
  }

  // ─── Member extraction ─────────────────────────────────────────────────

  private extractMethod(
    node: SyntaxNode,
    symbols: SymbolNode[],
    references: SymbolReference[],
    enclosingQualifiedName: string,
    isConstructor: boolean,
  ): void {
    const nameNode = node.childForFieldName("name") ?? node.namedChildren.find((c) => c.type === "identifier");
    const name = nameNode?.text ?? "<anonymous>";
    const qualifiedName = `${enclosingQualifiedName}.${name}`;

    const decorators = this.collectAnnotations(node);
    const modifiers = this.collectModifierKeywords(node);
    if (isConstructor) decorators.unshift("constructor");
    for (const m of modifiers) decorators.push(m);

    const paramsNode = node.childForFieldName("parameters");
    const params = paramsNode?.text ?? "()";
    const returnTypeNode = node.childForFieldName("type");
    const ret = returnTypeNode ? `: ${returnTypeNode.text}` : "";
    const signature = `${name}${params}${ret}`;

    const docstring = this.extractDeclarationDocstring(node);
    const calls = this.extractCalls(node);

    symbols.push({
      name,
      qualifiedName,
      kind: "method",
      signature,
      decorators,
      docstring,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parent: enclosingQualifiedName,
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
   * One `field_declaration` may declare multiple variables on one line
   * (`int x, y, z;`). We emit one symbol per `variable_declarator`. The
   * `static final` combination promotes the symbol to `kind: "constant"`;
   * otherwise it's `kind: "variable"`.
   */
  private extractField(
    node: SyntaxNode,
    symbols: SymbolNode[],
    enclosingQualifiedName: string,
  ): void {
    const modifiers = this.collectModifierKeywords(node);
    const annotations = this.collectAnnotations(node);
    const isStatic = modifiers.includes("static");
    const isFinal = modifiers.includes("final");
    const kind: SymbolKind = isStatic && isFinal ? "constant" : "variable";

    const typeNode = node.namedChildren.find(
      (c) => c.type !== "modifiers" && c.type !== "variable_declarator" && c.type !== "block_comment" && c.type !== "line_comment",
    );
    const typeText = typeNode?.text ?? "";

    const docstring = this.extractDeclarationDocstring(node);

    for (const child of node.namedChildren) {
      if (child.type !== "variable_declarator") continue;
      const idNode = child.namedChildren.find((c) => c.type === "identifier");
      if (!idNode) continue;
      const name = idNode.text;
      symbols.push({
        name,
        qualifiedName: `${enclosingQualifiedName}.${name}`,
        kind,
        signature: typeText ? `${name}: ${typeText}` : name,
        decorators: [...annotations, ...modifiers],
        docstring,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        parent: enclosingQualifiedName,
      });
    }
  }

  private extractEnumConstant(
    node: SyntaxNode,
    symbols: SymbolNode[],
    enclosingQualifiedName: string,
  ): void {
    const idNode = node.namedChildren.find((c) => c.type === "identifier");
    if (!idNode) return;
    const name = idNode.text;
    const annotations = this.collectAnnotations(node);
    const docstring = this.extractDeclarationDocstring(node);
    symbols.push({
      name,
      qualifiedName: `${enclosingQualifiedName}.${name}`,
      kind: "constant",
      decorators: ["enum_constant", ...annotations],
      docstring,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parent: enclosingQualifiedName,
    });
  }

  private extractRecordComponent(
    node: SyntaxNode,
    symbols: SymbolNode[],
    enclosingQualifiedName: string,
  ): void {
    const idNode = node.namedChildren.find((c) => c.type === "identifier");
    if (!idNode) return;
    const name = idNode.text;
    const typeNode = node.namedChildren.find((c) => c.type !== "identifier" && c.type !== "modifiers");
    const typeText = typeNode?.text ?? "";
    symbols.push({
      name,
      qualifiedName: `${enclosingQualifiedName}.${name}`,
      kind: "variable",
      signature: typeText ? `${name}: ${typeText}` : name,
      decorators: ["record_component"],
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parent: enclosingQualifiedName,
    });
  }

  private extractAnnotationElement(
    node: SyntaxNode,
    symbols: SymbolNode[],
    enclosingQualifiedName: string,
  ): void {
    const idNode = node.namedChildren.find((c) => c.type === "identifier");
    if (!idNode) return;
    const name = idNode.text;
    const annotations = this.collectAnnotations(node);
    const typeNode = node.namedChildren.find(
      (c) => c.type !== "identifier" && c.type !== "modifiers" && c.type !== "block_comment",
    );
    const typeText = typeNode?.text ?? "";
    const docstring = this.extractDeclarationDocstring(node);
    symbols.push({
      name,
      qualifiedName: `${enclosingQualifiedName}.${name}`,
      kind: "method",
      signature: typeText ? `${name}(): ${typeText}` : `${name}()`,
      decorators: ["annotation_element", ...annotations],
      docstring,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parent: enclosingQualifiedName,
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private kindForType(nodeType: string): SymbolKind {
    switch (nodeType) {
      case "class_declaration":
      case "record_declaration":
        return "class";
      case "interface_declaration":
      case "annotation_type_declaration":
        return "interface";
      case "enum_declaration":
        return "enum";
      default:
        return "class";
    }
  }

  /**
   * Reduce a heritage-clause type node to its bare type name. Strips
   * generic argument lists (`BaseService<User>` → `BaseService`) and
   * unwraps `scoped_identifier` chains (the inner-most identifier is
   * the type name, the rest is the package qualifier — but for an
   * `extends` edge we want the full qualified path, so we keep the
   * text and only strip the generic arguments).
   */
  private unwrapType(node: SyntaxNode): string | null {
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

  /**
   * Collect annotations from a declaration's `modifiers` child (if any).
   * `marker_annotation` is `@Foo`, `annotation` is `@Foo(args)`. We
   * preserve the bare annotation name (the leading `@` is stripped) so
   * downstream filtering by decorator works the same way as Python's
   * decorator list.
   */
  private collectAnnotations(node: SyntaxNode): string[] {
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

  /**
   * Collect non-annotation modifier keywords (`public`, `private`,
   * `protected`, `static`, `final`, `abstract`, `default`, `synchronized`,
   * `native`, `transient`, `volatile`, `sealed`, `non-sealed`).
   * tree-sitter-java exposes these as anonymous children of `modifiers`,
   * so we walk `children` (not `namedChildren`).
   */
  private collectModifierKeywords(node: SyntaxNode): string[] {
    const out: string[] = [];
    const modifiers = node.namedChildren.find((c) => c.type === "modifiers");
    if (!modifiers) return out;
    for (const child of modifiers.children) {
      if (child.type === "marker_annotation" || child.type === "annotation") continue;
      out.push(child.type);
    }
    return out;
  }

  /**
   * Extract the leading Javadoc for a declaration. Tree-sitter-java exposes
   * `block_comment` as a named sibling that appears immediately before the
   * declaration inside the enclosing container (`program` for top-level
   * types, `class_body` / `interface_body` / `enum_body` for members).
   *
   * Implementation note: `web-tree-sitter` returns a fresh `SyntaxNode`
   * wrapper for every access of `parent.namedChildren`, so reference
   * equality (`Array.indexOf(node)`) is unreliable. We locate the
   * declaration's slot by start position instead, which is stable
   * across wrappers.
   */
  private extractDeclarationDocstring(node: SyntaxNode): string | undefined {
    const parent = node.parent;
    if (!parent) return undefined;
    const siblings = parent.namedChildren;
    const targetRow = node.startPosition.row;
    const targetCol = node.startPosition.column;
    let idx = -1;
    for (let i = 0; i < siblings.length; i++) {
      const s = siblings[i]!;
      if (s.startPosition.row === targetRow && s.startPosition.column === targetCol && s.type === node.type) {
        idx = i;
        break;
      }
    }
    if (idx <= 0) return undefined;
    const prev = siblings[idx - 1]!;
    if (prev.type !== "block_comment") return undefined;
    const text = prev.text;
    if (!text.startsWith("/**")) return undefined;
    return cleanJavadoc(text);
  }

  private extractFileDocstring(root: SyntaxNode): string | undefined {
    // Look at the first block_comment that appears before any non-package
    // top-level declaration. Conventionally this is the file's header
    // Javadoc (often a license or copyright block).
    for (const child of root.namedChildren) {
      if (child.type === "block_comment") {
        const text = child.text;
        if (text.startsWith("/**")) return cleanJavadoc(text);
      } else if (TYPE_DECLARATIONS.has(child.type)) {
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Walk a method/constructor body and collect every `method_invocation`
   * and `object_creation_expression`. For a method invocation we capture
   * the full call expression (`obj.foo`, `Cls.bar`, plain `baz`) so the
   * graph builder can match against qualified or unqualified names. For
   * a `new Foo(...)` expression we capture the type as the callee.
   *
   * Duplicates are folded into a single edge per call site to keep the
   * graph stable; for an outer method, the same `foo()` invoked five
   * times still produces a single `calls` edge.
   */
  private extractCalls(node: SyntaxNode): string[] {
    const calls: string[] = [];
    const seen = new Set<string>();

    const walk = (n: SyntaxNode): void => {
      if (n.type === "method_invocation") {
        const objectNode = n.childForFieldName("object");
        const nameNode = n.childForFieldName("name");
        if (nameNode) {
          const callName = objectNode
            ? `${objectNode.text}.${nameNode.text}`
            : nameNode.text;
          if (!seen.has(callName)) {
            seen.add(callName);
            calls.push(callName);
          }
        }
      } else if (n.type === "object_creation_expression") {
        const typeNode = n.childForFieldName("type");
        if (typeNode) {
          const callName = this.unwrapType(typeNode) ?? typeNode.text;
          if (!seen.has(callName)) {
            seen.add(callName);
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

  private computeExports(symbols: SymbolNode[], packageName: string | undefined): string[] {
    // Java's public surface: every top-level public type. We treat
    // `public` as the gating modifier (the legacy "package-private"
    // default visibility never leaves its compilation unit).
    const prefix = packageName ? `${packageName}.` : "";
    return symbols
      .filter((s) => {
        if (s.parent !== undefined && s.parent !== packageName) return false;
        if (!s.decorators.includes("public")) return false;
        if (!s.qualifiedName.startsWith(prefix)) return false;
        const tail = s.qualifiedName.slice(prefix.length);
        return !tail.includes(".");
      })
      .map((s) => s.name);
  }
}

// ─── Free helpers ─────────────────────────────────────────────────────────

function posixBasename(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}

/**
 * Strip the Javadoc decoration (`/**`, `*\/`, leading ` * ` on each line)
 * and return the first non-empty line, trimmed to 300 characters. We
 * intentionally drop tags (`@param`, `@return`, …) from the first-line
 * preview — they almost never make a useful one-line summary.
 */
function cleanJavadoc(raw: string): string | undefined {
  let text = raw.trim();
  if (text.startsWith("/**")) text = text.slice(3);
  if (text.endsWith("*/")) text = text.slice(0, -2);
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").trim())
    .filter((l) => l.length > 0 && !l.startsWith("@"));
  if (lines.length === 0) return undefined;
  const summary = lines[0]!;
  return summary.length > 300 ? summary.slice(0, 297) + "..." : summary;
}
