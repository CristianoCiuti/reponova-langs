/**
 * PlantUML extractor.
 *
 * Parses PlantUML files (.puml, .plantuml) line-by-line via a small set of
 * regex matchers covering the diagram families RepoNova actually consumes
 * today:
 *
 *   - Class diagrams: `class`, `abstract` / `abstract class`, `interface`,
 *     `enum`, plus relationship arrows.
 *   - Sequence diagrams: `actor`, `participant`, `boundary`, `control`,
 *     `entity`, `collections`.
 *   - State diagrams: `state X` / `state "Display" as Alias` (the `[*]`
 *     pseudostate is skipped).
 *   - Component / deployment diagrams: `component`, `cloud`, `node`,
 *     `database`, `queue`, `rectangle`, `frame`, `folder`, `package`,
 *     plus the `[Foo]` bracket shorthand for inline components.
 *   - C4-DSL macros: `Person(...)`, `Person_Ext(...)`, `System(...)`,
 *     `System_Ext(...)`, `SystemDb(...)`, `Container(...)`,
 *     `ContainerDb(...)`, `ContainerQueue(...)`, `Component(...)`.
 *
 * All declarations collapse to a single canonical node name (the alias
 * when one is provided, otherwise the unquoted display label). The
 * keyword used to introduce the node is preserved as the symbol's first
 * decorator so consumers can still distinguish `actor` from `participant`
 * or `database` from `queue`.
 */
import type {
  LanguageExtractor,
  SyntaxTree,
  FileExtraction,
  FileNodeDeclaration,
  SymbolNode,
  SymbolReference,
} from "reponova";

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function posixBasename(p: string): string {
  const normalized = toPosix(p);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}

interface Decl {
  /** Symbol kind in the RepoNova graph. */
  readonly kind: "interface" | "component";
  /** First decorator: the PlantUML keyword that introduced the node. */
  readonly decorator: string;
  /** Canonical symbol name (alias if present, else display label). */
  readonly name: string;
}

/**
 * Class-diagram keywords. `abstract` and `abstract class` map to the same
 * `abstract_class` decorator so consumers can filter both.
 */
const CLASS_KEYWORDS = new Set([
  "class",
  "abstract class",
  "abstract",
  "interface",
  "enum",
]);

/**
 * Catch-all keywords that produce `kind: "component"` symbols. The keyword
 * itself is preserved as the first decorator.
 */
const COMPONENT_KEYWORDS = new Set([
  "actor",
  "participant",
  "boundary",
  "control",
  "entity",
  "collections",
  "state",
  "component",
  "cloud",
  "node",
  "database",
  "queue",
  "rectangle",
  "frame",
  "folder",
  "package",
]);

/**
 * Single regex that captures both class-diagram and component-style
 * declarations. Groups:
 *   1. keyword (`class`, `abstract class`, `participant`, …)
 *   2. quoted display label (without quotes)
 *   3. unquoted bare identifier (when no quotes are used)
 *   4. alias (the identifier after `as`)
 */
const DECL_REGEX = new RegExp(
  String.raw`^\s*(abstract\s+class|abstract|class|interface|enum|`
    + String.raw`actor|participant|boundary|control|entity|collections|`
    + String.raw`state|component|cloud|node|database|queue|rectangle|`
    + String.raw`frame|folder|package)`
    + String.raw`\s+(?:"([^"]+)"|(\w+))`
    + String.raw`(?:\s+as\s+(\w+))?`,
  "i",
);

/** C4-DSL macros. Group 1 is the macro name, group 2 is the alias arg. */
const C4_REGEX = new RegExp(
  String.raw`^\s*(Person|Person_Ext|System|System_Ext|SystemDb|`
    + String.raw`Container|ContainerDb|ContainerQueue|Component|Component_Ext|`
    + String.raw`Boundary|Enterprise_Boundary|System_Boundary|Container_Boundary)`
    + String.raw`\s*\(\s*(\w+)`,
);

/** `[Browser]` style inline component. */
const BRACKET_REGEX = /\[([A-Za-z][\w \-./]*)\]/g;

/** `[*]` is the state-diagram pseudostate; never a real symbol. */
const PSEUDOSTATE = /^\s*\[\s*\*\s*\]/;

/** Title directive — used as the file-node docstring. */
const TITLE_REGEX = /^\s*title\s+(.+)/i;

/** Class-style relationship: `Foo --> Bar`, `Foo o-- Bar`, `Foo ..> Bar`, … */
const RELATION_REGEX = /^\s*(\w+)\s*([<\-.|>*o]+)\s*(\w+)/;

export class PlantUmlExtractor implements LanguageExtractor {
  readonly languageId = "plantuml";
  readonly extensions = [".puml", ".plantuml"];
  readonly wasmFile = undefined;

