/**
 * C++ language extractor.
 *
 * Subclasses `CFamilyExtractor` from `@reponova/lang-c-core` to inherit
 * the full C subset (functions, structs/unions/enums, typedefs, macros,
 * globals, the `#include` resolver, the preprocessor-conditional
 * walker, and every helper) and layers C++-specific dispatch on top:
 *
 *   - `namespace_definition`   → emits a `module` symbol, recurses into
 *                                the body with extended scope
 *                                (`module.ns1.ns2`).
 *   - `class_specifier`        → emits a `class` symbol with bases
 *                                surfaced as `extends` references,
 *                                walks the `field_declaration_list`
 *                                tracking access modifier state, and
 *                                emits methods (kind `method`) and
 *                                members (kind `variable`/`constant`).
 *   - `struct_specifier`       → C++ structs are classes with default
 *                                public access; routed through the
 *                                same `extractClass` path.
 *   - `template_declaration`   → unwraps the templated class /
 *                                function / typedef and tags it with a
 *                                `template` decorator (parameters
 *                                preserved in the signature).
 *   - `using_declaration`      → `using foo::bar;` becomes a named
 *                                import; `using namespace foo;`
 *                                becomes a wildcard import on `foo`.
 *   - `alias_declaration`      → `using X = Y;` emits a `type` symbol
 *                                tagged with `["alias"]`.
 *
 * Out-of-class definitions (`void Foo::bar() { … }`) are surfaced as
 * top-level functions with their qualified name reflecting the
 * enclosing scope; the resolver does not yet merge them into the
 * class's method list (the graph builder reconciles via qualified
 * names).
 *
 * The C-flavor extract methods of the parent class are reused
 * verbatim — `extractFunctionDefinition`, `extractDeclaration`,
 * `extractRecord`, `extractEnum`, `extractTypedef`, `extractInclude`,
 * `extractObjectMacro`, `extractFunctionMacro`, `extractCalls`, and
 * `walkTopLevel` — so any future bugfix in `lang-c-core` is inherited
 * automatically.
 */
import {
  CFamilyExtractor,
  C_TOP_LEVEL_DECLARATIONS,
  extractDeclaratorName,
  extractQualifiedScope,
  findFunctionDeclarator,
  collectStorageAndQualifierKeywords,
  hasFunctionDeclarator,
  truncate,
} from "@reponova/lang-c-core";
import type {
  ImportDeclaration,
  SymbolNode,
  SymbolReference,
  SyntaxNode,
  SyntaxTree,
  FileExtraction,
} from "reponova";

/**
 * Extended top-level node set. Includes everything from C plus the
 * C++ shapes we surface as their own top-level statements.
 */
const CPP_TOP_LEVEL_DECLARATIONS: ReadonlySet<string> = new Set([
  ...C_TOP_LEVEL_DECLARATIONS,
  "namespace_definition",
  "class_specifier",
  "template_declaration",
  "using_declaration",
  "alias_declaration",
]);

/** Default `LanguageExtractor` for `.cpp/.cc/.cxx/.hpp/.hh/.hxx` files. */
export class CppExtractor extends CFamilyExtractor {
  constructor() {
    super({
      languageId: "cpp",
      extensions: [".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hh", ".hxx", ".h++"],
      wasmFile: "tree-sitter-cpp.wasm",
    });
  }

  protected override topLevelLeafTypes(): ReadonlySet<string> {
    return CPP_TOP_LEVEL_DECLARATIONS;
  }

