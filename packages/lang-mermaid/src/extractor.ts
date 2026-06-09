/**
 * Mermaid extractor.
 *
 * Parses `.mmd` / `.mermaid` files line-by-line using a small state machine.
 * The first non-blank, non-comment, non-frontmatter line declares the
 * diagram type; subsequent lines are dispatched to per-family handlers.
 *
 * Supported diagram families (canonical name in parentheses):
 *
 *   - flowchart / graph         ("flowchart") — boxes, edges, subgraphs
 *   - sequenceDiagram           ("sequence")  — actors, participants, messages
 *   - classDiagram / -v2        ("class")     — classes, methods, fields, heritage
 *   - stateDiagram / -v2        ("state")     — states, transitions, [*] pseudo
 *   - erDiagram                 ("er")        — entities, attributes, relations
 *   - gantt                     ("gantt")     — sections + tasks
 *   - journey                   ("journey")   — sections + tasks with actor lists
 *   - gitGraph                  ("gitGraph")  — commits + branches
 *   - pie                       ("pie")       — slices
 *   - mindmap                   ("mindmap")   — indented hierarchy
 *   - timeline                  ("timeline")  — sections + events
 *   - C4Context / Container / Component / Deployment / Dynamic ("c4") —
 *                                              Person/System/Container/… macros
 *   - requirementDiagram        ("requirement") — requirement / element blocks
 *   - zenuml                    ("zenuml")    — @Annotator participants + arrows
 *
 * All other diagram types (architecture-beta, block-beta, xychart-beta,
 * quadrantChart, radar-beta, sankey-beta, packet-beta, kanban, treemap,
 * venn-beta, ishikawa, sankey, …) still produce a valid `fileNode` with the
 * diagram type tagged but emit no symbols by design; they fall back to the
 * "unknown" branch and round-trip cleanly.
 *
 * The fileNode tags always include `"mermaid"` and the diagram-family name
 * so consumers can filter by family without re-parsing the source.
 */

import type {
  FileExtraction,
  FileNodeDeclaration,
  LanguageExtractor,
  SymbolNode,
  SymbolReference,
  SyntaxTree,
} from "reponova";

type DiagramFamily =
  | "flowchart"
  | "sequence"
  | "class"
  | "state"
  | "er"
  | "gantt"
  | "journey"
  | "gitGraph"
  | "pie"
  | "mindmap"
  | "timeline"
  | "c4"
  | "requirement"
  | "zenuml"
  | "unknown";

interface ParseContext {
  readonly lines: string[];
  readonly moduleName: string;
  readonly fileName: string;
  readonly symbols: SymbolNode[];
  readonly references: SymbolReference[];
  readonly seen: Set<string>;
}

const C4_MACROS = new Set([
  "Person",
  "Person_Ext",
  "System",
  "System_Ext",
  "SystemDb",
  "SystemDb_Ext",
  "SystemQueue",
  "SystemQueue_Ext",
  "Container",
  "Container_Ext",
  "ContainerDb",
  "ContainerDb_Ext",
  "ContainerQueue",
  "ContainerQueue_Ext",
  "Component",
  "Component_Ext",
  "ComponentDb",
  "ComponentDb_Ext",
  "ComponentQueue",
  "ComponentQueue_Ext",
  "Boundary",
  "Enterprise_Boundary",
  "System_Boundary",
  "Container_Boundary",
  "Node",
  "Node_L",
  "Node_R",
  "Deployment_Node",
  "Deployment_Node_L",
  "Deployment_Node_R",
]);

const C4_REL_MACROS = new Set([
  "Rel",
  "BiRel",
  "Rel_U",
  "Rel_D",
  "Rel_L",
  "Rel_R",
  "Rel_Back",
  "Rel_Neighbor",
]);

const FLOWCHART_HEADER = /^(?:flowchart|graph)\b/i;
const SEQUENCE_HEADER = /^sequenceDiagram\b/i;
const CLASS_HEADER = /^classDiagram(?:-v2)?\b/i;
const STATE_HEADER = /^stateDiagram(?:-v2)?\b/i;
const ER_HEADER = /^erDiagram\b/i;
const GANTT_HEADER = /^gantt\b/i;
const JOURNEY_HEADER = /^journey\b/i;
const GIT_HEADER = /^gitGraph\b/i;
const PIE_HEADER = /^pie\b/i;
const MINDMAP_HEADER = /^mindmap\b/i;
const TIMELINE_HEADER = /^timeline\b/i;
const C4_HEADER = /^C4(?:Context|Container|Component|Deployment|Dynamic)\b/i;
const REQUIREMENT_HEADER = /^requirementDiagram\b/i;
const ZENUML_HEADER = /^zenuml\b/i;

const TITLE_DIRECTIVE = /^\s*title\s+(.+?)\s*$/i;
const FRONTMATTER_TITLE = /^\s*title:\s*(.+?)\s*$/i;