  extract(_tree: SyntaxTree | null, sourceCode: string, filePath: string): FileExtraction {
    const symbols: SymbolNode[] = [];
    const references: SymbolReference[] = [];
    const lines = sourceCode.split("\n");
    const moduleName = this.filePathToModuleName(filePath);
    const fileName = posixBasename(filePath);

    const fileNode: FileNodeDeclaration = {
      kind: "diagram",
      label: fileName,
      docstring: this.extractPumlTitle(lines),
      tags: ["plantuml"],
    };

    // De-duplicate per canonical name — PlantUML lets you declare the same
    // node twice (e.g. once explicitly and once via shorthand) without
    // changing semantics, but the graph layer expects unique symbols.
    const seen = new Set<string>();
    const pushDecl = (decl: Decl, lineIdx: number, displayLabel?: string): void => {
      if (seen.has(decl.name)) return;
      seen.add(decl.name);
      symbols.push({
        name: decl.name,
        qualifiedName: `${moduleName}.${decl.name}`,
        kind: decl.kind,
        decorators: [decl.decorator],
        docstring: displayLabel,
        startLine: lineIdx + 1,
        endLine: lineIdx + 1,
        parent: fileName,
      });
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      if (PSEUDOSTATE.test(line)) {
        // `[*] --> Draft` only contributes a transition; we skip the LHS
        // pseudostate but still let the relationship regex below run on the
        // remainder so the transition gets recorded.
      }

      const declMatch = line.match(DECL_REGEX);
      if (declMatch) {
        const keyword = declMatch[1]!.toLowerCase().replace(/\s+/g, " ");
        const quoted = declMatch[2];
        const bare = declMatch[3];
        const alias = declMatch[4];
        const canonicalName = alias ?? bare ?? this.sanitiseDisplay(quoted ?? "");

        if (canonicalName) {
          const decl: Decl = {
            kind: this.kindFor(keyword),
            decorator: this.decoratorFor(keyword),
            name: canonicalName,
          };
          pushDecl(decl, i, quoted ? quoted : undefined);
        }
      } else {
        const c4Match = line.match(C4_REGEX);
        if (c4Match) {
          const macro = c4Match[1]!;
          const alias = c4Match[2]!;
          pushDecl(
            {
              kind: "component",
              decorator: `c4_${macro.toLowerCase()}`,
              name: alias,
            },
            i,
          );
        }
      }

      // Bracket shorthand: `[Browser]`, `[API Gateway]`. Several may appear
      // on a single line. We deliberately strip `[*]` upstream by relying
      // on the regex character class (no `*`).
      let bracketMatch: RegExpExecArray | null;
      BRACKET_REGEX.lastIndex = 0;
      while ((bracketMatch = BRACKET_REGEX.exec(line)) !== null) {
        const raw = bracketMatch[1]!.trim();
        if (!raw || raw === "*") continue;
        const canonical = this.sanitiseDisplay(raw);
        if (!canonical) continue;
        pushDecl(
          {
            kind: "component",
            decorator: "bracket",
            name: canonical,
          },
          i,
          raw === canonical ? undefined : raw,
        );
      }

      const relMatch = line.match(RELATION_REGEX);
      if (relMatch) {
        const from = relMatch[1]!;
        const to = relMatch[3]!;
        if (from !== to && /^\w+$/.test(from) && /^\w+$/.test(to)) {
          references.push({
            name: to,
            fromSymbol: `${moduleName}.${from}`,
            kind: "extends",
            line: i + 1,
          });
        }
      }
    }

    return { filePath, language: "diagram", fileNode, symbols, imports: [], references };
  }

  resolveImportPath(_importModule: string, _currentFilePath: string): string[] {
    return [];
  }

  private kindFor(keyword: string): Decl["kind"] {
    if (keyword === "interface") return "interface";
    return "component";
  }

  private decoratorFor(keyword: string): string {
    if (keyword === "abstract" || keyword === "abstract class") {
      return "abstract_class";
    }
    if (CLASS_KEYWORDS.has(keyword)) return keyword;
    if (COMPONENT_KEYWORDS.has(keyword)) return keyword;
    return keyword;
  }

  /**
   * Reduce a quoted PlantUML display label to a graph-friendly identifier
   * by collapsing whitespace, stripping non-`[\w]` characters, and ensuring
   * the result starts with a non-digit so it can be used as a qualified
   * name segment.
   */
  private sanitiseDisplay(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    const ascii = trimmed.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_");
    if (!ascii) return "";
    return /^[A-Za-z_]/.test(ascii) ? ascii : `_${ascii}`;
  }

  private extractPumlTitle(lines: string[]): string | undefined {
    for (const line of lines) {
      const titleMatch = line.match(TITLE_REGEX);
      if (titleMatch) return titleMatch[1]!.trim();
    }
    return undefined;
  }

  private filePathToModuleName(filePath: string): string {
    const normalized = toPosix(filePath);
    return normalized.replace(/\.[^.]+$/, "").replace(/\//g, ".");
  }
}