  protected override dispatchTopLevel(
    node: SyntaxNode,
    symbols: SymbolNode[],
    references: SymbolReference[],
    imports: ImportDeclaration[],
    scope: string,
    moduleName: string,
  ): void {
    switch (node.type) {
      case "namespace_definition":
        this.extractNamespace(node, symbols, references, imports, scope, moduleName);
        return;
      case "class_specifier":
      case "struct_specifier":
        // In C++ a struct is a class with default-public access; the
        // grammar still surfaces them with distinct node types but
        // identical body shape (`field_declaration_list` with
        // interleaved `access_specifier` markers). We route both
        // through `extractClass`, passing the appropriate default
        // access. (C structs use tree-sitter-c which produces a
        // simpler shape and is handled by `super.dispatchTopLevel`,
        // but the lang-cpp grammar never produces that — every
        // `struct_specifier` here has the C++ shape.)
        this.extractClass(
          node,
          symbols,
          references,
          scope,
          node.type === "struct_specifier" ? "public" : "private",
          undefined,
        );
        return;
      case "template_declaration":
        this.extractTemplateDeclaration(node, symbols, references, imports, scope, moduleName);
        return;
      case "using_declaration":
        this.extractUsingDeclaration(node, imports);
        return;
      case "alias_declaration":
        this.extractAliasDeclaration(node, symbols, scope);
        return;
      case "function_definition":
        // C++ out-of-class definitions (`void Foo::bar() { … }`) need
        // scope-prefix handling that the C-core method doesn't do.
        // Detect a `qualified_identifier` in the declarator and
        // forward the prefix as an extended scope; otherwise defer to
        // the parent implementation unchanged.
        if (this.tryExtractQualifiedFunctionDefinition(node, symbols, references, scope)) return;
        break; // fall through to super for the unqualified case
    }
    super.dispatchTopLevel(node, symbols, references, imports, scope, moduleName);
  }

  // ─── Namespaces ─────────────────────────────────────────────────────────

  /**
   * Emit a `module`-kind symbol for the namespace itself and recurse
   * into its body with the scope extended by the namespace name. Each
   * level of nesting adds another dotted segment so symbols inside
   * `namespace a { namespace b { void f(); } }` end up with
   * `qualifiedName = "${moduleName}.a.b.f"`.
   *
   * Anonymous namespaces (`namespace { … }`) keep the outer scope and
   * are not surfaced as their own symbol — their contents are still
   * walked. This mirrors the C++ semantics: unnamed namespaces are
   * translation-unit-local but their members are not "inside" any
   * named scope from the caller's point of view.
   */
  private extractNamespace(
    node: SyntaxNode,
    symbols: SymbolNode[],
    references: SymbolReference[],
    imports: ImportDeclaration[],
    scope: string,
    moduleName: string,
  ): void {
    const nameNode = node.childForFieldName("name");
    const body = node.childForFieldName("body");
    const newScope = nameNode ? `${scope}.${nameNode.text}` : scope;

    if (nameNode) {
      symbols.push({
        name: nameNode.text,
        qualifiedName: newScope,
        kind: "module",
        decorators: ["namespace"],
        docstring: this.extractDeclarationDocstring(node),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      });
    }

    if (!body) return;
    this.walkTopLevel(body, (child) => {
      this.dispatchTopLevel(child, symbols, references, imports, newScope, moduleName);
    });
  }

  // ─── Classes ────────────────────────────────────────────────────────────