const COMMENT = /^\s*%%(?!\s*\{)/;
const INIT_DIRECTIVE = /^\s*%%\{[\s\S]*?\}%%/;

export class MermaidExtractor implements LanguageExtractor {
  readonly languageId = "mermaid";
  readonly extensions = [".mmd", ".mermaid"];
  readonly wasmFile = undefined;

  extract(_tree: SyntaxTree | null, sourceCode: string, filePath: string): FileExtraction {
    const fileName = posixBasename(filePath);
    const moduleName = filePathToModuleName(filePath);

    const stripped = stripInitDirective(sourceCode);
    const { body, frontmatterTitle } = stripFrontmatter(stripped);

    const { family, headerLine, declarationLine } = detectFamily(body);
    const lines = body.split("\n");
    const inlineTitle = findInlineTitle(lines, headerLine);

    const symbols: SymbolNode[] = [];
    const references: SymbolReference[] = [];
    const seen = new Set<string>();

    const ctx: ParseContext = {
      lines,
      moduleName,
      fileName,
      symbols,
      references,
      seen,
    };

    switch (family) {
      case "flowchart":
        parseFlowchart(ctx, declarationLine);
        break;
      case "sequence":
        parseSequence(ctx, declarationLine);
        break;
      case "class":
        parseClass(ctx, declarationLine);
        break;
      case "state":
        parseState(ctx, declarationLine);
        break;
      case "er":
        parseEr(ctx, declarationLine);
        break;
      case "gantt":
        parseGantt(ctx, declarationLine);
        break;
      case "journey":
        parseJourney(ctx, declarationLine);
        break;
      case "gitGraph":
        parseGitGraph(ctx, declarationLine);
        break;
      case "pie":
        parsePie(ctx, declarationLine);
        break;
      case "mindmap":
        parseMindmap(ctx, declarationLine);
        break;
      case "timeline":
        parseTimeline(ctx, declarationLine);
        break;
      case "c4":
        parseC4(ctx, declarationLine);
        break;
      case "requirement":
        parseRequirement(ctx, declarationLine);
        break;
      case "zenuml":
        parseZenuml(ctx, declarationLine);
        break;
      case "unknown":
        break;
    }

    const fileNode: FileNodeDeclaration = {
      kind: "diagram",
      label: fileName,
      docstring: frontmatterTitle ?? inlineTitle,
      tags: ["mermaid", family],
    };

    return {
      filePath,
      language: "diagram",
      fileNode,
      symbols,
      imports: [],
      references,
    };
  }

  resolveImportPath(_importModule: string, _currentFilePath: string): string[] {
    return [];
  }
}

function pushSymbol(
  ctx: ParseContext,
  name: string,
  opts: {
    kind: string;
    decorator: string;
    line: number;
    docstring?: string;
    parent?: string;
    extraDecorators?: string[];
  },
): SymbolNode | undefined {
  const canonical = canonicaliseName(name);
  if (!canonical) return undefined;
  const key = opts.parent ? `${opts.parent}.${canonical}` : canonical;
  if (ctx.seen.has(key)) return undefined;
  ctx.seen.add(key);
  const sym: SymbolNode = {
    name: canonical,
    qualifiedName: `${ctx.moduleName}.${key}`,
    kind: opts.kind,
    decorators: opts.extraDecorators
      ? [opts.decorator, ...opts.extraDecorators]
      : [opts.decorator],
    docstring: opts.docstring,
    startLine: opts.line,
    endLine: opts.line,
    parent: opts.parent ?? ctx.fileName,
  };
  ctx.symbols.push(sym);
  return sym;
}

function pushReference(
  ctx: ParseContext,
  from: string,
  to: string,
  line: number,
  kind: SymbolReference["kind"] = "extends",
): void {
  const f = canonicaliseName(from);
  const t = canonicaliseName(to);
  if (!f || !t || f === t) return;
  ctx.references.push({
    name: t,
    fromSymbol: `${ctx.moduleName}.${f}`,
    kind,
    line,
  });
}

function canonicaliseName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed === "*" || trimmed === "[*]") return "";
  if (/^[A-Za-z_][\w-]*$/.test(trimmed)) return trimmed;
  const ascii = trimmed.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_");
  if (!ascii) return "";
  return /^[A-Za-z_]/.test(ascii) ? ascii : `_${ascii}`;
}

function stripInitDirective(src: string): string {
  return src.replace(INIT_DIRECTIVE, "");
}

function stripFrontmatter(src: string): { body: string; frontmatterTitle?: string } {
  if (!src.startsWith("---")) return { body: src };
  const lines = src.split("\n");
  if (lines[0]?.trim() !== "---") return { body: src };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return { body: src };
  let title: string | undefined;
  for (let i = 1; i < end; i++) {
    const m = lines[i]!.match(FRONTMATTER_TITLE);
    if (m) {
      title = stripQuotes(m[1]!.trim());
      break;
    }
  }
  return {
    body: lines.slice(end + 1).join("\n"),
    frontmatterTitle: title,
  };
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

function detectFamily(body: string): {
  family: DiagramFamily;
  headerLine: number;
  declarationLine: number;
} {
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw.trim()) continue;
    if (COMMENT.test(raw)) continue;
    if (FLOWCHART_HEADER.test(raw)) return { family: "flowchart", headerLine: i, declarationLine: i };
    if (SEQUENCE_HEADER.test(raw)) return { family: "sequence", headerLine: i, declarationLine: i };
    if (CLASS_HEADER.test(raw)) return { family: "class", headerLine: i, declarationLine: i };
    if (STATE_HEADER.test(raw)) return { family: "state", headerLine: i, declarationLine: i };
    if (ER_HEADER.test(raw)) return { family: "er", headerLine: i, declarationLine: i };
    if (GANTT_HEADER.test(raw)) return { family: "gantt", headerLine: i, declarationLine: i };
    if (JOURNEY_HEADER.test(raw)) return { family: "journey", headerLine: i, declarationLine: i };
    if (GIT_HEADER.test(raw)) return { family: "gitGraph", headerLine: i, declarationLine: i };
    if (PIE_HEADER.test(raw)) return { family: "pie", headerLine: i, declarationLine: i };
    if (MINDMAP_HEADER.test(raw)) return { family: "mindmap", headerLine: i, declarationLine: i };
    if (TIMELINE_HEADER.test(raw)) return { family: "timeline", headerLine: i, declarationLine: i };
    if (C4_HEADER.test(raw)) return { family: "c4", headerLine: i, declarationLine: i };
    if (REQUIREMENT_HEADER.test(raw)) return { family: "requirement", headerLine: i, declarationLine: i };
    if (ZENUML_HEADER.test(raw)) return { family: "zenuml", headerLine: i, declarationLine: i };
    return { family: "unknown", headerLine: i, declarationLine: i };
  }
  return { family: "unknown", headerLine: -1, declarationLine: -1 };
}

