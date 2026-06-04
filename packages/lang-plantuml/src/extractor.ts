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

/**
 * Single-line metadata directives. Their bodies are used as fallbacks for
 * the file-node docstring when no `title` is present, in the precedence
 * order: `title` > `caption` > `header` > `footer`.
 */
const TITLE_REGEX = /^\s*title\s+(.+)/i;
const CAPTION_REGEX = /^\s*caption\s+(.+)/i;
const HEADER_INLINE_REGEX = /^\s*(?:center|left|right)?\s*header\s+(.+)/i;
const FOOTER_INLINE_REGEX = /^\s*(?:center|left|right)?\s*footer\s+(.+)/i;
/** Multi-line block openers. The block is terminated by `end<directive>`. */
const HEADER_BLOCK_OPEN = /^\s*(?:center|left|right)?\s*header\s*$/i;
const FOOTER_BLOCK_OPEN = /^\s*(?:center|left|right)?\s*footer\s*$/i;
const HEADER_BLOCK_CLOSE = /^\s*endheader\s*$/i;
const FOOTER_BLOCK_CLOSE = /^\s*endfooter\s*$/i;

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

    const metadata = this.extractMetadata(lines);

    const fileNode: FileNodeDeclaration = {
      kind: "diagram",
      label: fileName,
      docstring: metadata.title ?? metadata.caption ?? metadata.header ?? metadata.footer,
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

    /**
     * Bare identifiers that appear as transition endpoints but have no
     * matching explicit declaration. Resolved after the main loop so that
     * a state declared LATER in the file (`state X #green`) still wins
     * over an earlier transition mention.
     */
    const transitionCandidates: Array<{ name: string; line: number }> = [];

    // Track block scope for multi-line skip directives so we don't try to
    // parse the body as PlantUML statements.
    let inBlock: "header" | "footer" | "note" | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      if (inBlock === "header") {
        if (HEADER_BLOCK_CLOSE.test(line)) inBlock = null;
        continue;
      }
      if (inBlock === "footer") {
        if (FOOTER_BLOCK_CLOSE.test(line)) inBlock = null;
        continue;
      }
      if (HEADER_BLOCK_OPEN.test(line)) {
        inBlock = "header";
        continue;
      }
      if (FOOTER_BLOCK_OPEN.test(line)) {
        inBlock = "footer";
        continue;
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
          // Defer implicit promotion: the endpoint may be declared later
          // in the file, in which case the explicit declaration wins.
          if (/^[A-Za-z_]/.test(from)) {
            transitionCandidates.push({ name: from, line: i + 1 });
          }
          if (/^[A-Za-z_]/.test(to)) {
            transitionCandidates.push({ name: to, line: i + 1 });
          }
        }
      }
    }

    // Promote any transition endpoint that never received an explicit
    // declaration anywhere else in the file. This covers state diagrams
    // written purely as `[*] --> Draft` / `Draft --> Submitted` chains
    // without any standalone `state X` lines, which used to produce
    // zero symbols.
    for (const { name, line } of transitionCandidates) {
      if (seen.has(name)) continue;
      seen.add(name);
      symbols.push({
        name,
        qualifiedName: `${moduleName}.${name}`,
        kind: "component",
        decorators: ["state", "implicit"],
        startLine: line,
        endLine: line,
        parent: fileName,
      });
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

  /**
   * Walk the file once and pull out every metadata directive PlantUML
   * supports for prose annotations (title / caption / header / footer).
   * Both single-line forms (`title Foo`) and the multi-line block forms
   * (`header\n   Foo\nendheader`) are recognised. The first occurrence of
   * each kind wins; the precedence at the call site is `title > caption
   * > header > footer` for the file docstring.
   */
  private extractMetadata(lines: string[]): {
    title?: string;
    caption?: string;
    header?: string;
    footer?: string;
  } {
    const meta: { title?: string; caption?: string; header?: string; footer?: string } = {};
    let blockKind: "header" | "footer" | null = null;
    const blockBuffer: string[] = [];

    const flushBlock = (): void => {
      if (!blockKind) return;
      const value = blockBuffer.join(" ").replace(/\s+/g, " ").trim();
      if (value && !meta[blockKind]) meta[blockKind] = value;
      blockKind = null;
      blockBuffer.length = 0;
    };

    for (const rawLine of lines) {
      const line = rawLine;

      if (blockKind) {
        if (
          (blockKind === "header" && HEADER_BLOCK_CLOSE.test(line))
          || (blockKind === "footer" && FOOTER_BLOCK_CLOSE.test(line))
        ) {
          flushBlock();
          continue;
        }
        const trimmed = line.trim();
        if (trimmed) blockBuffer.push(trimmed);
        continue;
      }

      const titleMatch = line.match(TITLE_REGEX);
      if (titleMatch && !meta.title) {
        meta.title = titleMatch[1]!.trim();
        continue;
      }
      const captionMatch = line.match(CAPTION_REGEX);
      if (captionMatch && !meta.caption) {
        meta.caption = captionMatch[1]!.trim();
        continue;
      }
      const headerInlineMatch = line.match(HEADER_INLINE_REGEX);
      if (headerInlineMatch && !meta.header) {
        meta.header = headerInlineMatch[1]!.trim();
        continue;
      }
      const footerInlineMatch = line.match(FOOTER_INLINE_REGEX);
      if (footerInlineMatch && !meta.footer) {
        meta.footer = footerInlineMatch[1]!.trim();
        continue;
      }
      if (HEADER_BLOCK_OPEN.test(line) && !meta.header) {
        blockKind = "header";
        continue;
      }
      if (FOOTER_BLOCK_OPEN.test(line) && !meta.footer) {
        blockKind = "footer";
        continue;
      }
    }
    return meta;
  }

  private filePathToModuleName(filePath: string): string {
    const normalized = toPosix(filePath);
    return normalized.replace(/\.[^.]+$/, "").replace(/\//g, ".");
  }
}
