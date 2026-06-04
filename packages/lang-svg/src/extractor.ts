/**
 * SVG extractor.
 *
 * Extracts text elements from SVG files to create diagram nodes in the graph.
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

    // Extract meaningful text elements from SVG
    const textRegex = /<text[^>]*>([^<]+)<\/text>/g;
    const texts: string[] = [];
    let match;
    while ((match = textRegex.exec(sourceCode)) !== null) {
      const text = match[1]!.trim();
      if (text.length >= 3 && text.length <= 80 && !/^\d+$/.test(text)) {
        texts.push(text);
      }
    }

    // Create section nodes from unique meaningful text elements (top 20)
    const uniqueTexts = [...new Set(texts)].slice(0, 20);
    for (let i = 0; i < uniqueTexts.length; i++) {
      const text = uniqueTexts[i]!;
      const sectionName = text.replace(/[^a-zA-Z0-9_\s-]/g, "").replace(/\s+/g, "_").slice(0, 60);
      if (sectionName.length < 2) continue;
      const count = (sectionCounts.get(sectionName) ?? 0) + 1;
      sectionCounts.set(sectionName, count);
      const uniqueSectionName = count === 1 ? sectionName : `${sectionName}_${count}`;

      symbols.push({
        name: sectionName,
        qualifiedName: `${moduleName}.${uniqueSectionName}`,
        kind: "section",
        decorators: ["svg_text"],
        docstring: text,
        startLine: 1,
        endLine: 1,
        parent: fileName,
      });
    }

    return { filePath, language: "diagram", fileNode, symbols, imports: [], references: [] };
  }

  resolveImportPath(_importModule: string, _currentFilePath: string): string[] {
    return [];
  }

  private extractSvgTitle(source: string): string | undefined {
    const titleMatch = source.match(/<title>([^<]+)<\/title>/);
    return titleMatch?.[1]?.trim();
  }

  private filePathToModuleName(filePath: string): string {
    const normalized = toPosix(filePath);
    return normalized.replace(/\.[^.]+$/, "").replace(/\//g, ".");
  }
}