function findInlineTitle(lines: string[], headerLine: number): string | undefined {
  const startInclusive = headerLine >= 0 ? headerLine : 0;
  for (let i = startInclusive; i < lines.length; i++) {
    const m = lines[i]!.match(TITLE_DIRECTIVE);
    if (m) return stripQuotes(m[1]!.trim());
  }
  return undefined;
}

// ── flowchart ────────────────────────────────────────────────────────────────
// Recognises both `graph TD` and `flowchart LR` headers. The body is a mix of
// node declarations (with optional shapes) and edges. Subgraphs nest names but
// the symbol hierarchy stays flat — the parent attribute records the subgraph
// for filtering, not a deep tree.

const SUBGRAPH_OPEN = /^\s*subgraph\s+(?:"([^"]+)"|([\w-]+))(?:\s*\[([^\]]+)\])?/;
const SUBGRAPH_CLOSE = /^\s*end\s*$/i;
const NODE_DECL = /([A-Za-z_][\w-]*)(\(\(|\[\[|\[\(|\[\/|\[\\|\(\[|\{\{|\[|\(|\{|>)([^)\]}]*?)(\)\)|\]\]|\)\]|\/\]|\\\]|\]\)|\}\}|\]|\)|\})/g;
// Edge body starts with `-`, `=`, `.` or `<` and ends with `-`, `=`, `.`, `>`,
// `x`, `o`, or `*`. The inner characters allow any combination of the line
// markers / arrowheads plus the rare `o` / `x` / `*` endpoint markers. We
// strip inline node shapes from the line BEFORE applying this regex so that
// `A([label]) --> B` is recognised the same as `A --> B`.
const EDGE_REGEX = /([A-Za-z_][\w-]*)\s*([-=.<][-=.<>xo*]*[-=.>xo*])\s*(?:\|[^|]*\|\s*)?([A-Za-z_][\w-]*)/g;
const CLICK_REGEX = /^\s*click\s+([A-Za-z_][\w-]*)\b/;
const STYLE_LINE = /^\s*(?:style|classDef|class|linkStyle)\s+/;

function parseFlowchart(ctx: ParseContext, declarationLine: number): void {
  const subgraphStack: string[] = [];
  const edgeEndpoints: Array<{ name: string; line: number; parent?: string }> = [];

  for (let i = declarationLine + 1; i < ctx.lines.length; i++) {
    const raw = ctx.lines[i]!;
    if (!raw.trim() || COMMENT.test(raw)) continue;

    const sgOpen = raw.match(SUBGRAPH_OPEN);
    if (sgOpen) {
      const quoted = sgOpen[1];
      const bare = sgOpen[2];
      const label = sgOpen[3];
      const sgName = bare ?? canonicaliseName(quoted ?? label ?? "subgraph");
      if (sgName) {
        pushSymbol(ctx, sgName, {
          kind: "module",
          decorator: "subgraph",
          line: i + 1,
          docstring: label ?? quoted,
        });
        subgraphStack.push(sgName);
      }
      continue;
    }
    if (SUBGRAPH_CLOSE.test(raw)) {
      subgraphStack.pop();
      continue;
    }
    if (STYLE_LINE.test(raw)) continue;

    const parent = subgraphStack[subgraphStack.length - 1];

    const clickMatch = raw.match(CLICK_REGEX);
    if (clickMatch) {
      pushSymbol(ctx, clickMatch[1]!, {
        kind: "component",
        decorator: "flowchart_node",
        line: i + 1,
        parent,
      });
      continue;
    }

    extractFlowchartNodes(ctx, raw, i + 1, parent);
    extractFlowchartEdges(ctx, raw, i + 1, edgeEndpoints, parent);
  }

  // Promote any edge endpoint that never received an explicit shape-bearing
  // declaration anywhere else in the file. Mermaid flowcharts often skip
  // the explicit-node line entirely when the node only carries the default
  // rectangle shape (e.g. `A --> B` with no separate `A` / `B` declarations).
  for (const ep of edgeEndpoints) {
    if (ctx.seen.has(ep.name)) continue;
    pushSymbol(ctx, ep.name, {
      kind: "component",
      decorator: "flowchart_node",
      line: ep.line,
      parent: ep.parent,
      extraDecorators: ["rectangle"],
    });
  }
}

function extractFlowchartNodes(
  ctx: ParseContext,
  line: string,
  lineNum: number,
  parent: string | undefined,
): void {
  NODE_DECL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NODE_DECL.exec(line)) !== null) {
    const id = m[1]!;
    const opener = m[2]!;
    const label = m[3]!;
    pushSymbol(ctx, id, {
      kind: "component",
      decorator: "flowchart_node",
      line: lineNum,
      docstring: label.trim() || undefined,
      parent,
      extraDecorators: [shapeDecorator(opener)],
    });
  }
}

function shapeDecorator(opener: string): string {
  switch (opener) {
    case "((":
      return "circle";
    case "{{":
      return "hexagon";
    case "{":
      return "diamond";
    case "(":
      return "rounded";
    case "[[":
      return "subroutine";
    case "[(":
      return "cylinder";
    case "([":
      return "stadium";
    case "[/":
      return "trapezoid";
    case "[\\":
      return "trapezoid_alt";
    case ">":
      return "asymmetric";
    default:
      return "rectangle";
  }
}

/**
 * Replace inline node shapes (`A[label]`, `B(label)`, `C{label}`, …) with
 * the bare identifier so the edge regex can match across them. Without
 * this step, `Start([…]) --> Login` never matches the edge pattern
 * because the shape sits between the source id and the arrow body.
 */
function stripFlowchartShapes(line: string): string {
  NODE_DECL.lastIndex = 0;
  return line.replace(NODE_DECL, "$1");
}