  /**
   * Extract a class / struct definition.
   *
   * Steps:
   *   1. Emit a `class` symbol with `decorators: ["class"|"struct"]`.
   *   2. Surface each base in `base_class_clause` as an `extends`
   *      reference from the class to the base type.
   *   3. Walk `field_declaration_list` children in source order,
   *      tracking the current access modifier (defaults to `private`
   *      for `class`, `public` for `struct`). Each `field_declaration`
   *      / `function_definition` / `declaration` emitted picks up the
   *      current access as a decorator.
   *   4. Methods (any declarator with a `function_declarator` inside)
   *      become kind `method`. Constructors (declarator's inner is the
   *      class name as `identifier`) and destructors (`destructor_name`)
   *      are emitted with `decorators` including `ctor`/`dtor`.
   *   5. Members become kind `variable`/`constant` depending on
   *      `const` qualifier. Each carries the access decorator.
   *
   * `parentTemplate` carries the template parameter signature for
   * templated classes so the symbol signature reflects `template<T>`.
   */
  private extractClass(
    node: SyntaxNode,
    symbols: SymbolNode[],
    references: SymbolReference[],
    scope: string,
    defaultAccess: "public" | "private" | "protected",
    parentTemplate: string | undefined,
  ): void {
    const nameNode = node.childForFieldName("name");
    const body = node.childForFieldName("body");
    // Anonymous classes (`class { … }`) inside a typedef are handled
    // by the parent `extractTypedef`; standalone anonymous classes are
    // rare enough that we skip them entirely.
    if (!nameNode || !body) return;
    const name = nameNode.text;
    const qualifiedName = `${scope}.${name}`;
    const isStruct = node.type === "struct_specifier";
    const decorators = [isStruct ? "struct" : "class"];
    if (parentTemplate) decorators.push("template");

    const signature = parentTemplate ? `${parentTemplate} class ${name}` : `class ${name}`;
    const docstring = this.extractDeclarationDocstring(node);

    symbols.push({
      name,
      qualifiedName,
      kind: "class",
      signature,
      decorators,
      docstring,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    });

    // Bases: surface each as an `extends` reference and capture the
    // raw text for the signature. C++ allows multiple bases; we emit
    // one reference per base.
    for (const child of node.namedChildren) {
      if (child.type !== "base_class_clause") continue;
      for (const baseChild of child.namedChildren) {
        if (
          baseChild.type === "type_identifier" ||
          baseChild.type === "template_type" ||
          baseChild.type === "qualified_identifier"
        ) {
          references.push({
            name: baseChild.text,
            fromSymbol: qualifiedName,
            kind: "extends",
            line: node.startPosition.row + 1,
          });
        }
      }
    }

    // Walk the member list.
    let access = defaultAccess;
    for (const child of body.namedChildren) {
      switch (child.type) {
        case "access_specifier":
          access = child.text as "public" | "private" | "protected";
          continue;
        case "field_declaration":
          this.extractClassFieldDeclaration(
            child,
            symbols,
            references,
            qualifiedName,
            access,
          );
          continue;
        case "function_definition":
          this.extractClassMethodDefinition(
            child,
            symbols,
            references,
            qualifiedName,
            access,
            name,
          );
          continue;
        case "declaration":
          // In a class body, `declaration` is reserved for constructors
          // and destructors (they have no return type). Field
          // declarations always come back as `field_declaration`.
          this.extractClassCtorOrDtor(
            child,
            symbols,
            references,
            qualifiedName,
            access,
            name,
          );
          continue;
        case "template_declaration":
          // Nested templated method/field — unwrap and re-dispatch
          // against the class scope.
          this.extractClassNestedTemplate(
            child,
            symbols,
            references,
            qualifiedName,
            access,
            name,
          );
          continue;
        case "friend_declaration":
          // Friend declarations don't introduce a symbol — they grant
          // access to an external entity. Skip without warning.
          continue;
        case "using_declaration":
          // `using Base::method;` inside a class body. Skip for now —
          // these don't introduce new methods, only adjust visibility.
          continue;
        case "alias_declaration":
          // Nested `using Inner = Outer;` — surface as a `type` symbol
          // under the class scope.
          this.extractAliasDeclaration(child, symbols, qualifiedName);
          continue;
        case "class_specifier":
        case "struct_specifier":
          // Nested class definition.
          this.extractClass(
            child,
            symbols,
            references,
            qualifiedName,
            child.type === "struct_specifier" ? "public" : "private",
            undefined,
          );
          continue;
        case "enum_specifier":
          this.extractEnum(child, symbols, qualifiedName, undefined);
          continue;
      }
    }
  }

