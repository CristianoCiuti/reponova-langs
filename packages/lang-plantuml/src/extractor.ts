/**
 * PlantUML extractor.
 *
 * Parses PlantUML files (.puml, .plantuml) to extract class/interface names
 * and relationships using regex.
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

    const classRegex = /^\s*(class|interface|enum|abstract class|abstract)\s+["']?(\w+)["']?/;
    const relationRegex = /^\s*(\w+)\s*([<\-.|>*o]+)\s*(\w+)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const classMatch = line.match(classRegex);

      if (classMatch) {
        const kind = classMatch[1]!;
        const name = classMatch[2]!;

        symbols.push({
          name,
          qualifiedName: `${moduleName}.${name}`,
          kind: kind.includes("interface") ? "interface" : "component",
          decorators: [kind.replace("abstract ", "abstract_")],
          startLine: i + 1,
          endLine: i + 1,
          parent: fileName,
        });
      }

      const relMatch = line.match(relationRegex);
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

  private extractPumlTitle(lines: string[]): string | undefined {
    for (const line of lines) {
      const titleMatch = line.match(/^\s*title\s+(.+)/i);
      if (titleMatch) return titleMatch[1]!.trim();
    }
    return undefined;
  }

  private filePathToModuleName(filePath: string): string {
    const normalized = toPosix(filePath);
    return normalized.replace(/\.[^.]+$/, "").replace(/\//g, ".");
  }
}