function extractFlowchartEdges(
  ctx: ParseContext,
  line: string,
  lineNum: number,
  endpoints: Array<{ name: string; line: number; parent?: string }>,
  parent: string | undefined,
): void {
  const stripped = stripFlowchartShapes(line);
  EDGE_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EDGE_REGEX.exec(stripped)) !== null) {
    const from = m[1]!;
    const to = m[3]!;
    pushReference(ctx, from, to, lineNum);
    endpoints.push({ name: from, line: lineNum, parent });
    endpoints.push({ name: to, line: lineNum, parent });
    // Step back by the length of `to` so that chained edges
    // (`A --> B --> C`) match all pairs.
    EDGE_REGEX.lastIndex = Math.max(0, EDGE_REGEX.lastIndex - to.length);
  }
}

// ── sequenceDiagram ──────────────────────────────────────────────────────────

const PARTICIPANT_DECL = /^\s*(participant|actor)\s+(?:"([^"]+)"|([\w-]+))(?:\s+as\s+([\w-]+))?/i;
const SEQUENCE_MESSAGE = /^\s*([\w-]+)\s*(?:-->>|->>|--?\s*[>x]\s*|-\)\s*|--\)\s*|-x\s*)\+?-?\s*([\w-]+)\s*:/;

function parseSequence(ctx: ParseContext, declarationLine: number): void {
  // Track which participants have been declared explicitly so that ad-hoc
  // identifiers on arrows are promoted to symbols only when no explicit
  // declaration exists.
  const messageEndpoints: Array<{ name: string; line: number }> = [];

  for (let i = declarationLine + 1; i < ctx.lines.length; i++) {
    const raw = ctx.lines[i]!;
    if (!raw.trim() || COMMENT.test(raw)) continue;
    if (/^\s*(loop|alt|opt|par|critical|else|end|rect|break|autonumber|Note|note|deactivate|activate)\b/.test(raw)) {
      continue;
    }
    const p = raw.match(PARTICIPANT_DECL);
    if (p) {
      const keyword = p[1]!.toLowerCase();
      const quoted = p[2];
      const bare = p[3];
      const alias = p[4];
      const canonical = alias ?? bare ?? canonicaliseName(quoted ?? "");
      if (canonical) {
        pushSymbol(ctx, canonical, {
          kind: "component",
          decorator: keyword,
          line: i + 1,
          docstring: quoted,
        });
      }
      continue;
    }
    const msg = raw.match(SEQUENCE_MESSAGE);
    if (msg) {
      const from = msg[1]!;
      const to = msg[2]!;
      messageEndpoints.push({ name: from, line: i + 1 });
      messageEndpoints.push({ name: to, line: i + 1 });
      pushReference(ctx, from, to, i + 1, "references");
    }
  }

  // Promote implicit endpoints (sequence diagrams often skip the explicit
  // participant declarations — every actor is inferred from the first
  // arrow it appears in).
  for (const ep of messageEndpoints) {
    if (ctx.seen.has(ep.name)) continue;
    pushSymbol(ctx, ep.name, {
      kind: "component",
      decorator: "participant",
      line: ep.line,
      extraDecorators: ["implicit"],
    });
  }
}

// ── classDiagram ─────────────────────────────────────────────────────────────

const CLASS_DECL = /^\s*class\s+([\w-]+)(?:\s*~[^~]+~)?(?:\s*\{)?/;
const CLASS_BLOCK_LINE = /^\s*([\w-]+)\s*:\s*(.+?)\s*$/;
const CLASS_RELATION = /^\s*([\w-]+)\s+("[^"]+"\s+)?(<\|--|--\|>|\*--|--\*|o--|--o|\.\.\|>|<\|\.\.|\.\.>|<\.\.|-->|<--|--|\.\.)\s+("[^"]+"\s+)?([\w-]+)(?:\s*:\s*(.+))?/;
const STEREOTYPE_LINE_DECLARED = /^\s*([\w-]+)\s*:\s*<<\s*([\w-]+)\s*>>/;
const STEREOTYPE_INLINE = /^\s*<<\s*([\w-]+)\s*>>\s*([\w-]+)?/;
const STEREOTYPE_BARE = /^\s*<<\s*([\w-]+)\s*>>\s*$/;
const DIRECTION = /^\s*direction\s+(LR|RL|TB|BT)\s*$/;

function parseClass(ctx: ParseContext, declarationLine: number): void {
  let openBlockFor: string | null = null;

  for (let i = declarationLine + 1; i < ctx.lines.length; i++) {
    const raw = ctx.lines[i]!;
    if (!raw.trim() || COMMENT.test(raw)) continue;
    if (DIRECTION.test(raw)) continue;

    if (openBlockFor) {
      if (/^\s*\}\s*$/.test(raw)) {
        openBlockFor = null;
        continue;
      }
      const stBare = raw.match(STEREOTYPE_BARE);
      if (stBare) {
        applyStereotype(ctx, openBlockFor, stBare[1]!.toLowerCase());
        continue;
      }
      const member = parseClassMember(raw);
      if (member) {
        pushSymbol(ctx, member.name, {
          kind: member.isMethod ? "method" : "variable",
          decorator: member.isMethod ? "method" : "field",
          line: i + 1,
          parent: openBlockFor,
          extraDecorators: member.visibility ? [member.visibility] : undefined,
        });
      }
      continue;
    }

    const decl = raw.match(CLASS_DECL);
    if (decl) {
      const name = decl[1]!;
      pushSymbol(ctx, name, {
        kind: "class",
        decorator: "class",
        line: i + 1,
      });
      if (raw.trimEnd().endsWith("{")) openBlockFor = name;
      continue;
    }

    const ste = raw.match(STEREOTYPE_LINE_DECLARED);
    if (ste) {
      ensureClass(ctx, ste[1]!, i + 1);
      applyStereotype(ctx, ste[1]!, ste[2]!.toLowerCase());
      continue;
    }
    const inline = raw.match(STEREOTYPE_INLINE);
    if (inline && inline[2]) {
      pushSymbol(ctx, inline[2]!, {
        kind: inline[1]!.toLowerCase() === "interface" ? "interface" : "class",
        decorator: inline[1]!.toLowerCase(),
        line: i + 1,
      });
      continue;
    }

    const rel = raw.match(CLASS_RELATION);
    if (rel) {
      const lhs = rel[1]!;
      const arrow = rel[3]!;
      const rhs = rel[5]!;
      ensureClass(ctx, lhs, i + 1);
      ensureClass(ctx, rhs, i + 1);
      // Arrows whose head is on the LEFT (`<--`, `<..`, `<|--`, `<|..`)
      // mean the child is on the right; swap so the edge always points
      // from "child" to "parent" in graph terms.
      const reversed = arrow.startsWith("<");
      const from = reversed ? rhs : lhs;
      const to = reversed ? lhs : rhs;
      const kind: SymbolReference["kind"] = isInheritance(arrow) ? "extends" : "references";
      pushReference(ctx, from, to, i + 1, kind);
      continue;
    }

    // Single-line member form: `Foo : +method()` or `Foo : +String name`.
    const single = raw.match(CLASS_BLOCK_LINE);
    if (single) {
      const owner = single[1]!;
      ensureClass(ctx, owner, i + 1);
      const member = parseClassMember(single[2]!);
      if (member) {
        pushSymbol(ctx, member.name, {
          kind: member.isMethod ? "method" : "variable",
          decorator: member.isMethod ? "method" : "field",
          line: i + 1,
          parent: owner,
          extraDecorators: member.visibility ? [member.visibility] : undefined,
        });
      }
    }
  }
}