  /**
   * Extract a `field_declaration` inside a class body. The declarator
   * may be:
   *   - `field_identifier` (`int x_;`)                        → variable / constant
   *   - `array_declarator` (`int buf_[16];`)                  → variable
   *   - `pointer_declarator` (`int* p_;`)                     → variable
   *   - `function_declarator` (`void render() const;`)        → method declaration
   *   - `reference_declarator` (`Foo& ref_;`)                 → variable
   *   - any of the above wrapped through a parenthesized form
   *     (`int (*fp_)(int);`)                                   → function pointer field
   * Per-declarator emission so multi-declarator lines like
   * `int x_, y_;` produce one symbol each.
   */
  private extractClassFieldDeclaration(
    node: SyntaxNode,
    symbols: SymbolNode[],
    references: SymbolReference[],
    classQualifiedName: string,
    access: string,
  ): void {
    const typeNode = node.childForFieldName("type");
    const typeText = typeNode ? typeNode.text : "";
    const modifiers = collectStorageAndQualifierKeywords(node);

    // Find all declarator candidates among named children.
    const declarators = node.namedChildren.filter((c) =>
      [
        "field_identifier",
        "array_declarator",
        "pointer_declarator",
        "function_declarator",
        "reference_declarator",
        "init_declarator",
      ].includes(c.type),
    );

    const docstring = this.extractDeclarationDocstring(node);
    for (const decl of declarators) {
      const name = extractDeclaratorName(decl);
      if (!name) continue;
      const isFn = decl.type === "function_declarator" || hasFunctionDeclarator(decl);
      if (isFn) {
        // It's a method declaration (no body — body lives in a
        // separate function_definition or as an out-of-class
        // definition in a .cpp file).
        const params = extractFunctionParams(decl);
        const signature = `${name}${params}${typeText ? `: ${typeText}` : ""}`;
        const decorators = [access, "declaration", ...modifiers];
        if (name.startsWith("operator")) decorators.push("operator");
        symbols.push({
          name,
          qualifiedName: `${classQualifiedName}.${name}`,
          kind: "method",
          signature,
          decorators,
          docstring,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          parent: classQualifiedName,
        });
        continue;
      }

      // Member variable or constant.
      const isConst = modifiers.includes("const");
      symbols.push({
        name,
        qualifiedName: `${classQualifiedName}.${name}`,
        kind: isConst ? "constant" : "variable",
        signature: typeText ? `${name}: ${typeText}` : name,
        decorators: [access, "field", ...modifiers],
        docstring,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        parent: classQualifiedName,
      });
    }

    // If the type itself is an inline class/struct/enum, emit it too.
    if (typeNode) {
      if (typeNode.type === "class_specifier" || typeNode.type === "struct_specifier") {
        this.extractClass(
          typeNode,
          symbols,
          references,
          classQualifiedName,
          typeNode.type === "struct_specifier" ? "public" : "private",
          undefined,
        );
      } else if (typeNode.type === "enum_specifier") {
        this.extractEnum(typeNode, symbols, classQualifiedName, undefined);
      }
    }
  }

