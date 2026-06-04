/**
 * SVG extractor.
 *
 * Regex-based parser. Extracts user-visible text from `<text>`, `<title>`,
 * `<desc>` elements and `aria-label` attributes, including multi-line
 * bodies and `<tspan>` children. Each unique label becomes a `section`
 * symbol on the file node, capped at 20 per file.
 */
import type {
  LanguageExtractor,
  SyntaxTree,
  FileExtraction,
  FileNodeDeclaration,
  SymbolNode,
} from "reponova";

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function posixBasename(p: string): string {
  const normalized = toPosix(p);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}

/**
 * Block-element bodies. Captures the tag name in group 1 and the raw inner
 * content in group 2. The non-greedy `[\s\S]*?` body lets us match across
 * newlines and through nested children (`<tspan>`, `<a>`, …); we strip the
 * inner tags afterwards via {@link normaliseTextBody}.
 */
const TEXT_BLOCK_REGEX = /<(text|title|desc)\b[^>]*>([\s\S]*?)<\/\1>/g;

/**
 * `aria-label="…"` attributes anywhere in the document. Used to extract
 * accessibility labels from SVGs that delegate visible text to ARIA hints
 * (e.g. icon libraries that paint glyphs with `<path>` only).
 */
const ARIA_LABEL_REGEX = /\baria-label\s*=\s*"([^"]+)"/g;

const ENTITY_TABLE: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z]+));/g, (whole, dec, hex, named) => {
    if (dec) return String.fromCodePoint(Number.parseInt(dec, 10));
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (named && ENTITY_TABLE[named.toLowerCase()]) return ENTITY_TABLE[named.toLowerCase()]!;
    return whole;
  });
}

/**
 * Take a raw `<text>` / `<title>` / `<desc>` body and turn it into a single
 * normalised line of human-readable text. Strips inner tags (so a nested
 * `<tspan>Line 1</tspan><tspan>Line 2</tspan>` collapses to `"Line 1 Line
 * 2"`), decodes XML entities, and collapses whitespace.
 */
function normaliseTextBody(body: string): string {
  return decodeEntities(body.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function isAcceptableLabel(text: string): boolean {
  if (text.length < 3 || text.length > 200) return false;
  if (/^\d+(?:[.,]\d+)?$/.test(text)) return false;
  return true;
}

export class SvgExtractor implements LanguageExtractor {
  readonly languageId = "svg";
  readonly extensions = [".svg"];
  readonly wasmFile = undefined;

  extract(_tree: SyntaxTree | null, sourceCode: string, filePath: string): FileExtraction {
    const symbols: SymbolNode[] = [];
    const fileName = posixBasename(filePath);
    const moduleName = this.filePathToModuleName(filePath);
    const sectionCounts = new Map<string, number>();

    const fileNode: FileNodeDeclaration = {
      kind: "diagram",
      label: fileName,
      docstring: this.extractSvgTitle(sourceCode),
      tags: ["svg"],
    };

    // Collect candidate labels in document order with their provenance, so
    // we can deduplicate while preserving the source-of-discovery decorator
    // for downstream consumers (svg_text / svg_title / svg_desc /
    // svg_aria_label).
    const candidates: Array<{ text: string; source: string }> = [];

    let match: RegExpExecArray | null;
    while ((match = TEXT_BLOCK_REGEX.exec(sourceCode)) !== null) {
      const tag = match[1]!.toLowerCase();
      const body = normaliseTextBody(match[2]!);
      if (!isAcceptableLabel(body)) continue;
      const source =
        tag === "text" ? "svg_text" : tag === "title" ? "svg_title" : "svg_desc";
      candidates.push({ text: body, source });
    }

    while ((match = ARIA_LABEL_REGEX.exec(sourceCode)) !== null) {
      const body = decodeEntities(match[1]!).replace(/\s+/g, " ").trim();
      if (!isAcceptableLabel(body)) continue;
      candidates.push({ text: body, source: "svg_aria_label" });
    }

    const seen = new Set<string>();
    let cap = 20;
    for (const candidate of candidates) {
      if (cap <= 0) break;
      const key = candidate.text;
      if (seen.has(key)) continue;
      seen.add(key);

      const sectionName = key
        .replace(/[^a-zA-Z0-9_\s-]/g, "")
        .replace(/\s+/g, "_")
        .slice(0, 60);
      if (sectionName.length < 2) continue;

      const count = (sectionCounts.get(sectionName) ?? 0) + 1;
      sectionCounts.set(sectionName, count);
      const uniqueSectionName = count === 1 ? sectionName : `${sectionName}_${count}`;

      symbols.push({
        name: sectionName,
        qualifiedName: `${moduleName}.${uniqueSectionName}`,
        kind: "section",
        decorators: [candidate.source],
        docstring: candidate.text,
        startLine: 1,
        endLine: 1,
        parent: fileName,
      });
      cap--;
    }

    return { filePath, language: "diagram", fileNode, symbols, imports: [], references: [] };
  }

  resolveImportPath(_importModule: string, _currentFilePath: string): string[] {
    return [];
  }

  /**
   * The first `<title>` element in the document is treated as the SVG file
   * docstring (typically the diagram title). The body may span multiple
   * lines or contain entities; we run it through the same normaliser as
   * the symbol extractor so docstring and matching symbol stay aligned.
   */
  private extractSvgTitle(source: string): string | undefined {
    const titleMatch = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/);
    if (!titleMatch) return undefined;
    const text = normaliseTextBody(titleMatch[1]!);
    return text.length > 0 ? text : undefined;
  }

  private filePathToModuleName(filePath: string): string {
    const normalized = toPosix(filePath);
    return normalized.replace(/\.[^.]+$/, "").replace(/\//g, ".");
  }
}