function isInheritance(arrow: string): boolean {
  return arrow === "<|--" || arrow === "--|>" || arrow === "..|>" || arrow === "<|..";
}

function ensureClass(ctx: ParseContext, name: string, line: number): void {
  if (ctx.seen.has(canonicaliseName(name))) return;
  pushSymbol(ctx, name, { kind: "class", decorator: "class", line });
}

function applyStereotype(ctx: ParseContext, owner: string, stereotype: string): void {
  const canonical = canonicaliseName(owner);
  const existing = ctx.symbols.find((s) => s.name === canonical);
  if (!existing) return;
  if (!existing.decorators.includes(stereotype)) existing.decorators.push(stereotype);
  if (stereotype === "interface") existing.kind = "interface";
}

/**
 * Parse a single class-member line of one of the canonical Mermaid forms:
 *
 *   `+String name`                  → field, visibility +, name=name
 *   `+List~T~ items`                → field, name=items
 *   `+eat() void`                   → method, name=eat
 *   `+find(id: int) Entity`         → method, name=find
 *   `name`                          → field, visibility="", name=name
 */
function parseClassMember(
  raw: string,
): { name: string; visibility?: string; isMethod: boolean } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let rest = trimmed;
  let visibility: string | undefined;
  if (/^[+\-#~]/.test(rest)) {
    visibility = visibilityDecorator(rest[0]!);
    rest = rest.slice(1).trim();
  }
  // Method form: identifier followed by parentheses.
  const methodMatch = rest.match(/^([\w<>~]+)\s*\(/);
  if (methodMatch) {
    return { name: methodMatch[1]!, visibility, isMethod: true };
  }
  // Field form: optional Type, then identifier, optional `: trailing`.
  // The trailing identifier is the name we want.
  const fieldMatch = rest.match(/^(?:[\w~,<>:\s[\]]+\s)?(\w+)\s*(?::.*)?$/);
  if (fieldMatch) {
    return { name: fieldMatch[1]!, visibility, isMethod: false };
  }
  return null;
}

function visibilityDecorator(v: string): string | undefined {
  switch (v) {
    case "+":
      return "public";
    case "-":
      return "private";
    case "#":
      return "protected";
    case "~":
      return "package";
    default:
      return undefined;
  }
}

// ── stateDiagram ─────────────────────────────────────────────────────────────

const STATE_DECL = /^\s*state\s+(?:"([^"]+)"|([\w-]+))(?:\s+as\s+([\w-]+))?(?:\s*<<\s*([\w-]+)\s*>>)?(?:\s*\{)?/;
const STATE_TRANSITION = /^\s*(?:\[\*\]|([\w-]+))\s*-->\s*(?:\[\*\]|([\w-]+))(?:\s*:\s*(.+))?/;

function parseState(ctx: ParseContext, declarationLine: number): void {
  const transitionEndpoints: Array<{ name: string; line: number }> = [];

  for (let i = declarationLine + 1; i < ctx.lines.length; i++) {
    const raw = ctx.lines[i]!;
    if (!raw.trim() || COMMENT.test(raw)) continue;
    if (/^\s*\}\s*$/.test(raw)) continue;
    if (DIRECTION.test(raw)) continue;

    const decl = raw.match(STATE_DECL);
    if (decl) {
      const quoted = decl[1];
      const bare = decl[2];
      const alias = decl[3];
      const stereotype = decl[4];
      const canonical = alias ?? bare ?? canonicaliseName(quoted ?? "");
      if (canonical) {
        pushSymbol(ctx, canonical, {
          kind: "component",
          decorator: "state",
          line: i + 1,
          docstring: quoted,
          extraDecorators: stereotype ? [stereotype] : undefined,
        });
      }
      continue;
    }

    const tr = raw.match(STATE_TRANSITION);
    if (tr) {
      const from = tr[1];
      const to = tr[2];
      if (from && to) {
        transitionEndpoints.push({ name: from, line: i + 1 });
        transitionEndpoints.push({ name: to, line: i + 1 });
        pushReference(ctx, from, to, i + 1, "references");
      } else if (from && !to) {
        transitionEndpoints.push({ name: from, line: i + 1 });
      } else if (!from && to) {
        transitionEndpoints.push({ name: to, line: i + 1 });
      }
    }
  }

  // Promote transition endpoints that never received an explicit declaration.
  for (const ep of transitionEndpoints) {
    if (ctx.seen.has(canonicaliseName(ep.name))) continue;
    pushSymbol(ctx, ep.name, {
      kind: "component",
      decorator: "state",
      line: ep.line,
      extraDecorators: ["implicit"],
    });
  }
}