  /**
   * Extract an inline-defined method (`void render() { … }` inside a
   * class body). Emits a `method` symbol nested under the class and
   * the calls inside the body as `calls` references.
   */
  private extractClassMethodDefinition(
    node: SyntaxNode,
    symbols: SymbolNode[],
    references: SymbolReference[],
    classQualifiedName: string,
    access: string,
    className: string,
  ): void {
    const declarator = node.childForFieldName("declarator");
    if (!declarator) return;
    const funcDecl = findFunctionDeclarator(declarator);
    if (!funcDecl) return;
    const name = extractDeclaratorName(funcDecl.childForFieldName("declarator"));
    if (!name) return;

    const returnTypeNode = node.childForFieldName("type");
    const returnType = returnTypeNode ? returnTypeNode.text : "";
    const params = funcDecl.childForFieldName("parameters")?.text ?? "()";
    const decorators = [access, ...collectStorageAndQualifierKeywords(node)];
    if (name === className) decorators.push("ctor");
    if (name.startsWith("~")) decorators.push("dtor");
    if (name.startsWith("operator")) decorators.push("operator");

    const signature = `${name}${params}${returnType ? `: ${returnType}` : ""}`;
    const docstring = this.extractDeclarationDocstring(node);
    const calls = this.extractCalls(node);
    const qualifiedName = `${classQualifiedName}.${name}`;

    symbols.push({
      name,
      qualifiedName,
      kind: "method",
      signature,
      decorators,
      docstring,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parent: classQualifiedName,
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
   * Extract a constructor or destructor declaration inside a class
   * body. They appear as `declaration` nodes (no `type` field) with
   * a `function_declarator` whose inner declarator is either:
   *   - `identifier` matching the class name → ctor
   *   - `destructor_name` (`~Foo`)           → dtor
   *   - `operator_name`                       → operator declaration
   * Other `declaration` shapes inside a class body are unusual; we
   * surface them anyway with the regular method handling.
   */
  private extractClassCtorOrDtor(
    node: SyntaxNode,
    symbols: SymbolNode[],
    references: SymbolReference[],
    classQualifiedName: string,
    access: string,
    className: string,
  ): void {
    const declarator = node.childForFieldName("declarator");
    if (!declarator) return;
    const funcDecl = findFunctionDeclarator(declarator);
    if (!funcDecl) return;
    const name = extractDeclaratorName(funcDecl.childForFieldName("declarator"));
    if (!name) return;
    const modifiers = collectStorageAndQualifierKeywords(node);
    const decorators = [access, "declaration", ...modifiers];
    if (name === className) decorators.push("ctor");
    if (name.startsWith("~")) decorators.push("dtor");
    if (name.startsWith("operator")) decorators.push("operator");
    const params = funcDecl.childForFieldName("parameters")?.text ?? "()";
    const signature = `${name}${params}`;
    const docstring = this.extractDeclarationDocstring(node);
    symbols.push({
      name,
      qualifiedName: `${classQualifiedName}.${name}`,
      kind: "method",
      signature,
      decorators,
      docstring,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parent: classQualifiedName,
    });
  }

  /**
   * A nested templated declaration inside a class body — typically a
   * templated method (`template <typename U> void cast() { … }`).
   * Unwrap the template, build a `template<…>` signature prefix, and
   * dispatch to the appropriate handler against the class scope.
   */
  private extractClassNestedTemplate(
    node: SyntaxNode,
    symbols: SymbolNode[],
    references: SymbolReference[],
    classQualifiedName: string,
    access: string,
    className: string,
  ): void {
    const paramsNode = node.childForFieldName("parameters");
    const tparams = paramsNode ? `template${paramsNode.text}` : "template<>";
    const inner = node.namedChildren.find(
      (c) =>
        c.type === "function_definition" ||
        c.type === "field_declaration" ||
        c.type === "declaration",
    );
    if (!inner) return;
    if (inner.type === "function_definition") {
      this.extractClassMethodDefinition(
        inner,
        symbols,
        references,
        classQualifiedName,
        access,
        className,
      );
    } else if (inner.type === "field_declaration") {
      this.extractClassFieldDeclaration(
        inner,
        symbols,
        references,
        classQualifiedName,
        access,
      );
    } else if (inner.type === "declaration") {
      this.extractClassCtorOrDtor(
        inner,
        symbols,
        references,
        classQualifiedName,
        access,
        className,
      );
    }
    // Tag the last emitted member (if any) with `template`.
    const last = symbols[symbols.length - 1];
    if (last && last.parent === classQualifiedName) {
      last.decorators = [...last.decorators, "template"];
      last.signature = last.signature ? `${tparams} ${last.signature}` : tparams;
    }
  }

  // ─── Templates ─────────────────────────────────────────────────────────

  /**
   * Unwrap a top-level `template_declaration` and dispatch the inner
   * declaration with a `template` signature prefix and a `template`
   * decorator. The wrapped node is one of: `class_specifier`,
   * `struct_specifier`, `function_definition`, `declaration`,
   * `type_definition`, or `alias_declaration`.
   */
  private extractTemplateDeclaration(
    node: SyntaxNode,
    symbols: SymbolNode[],
    references: SymbolReference[],
    imports: ImportDeclaration[],
    scope: string,
    moduleName: string,
  ): void {
    const paramsNode = node.childForFieldName("parameters");
    const tparams = paramsNode ? `template${paramsNode.text}` : "template<>";
    const before = symbols.length;
    const inner = node.namedChildren.find(
      (c) =>
        c.type === "class_specifier" ||
        c.type === "struct_specifier" ||
        c.type === "function_definition" ||
        c.type === "declaration" ||
        c.type === "type_definition" ||
        c.type === "alias_declaration",
    );
    if (!inner) return;

    if (inner.type === "class_specifier" || inner.type === "struct_specifier") {
      this.extractClass(
        inner,
        symbols,
        references,
        scope,
        inner.type === "struct_specifier" ? "public" : "private",
        tparams,
      );
    } else {
      // Delegate to standard dispatch.
      this.dispatchTopLevel(inner, symbols, references, imports, scope, moduleName);
    }

    // Tag every symbol added at this template's scope with `template`
    // and prepend the template parameter list to its signature.
    for (let i = before; i < symbols.length; i++) {
      const s = symbols[i]!;
      // Only re-tag the directly produced top-level symbol — nested
      // class members already inherit their containing class's
      // template marker; we already added it inside extractClass.
      if (s.parent !== undefined) continue;
      if (!s.decorators.includes("template")) {
        s.decorators = [...s.decorators, "template"];
      }
      if (s.signature && !s.signature.startsWith("template")) {
        s.signature = `${tparams} ${s.signature}`;
      } else if (!s.signature) {
        s.signature = tparams;
      }
    }
  }

  // ─── Using / aliases ────────────────────────────────────────────────────

  /**
   * `using std::cout;`        → ImportDeclaration { module="std", names=["cout"], isWildcard=false }
   * `using std::vector;`      → ImportDeclaration { module="std", names=["vector"], isWildcard=false }
   * `using namespace std;`    → ImportDeclaration { module="std", names=[], isWildcard=true }
   * `using namespace foo::bar;` → ImportDeclaration { module="foo.bar", names=[], isWildcard=true }
   *
   * The grammar uses the same `using_declaration` node type for both
   * named imports (`using foo::bar;`) and namespace directives
   * (`using namespace foo;`). We distinguish by checking the raw
   * text for the `namespace` keyword — robust regardless of which
   * exact child shape the grammar emits for the payload.
   *
   * Only the two well-formed shapes are handled: the C++ standard
   * does not allow a bare `using foo;` outside a class body (where
   * it has different semantics and is filtered out in `extractClass`),
   * so we don't synthesise an import for the malformed-source case.
   */
  private extractUsingDeclaration(
    node: SyntaxNode,
    imports: ImportDeclaration[],
  ): void {
    const line = node.startPosition.row + 1;
    const isNamespaceDirective = /\busing\s+namespace\b/.test(node.text);
    const payload = node.namedChildren.find(
      (c) => c.type === "qualified_identifier" || c.type === "identifier",
    );
    if (!payload) return;

    if (isNamespaceDirective) {
      // `using namespace foo::bar;` → wildcard import on the fully
      // qualified namespace path.
      imports.push({
        module: payload.text.replace(/::/g, "."),
        names: [],
        isWildcard: true,
        line,
      });
      return;
    }

    // Named import (`using foo::bar;`) — the payload is always a
    // qualified_identifier here per the grammar (a bare identifier
    // is only valid inside a class body and is filtered by
    // `extractClass`).
    if (payload.type === "qualified_identifier") {
      const scopeNode = payload.childForFieldName("scope");
      const nameNode = payload.childForFieldName("name");
      imports.push({
        module: scopeNode ? scopeNode.text.replace(/::/g, ".") : "",
        names: nameNode ? [nameNode.text] : [],
        isWildcard: false,
        line,
      });
    }
  }

  /**
   * `using IntVec = std::vector<int>;` and similar alias declarations.
   * The C++ grammar uses `alias_declaration` with `name` and `type`
   * fields. We emit a `type`-kind symbol with the `alias` decorator
   * (distinct from `typedef`-style aliases produced by
   * `type_definition`).
   */
  private extractAliasDeclaration(
    node: SyntaxNode,
    symbols: SymbolNode[],
    scope: string,
  ): void {
    const nameNode = node.childForFieldName("name");
    const typeNode = node.childForFieldName("type");
    if (!nameNode) return;
    const name = nameNode.text;
    const typeText = typeNode ? typeNode.text : "";
    const docstring = this.extractDeclarationDocstring(node);
    symbols.push({
      name,
      qualifiedName: `${scope}.${name}`,
      kind: "type",
      signature: typeText ? `${name} = ${truncate(typeText, 100)}` : name,
      decorators: ["alias"],
      docstring,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    });
  }

  // ─── Out-of-class function definitions ──────────────────────────────────

  /**
   * Detect and handle a `function_definition` whose declarator is a
   * `qualified_identifier` (`void Foo::bar() { … }`,
   * `int ns::Cls::method()`). When present, we build the qualified
   * name by prepending the qualifier segments to the current scope so
   * the resulting symbol lines up with the in-class declaration when
   * the graph builder joins them by qualifiedName.
   *
   * Returns true when this handler consumed the node — the caller
   * should skip the parent's regular `extractFunctionDefinition`.
   */
  private tryExtractQualifiedFunctionDefinition(
    node: SyntaxNode,
    symbols: SymbolNode[],
    references: SymbolReference[],
    scope: string,
  ): boolean {
    const declarator = node.childForFieldName("declarator");
    if (!declarator) return false;
    const funcDecl = findFunctionDeclarator(declarator);
    if (!funcDecl) return false;
    const qualifierSegments = extractQualifiedScope(funcDecl.childForFieldName("declarator"));
    if (qualifierSegments.length === 0) return false;
    const name = extractDeclaratorName(funcDecl.childForFieldName("declarator"));
    if (!name) return false;

    const returnTypeNode = node.childForFieldName("type");
    const returnType = returnTypeNode ? returnTypeNode.text : "";
    const params = funcDecl.childForFieldName("parameters")?.text ?? "()";
    const signature = `${name}${params}${returnType ? `: ${returnType}` : ""}`;
    const docstring = this.extractDeclarationDocstring(node);
    const decorators = ["out_of_class", ...collectStorageAndQualifierKeywords(node)];
    if (name.startsWith("~")) decorators.push("dtor");
    if (name.startsWith("operator")) decorators.push("operator");
    const calls = this.extractCalls(node);

    const enclosingScope = `${scope}.${qualifierSegments.join(".")}`;
    const qualifiedName = `${enclosingScope}.${name}`;

    symbols.push({
      name,
      qualifiedName,
      kind: "method",
      signature,
      decorators,
      docstring,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parent: enclosingScope,
    });

    for (const call of calls) {
      references.push({
        name: call,
        fromSymbol: qualifiedName,
        kind: "calls",
        line: node.startPosition.row + 1,
      });
    }

    return true;
  }

  // ─── Exports override ───────────────────────────────────────────────────

  /**
   * The base `computeExports` already excludes any symbol with a
   * `parent` (so class members are skipped) and only surfaces
   * top-level functions / variables / constants whose qualifiedName
   * sits directly under the module prefix.
   *
   * In C++ we additionally want to:
   *   - surface namespaces themselves as exports (they're at
   *     `${moduleName}.<ns>` and have kind `module`), and
   *   - surface classes (kind `class`) since they ARE linker-visible
   *     entities (their typeinfo, vtables, and constructors are).
   *
   * Note: we deliberately do NOT export deeply-nested classes/methods
   * inside namespaces — qualified names larger than two segments
   * relative to the module belong to the containing namespace's
   * scope, which surfaces separately.
   */
  protected override computeExports(symbols: SymbolNode[], moduleName: string): string[] {
    const prefix = `${moduleName}.`;
    const base = super.computeExports(symbols, moduleName);
    const extras = symbols
      .filter((s) => {
        if (s.parent !== undefined) return false;
        if (!s.qualifiedName.startsWith(prefix)) return false;
        const tail = s.qualifiedName.slice(prefix.length);
        if (tail.includes(".")) return false;
        // Only export top-level namespaces and classes here; functions
        // and variables are already covered by the base.
        if (s.kind === "module") return true;
        if (s.kind === "class") return true;
        return false;
      })
      .map((s) => s.name);
    // De-dupe while preserving order: base entries first, then extras.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of [...base, ...extras]) {
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    return out;
  }
}

// ─── Local helpers ────────────────────────────────────────────────────────

/**
 * Return the `(params)` text of a function-pointer-like declarator.
 * For a plain `function_declarator` this is just the `parameters`
 * field; for a chain wrapping the function declarator
 * (`array_declarator` / `pointer_declarator` / `reference_declarator`),
 * we recurse until we find one.
 */
function extractFunctionParams(node: SyntaxNode): string {
  if (node.type === "function_declarator") {
    return node.childForFieldName("parameters")?.text ?? "()";
  }
  // Wrapper declarators (pointer_declarator, array_declarator,
  // reference_declarator, parenthesized_declarator) all share the
  // shape: peel one level and recurse. We use `childForFieldName` when
  // available and fall back to the first named child.
  const inner = node.childForFieldName("declarator") ?? node.namedChildren[0];
  return inner ? extractFunctionParams(inner) : "()";
}

// Re-export for convenience so tests can construct an extractor without
// importing from `lang-c-core`.
export { CFamilyExtractor };

// Convenience extractor that also satisfies the LanguageExtractor
// interface for the `LanguagePlugin` shape.
export type CppExtraction = FileExtraction;

// Helpful type alias so consumers can `import type { CppSyntaxTree } from "@reponova/lang-cpp"`.
export type CppSyntaxTree = SyntaxTree;