// ── erDiagram ────────────────────────────────────────────────────────────────

const ER_ENTITY_OPEN = /^\s*([\w-]+)\s*\{\s*$/;
const ER_ATTR = /^\s*([\w-]+)\s+([\w-]+)(?:\s+(PK|FK|UK))?/;
const ER_RELATION = /^\s*([\w-]+)\s+([|}{o.]+--[|}{o.]+)\s+([\w-]+)\s*:\s*(.+)/;

function parseEr(ctx: ParseContext, declarationLine: number): void {
  let openEntity: string | null = null;
  for (let i = declarationLine + 1; i < ctx.lines.length; i++) {
    const raw = ctx.lines[i]!;
    if (!raw.trim() || COMMENT.test(raw)) continue;

    if (openEntity) {
      if (/^\s*\}\s*$/.test(raw)) {
        openEntity = null;
        continue;
      }
      const a = raw.match(ER_ATTR);
      if (a) {
        const attrName = a[2]!;
        const constraint = a[3];
        pushSymbol(ctx, attrName, {
          kind: "variable",
          decorator: "er_attribute",
          line: i + 1,
          parent: openEntity,
          docstring: a[1],
          extraDecorators: constraint ? [constraint.toLowerCase()] : undefined,
        });
      }
      continue;
    }

    const open = raw.match(ER_ENTITY_OPEN);
    if (open) {
      const name = open[1]!;
      ensureErEntity(ctx, name, i + 1);
      openEntity = canonicaliseName(name);
      continue;
    }

    const rel = raw.match(ER_RELATION);
    if (rel) {
      const from = rel[1]!;
      const to = rel[3]!;
      const label = rel[4]?.trim();
      ensureErEntity(ctx, from, i + 1);
      ensureErEntity(ctx, to, i + 1);
      pushReference(ctx, from, to, i + 1, "references");
      if (label) {
        // Attach the relationship label as a docstring update on the from-entity
        // when none exists. This makes the relation human-readable in tools.
        const fromSym = ctx.symbols.find((s) => s.name === canonicaliseName(from));
        if (fromSym && !fromSym.docstring) fromSym.docstring = label;
      }
    }
  }
}

function ensureErEntity(ctx: ParseContext, name: string, line: number): void {
  if (ctx.seen.has(canonicaliseName(name))) return;
  pushSymbol(ctx, name, {
    kind: "class",
    decorator: "er_entity",
    line,
  });
}

// ── gantt ────────────────────────────────────────────────────────────────────

const GANTT_SECTION = /^\s*section\s+(.+?)\s*$/i;
const GANTT_TASK = /^\s*([^:\n]+?)\s*:\s*([^,]+(?:,[^,]+){0,3})\s*$/;
const GANTT_META = /^\s*(dateFormat|axisFormat|tickInterval|excludes|todayMarker|inclusiveEndDates)\b/i;

function parseGantt(ctx: ParseContext, declarationLine: number): void {
  let currentSection: string | undefined;
  for (let i = declarationLine + 1; i < ctx.lines.length; i++) {
    const raw = ctx.lines[i]!;
    if (!raw.trim() || COMMENT.test(raw)) continue;
    if (TITLE_DIRECTIVE.test(raw)) continue;
    if (GANTT_META.test(raw)) continue;

    const sec = raw.match(GANTT_SECTION);
    if (sec) {
      const sectionName = canonicaliseName(sec[1]!);
      currentSection = sectionName || undefined;
      if (currentSection) {
        pushSymbol(ctx, currentSection, {
          kind: "section",
          decorator: "gantt_section",
          line: i + 1,
          docstring: sec[1],
        });
      }
      continue;
    }
    const task = raw.match(GANTT_TASK);
    if (task) {
      const label = task[1]!;
      pushSymbol(ctx, label, {
        kind: "component",
        decorator: "gantt_task",
        line: i + 1,
        docstring: label,
        parent: currentSection,
      });
    }
  }
}

// ── journey ──────────────────────────────────────────────────────────────────

const JOURNEY_SECTION = /^\s*section\s+(.+?)\s*$/i;
const JOURNEY_TASK = /^\s*([^:]+?)\s*:\s*(\d+)\s*:\s*(.+)\s*$/;

function parseJourney(ctx: ParseContext, declarationLine: number): void {
  let currentSection: string | undefined;
  for (let i = declarationLine + 1; i < ctx.lines.length; i++) {
    const raw = ctx.lines[i]!;
    if (!raw.trim() || COMMENT.test(raw)) continue;
    if (TITLE_DIRECTIVE.test(raw)) continue;

    const sec = raw.match(JOURNEY_SECTION);
    if (sec) {
      const sectionName = canonicaliseName(sec[1]!);
      currentSection = sectionName || undefined;
      if (currentSection) {
        pushSymbol(ctx, currentSection, {
          kind: "section",
          decorator: "journey_section",
          line: i + 1,
          docstring: sec[1],
        });
      }
      continue;
    }
    const task = raw.match(JOURNEY_TASK);
    if (task) {
      pushSymbol(ctx, task[1]!, {
        kind: "component",
        decorator: "journey_task",
        line: i + 1,
        docstring: task[1],
        parent: currentSection,
      });
    }
  }
}

// ── gitGraph ─────────────────────────────────────────────────────────────────

const GIT_COMMIT = /^\s*commit(?:\s+id:\s*"([^"]+)")?/;
const GIT_BRANCH = /^\s*branch\s+([\w-]+)/;
const GIT_CHECKOUT = /^\s*(?:checkout|switch)\s+([\w-]+)/;
const GIT_MERGE = /^\s*merge\s+([\w-]+)/;

function parseGitGraph(ctx: ParseContext, declarationLine: number): void {
  let currentBranch = "main";
  let commitIndex = 0;
  for (let i = declarationLine + 1; i < ctx.lines.length; i++) {
    const raw = ctx.lines[i]!;
    if (!raw.trim() || COMMENT.test(raw)) continue;

    const branch = raw.match(GIT_BRANCH);
    if (branch) {
      currentBranch = branch[1]!;
      pushSymbol(ctx, currentBranch, {
        kind: "module",
        decorator: "branch",
        line: i + 1,
      });
      continue;
    }
    const checkout = raw.match(GIT_CHECKOUT);
    if (checkout) {
      currentBranch = checkout[1]!;
      continue;
    }
    const merge = raw.match(GIT_MERGE);
    if (merge) {
      pushReference(ctx, currentBranch, merge[1]!, i + 1, "references");
      continue;
    }
    const commit = raw.match(GIT_COMMIT);
    if (commit) {
      commitIndex += 1;
      const id = commit[1] ?? `c${commitIndex}`;
      pushSymbol(ctx, id, {
        kind: "component",
        decorator: "commit",
        line: i + 1,
        parent: currentBranch,
      });
    }
  }
}

// ── pie ──────────────────────────────────────────────────────────────────────

const PIE_SLICE = /^\s*"([^"]+)"\s*:\s*([\d.]+)/;

function parsePie(ctx: ParseContext, declarationLine: number): void {
  for (let i = declarationLine + 1; i < ctx.lines.length; i++) {
    const raw = ctx.lines[i]!;
    if (!raw.trim() || COMMENT.test(raw)) continue;
    if (TITLE_DIRECTIVE.test(raw)) continue;

    const slice = raw.match(PIE_SLICE);
    if (slice) {
      pushSymbol(ctx, slice[1]!, {
        kind: "component",
        decorator: "pie_slice",
        line: i + 1,
        docstring: `${slice[1]} = ${slice[2]}`,
      });
    }
  }
}

// ── mindmap ──────────────────────────────────────────────────────────────────
// The hierarchy is encoded by leading-whitespace indentation. Each level
// becomes a `mindmap_node` symbol with its parent set to the closest less
// indented ancestor. Shape markers `((text))`, `[text]`, `(text)`, etc. are
// surfaced via a secondary decorator.

const MINDMAP_LINE = /^(\s*)(\S.*?)\s*$/;
// Mindmap node syntax: identifier followed by an optional shape wrapping a
// label. Supported shapes: `[txt]` rect, `(txt)` rounded, `((txt))` circle,
// `))txt((` bang, `)txt(` cloud, `{{txt}}` hexagon, `[[txt]]` subroutine.
const MINDMAP_SHAPE_REGEX = /^([\w-]+)\s*(\(\(|\[\[|\)\)|\[|\(|\)|\{\{)\s*(.*?)\s*(\)\)|\]\]|\(\(|\]|\)|\(|\}\})$/;
const MINDMAP_ICON = /^\s*::icon\(/;
// Lines like `class:::cssClass` are mermaid CSS class assignments; skip them.
const MINDMAP_CLASS = /:::[a-zA-Z]/;

function parseMindmap(ctx: ParseContext, declarationLine: number): void {
  const stack: Array<{ indent: number; name: string }> = [];

  for (let i = declarationLine + 1; i < ctx.lines.length; i++) {
    const raw = ctx.lines[i]!;
    if (!raw.trim() || COMMENT.test(raw)) continue;
    if (MINDMAP_ICON.test(raw)) continue;
    if (MINDMAP_CLASS.test(raw)) continue;

    const m = raw.match(MINDMAP_LINE);
    if (!m) continue;
    const indent = m[1]!.length;
    const body = m[2]!.trim();

    const parsed = parseMindmapNode(body);
    if (!parsed.name) continue;

    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]?.name;

    pushSymbol(ctx, parsed.name, {
      kind: "component",
      decorator: "mindmap_node",
      line: i + 1,
      docstring: parsed.label,
      parent,
      extraDecorators: parsed.shape ? [parsed.shape] : undefined,
    });
    const canonical = canonicaliseName(parsed.name);
    if (canonical) stack.push({ indent, name: canonical });
  }
}

function parseMindmapNode(body: string): { name: string; shape?: string; label?: string } {
  const m = body.match(MINDMAP_SHAPE_REGEX);
  if (m) {
    return {
      name: m[1]!,
      shape: mindmapShape(m[2]!),
      label: m[3]!.trim() || undefined,
    };
  }
  return { name: body };
}

function mindmapShape(opener: string): string {
  switch (opener) {
    case "((":
      return "circle";
    case "[[":
      return "subroutine";
    case "[":
      return "rectangle";
    case "(":
      return "rounded";
    case "{{":
      return "hexagon";
    case "))":
    case ")":
      return "bang";
    default:
      return "default";
  }
}

// ── timeline ─────────────────────────────────────────────────────────────────

const TIMELINE_SECTION = /^\s*section\s+(.+?)\s*$/i;
const TIMELINE_ENTRY = /^\s*([^\s:][^:]*?)\s*:\s*(.+?)\s*$/;
const TIMELINE_CONTINUATION = /^\s*:\s*(.+?)\s*$/;

function parseTimeline(ctx: ParseContext, declarationLine: number): void {
  let currentSection: string | undefined;
  let lastPeriod: string | undefined;

  for (let i = declarationLine + 1; i < ctx.lines.length; i++) {
    const raw = ctx.lines[i]!;
    if (!raw.trim() || COMMENT.test(raw)) continue;
    if (TITLE_DIRECTIVE.test(raw)) continue;

    const sec = raw.match(TIMELINE_SECTION);
    if (sec) {
      const sectionName = canonicaliseName(sec[1]!);
      currentSection = sectionName || undefined;
      if (currentSection) {
        pushSymbol(ctx, currentSection, {
          kind: "section",
          decorator: "timeline_section",
          line: i + 1,
          docstring: sec[1],
        });
      }
      continue;
    }
    const cont = raw.match(TIMELINE_CONTINUATION);
    if (cont && !TIMELINE_ENTRY.test(raw)) {
      if (lastPeriod) {
        pushSymbol(ctx, `${lastPeriod}_${ctx.symbols.length}`, {
          kind: "component",
          decorator: "timeline_event",
          line: i + 1,
          docstring: cont[1],
          parent: lastPeriod,
        });
      }
      continue;
    }
    const entry = raw.match(TIMELINE_ENTRY);
    if (entry) {
      const period = entry[1]!.trim();
      const event = entry[2]!.trim();
      const canonical = canonicaliseName(period);
      if (canonical) {
        pushSymbol(ctx, period, {
          kind: "component",
          decorator: "timeline_period",
          line: i + 1,
          docstring: period,
          parent: currentSection,
        });
        lastPeriod = canonical;
        pushSymbol(ctx, `${canonical}_event`, {
          kind: "component",
          decorator: "timeline_event",
          line: i + 1,
          docstring: event,
          parent: canonical,
        });
      }
    }
  }
}

// ── C4 ───────────────────────────────────────────────────────────────────────

const C4_DECL = new RegExp(
  String.raw`^\s*(` + Array.from(C4_MACROS).join("|") + String.raw`)\s*\(\s*([\w-]+)`,
);
const C4_REL = new RegExp(
  String.raw`^\s*(` + Array.from(C4_REL_MACROS).join("|") + String.raw`)\s*\(\s*([\w-]+)\s*,\s*([\w-]+)`,
);

function parseC4(ctx: ParseContext, declarationLine: number): void {
  for (let i = declarationLine + 1; i < ctx.lines.length; i++) {
    const raw = ctx.lines[i]!;
    if (!raw.trim() || COMMENT.test(raw)) continue;

    const decl = raw.match(C4_DECL);
    if (decl) {
      const macro = decl[1]!;
      const alias = decl[2]!;
      const kind: SymbolNode["kind"] = macro.includes("Boundary") ? "module" : "component";
      pushSymbol(ctx, alias, {
        kind,
        decorator: `c4_${macro.toLowerCase()}`,
        line: i + 1,
      });
      continue;
    }
    const rel = raw.match(C4_REL);
    if (rel) {
      const from = rel[2]!;
      const to = rel[3]!;
      pushReference(ctx, from, to, i + 1, "references");
    }
  }
}

// ── requirementDiagram ──────────────────────────────────────────────────────

const REQ_OPEN = /^\s*(requirement|functionalRequirement|interfaceRequirement|performanceRequirement|physicalRequirement|designConstraint|element)\s+([\w-]+)\s*\{/;
const REQ_RELATION = /^\s*([\w-]+)\s*-\s*(contains|copies|derives|satisfies|verifies|refines|traces)\s*->\s*([\w-]+)/;

function parseRequirement(ctx: ParseContext, declarationLine: number): void {
  let openBlock: string | null = null;
  for (let i = declarationLine + 1; i < ctx.lines.length; i++) {
    const raw = ctx.lines[i]!;
    if (!raw.trim() || COMMENT.test(raw)) continue;

    if (openBlock) {
      if (/^\s*\}\s*$/.test(raw)) {
        openBlock = null;
        continue;
      }
      continue;
    }

    const open = raw.match(REQ_OPEN);
    if (open) {
      const macro = open[1]!;
      const name = open[2]!;
      const kind = macro === "element" ? "component" : "interface";
      pushSymbol(ctx, name, {
        kind,
        decorator: macro,
        line: i + 1,
      });
      openBlock = name;
      continue;
    }

    const rel = raw.match(REQ_RELATION);
    if (rel) {
      pushReference(ctx, rel[1]!, rel[3]!, i + 1, "references");
    }
  }
}

// ── zenuml ───────────────────────────────────────────────────────────────────

const ZENUML_ANNOTATOR = /^\s*@(Actor|Boundary|Control|Entity|Database|Collections|Queue|Source|Awsservice|EC2|S3|RDS|LB|Internet|Lambda)\s+([\w-]+)/;
const ZENUML_CALL = /^\s*([\w-]+)\s*->\s*([\w-]+)\s*:/;

function parseZenuml(ctx: ParseContext, declarationLine: number): void {
  for (let i = declarationLine + 1; i < ctx.lines.length; i++) {
    const raw = ctx.lines[i]!;
    if (!raw.trim() || COMMENT.test(raw)) continue;
    if (TITLE_DIRECTIVE.test(raw)) continue;

    const ann = raw.match(ZENUML_ANNOTATOR);
    if (ann) {
      pushSymbol(ctx, ann[2]!, {
        kind: "component",
        decorator: ann[1]!.toLowerCase(),
        line: i + 1,
      });
      continue;
    }
    const call = raw.match(ZENUML_CALL);
    if (call) {
      pushReference(ctx, call[1]!, call[2]!, i + 1, "references");
    }
  }
}

// ── path helpers ─────────────────────────────────────────────────────────────

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function posixBasename(p: string): string {
  const normalized = toPosix(p);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}

function filePathToModuleName(filePath: string): string {
  const normalized = toPosix(filePath);
  return normalized.replace(/\.[^.]+$/, "").replace(/\//g, ".");
}
