/**
 * SQL language extractor.
 *
 * Parses SQL files (.sql, .ddl, .dml, .psql, .pgsql, .tsql) using a regex-based,
 * statement-oriented pipeline that is tolerant of the major dialects RepoNova
 * needs to ingest:
 *
 *   - **PostgreSQL** — `CREATE [OR REPLACE] FUNCTION ... LANGUAGE plpgsql`,
 *     `CREATE MATERIALIZED VIEW`, `CREATE TYPE ... AS ENUM`,
 *     `CREATE SCHEMA`, `CREATE SEQUENCE`, dollar-quoted strings `$$...$$`.
 *   - **MySQL** — backticked identifiers `` `name` ``, `AUTO_INCREMENT`,
 *     `ENGINE=InnoDB`, hash comments `# ...`, `DELIMITER //` blocks.
 *   - **SQLite** — minimal subset, INTEGER PRIMARY KEY AUTOINCREMENT.
 *   - **T-SQL** (SQL Server) — `[bracketed]` identifiers, `CREATE [OR ALTER]
 *     PROCEDURE`, `BEGIN ... END` blocks, square-bracket schema-qualified
 *     names (e.g. `[dbo].[Users]`).
 *   - **BigQuery / Snowflake** — backticks for identifiers, multi-part names
 *     `project.dataset.table`.
 *
 * The extractor pulls schema-level symbols that the knowledge graph cares about:
 *   - `CREATE TABLE` / `CREATE TEMP TABLE` / `CREATE UNLOGGED TABLE`
 *   - `CREATE VIEW` / `CREATE MATERIALIZED VIEW`
 *   - `CREATE FUNCTION` / `CREATE PROCEDURE` / `CREATE TRIGGER`
 *   - `CREATE INDEX` / `CREATE UNIQUE INDEX`
 *   - `CREATE TYPE` / `CREATE DOMAIN`
 *   - `CREATE SEQUENCE`
 *   - `CREATE SCHEMA`
 *
 * Plus cross-references:
 *   - `FOREIGN KEY ... REFERENCES other_table(col)` → `extends`
 *   - Inline `col TYPE REFERENCES other_table(col)` (column-level FK) → `extends`
 *   - `FROM other_table` / `JOIN other_table` (inside views, functions,
 *     CTEs) → `references`
 *   - `CALL other_proc(...)` (inside procedures) → `calls`
 *
 * The extractor is intentionally regex-based (Archetype B). The community
 * `tree-sitter-sql` grammar exists but does not publish pre-built WASMs,
 * and a full AST is far more than the graph layer requires. Going regex
 * also gives us dialect tolerance for free — a single grammar would lock
 * us to one dialect's lexicon.
 */
import type {
  LanguageExtractor,
  SyntaxTree,
  FileExtraction,
  FileNodeDeclaration,
  SymbolNode,
  SymbolReference,
} from "reponova";

// ─── Path helpers ────────────────────────────────────────────────────────

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function posixBasename(p: string): string {
  const normalized = toPosix(p);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}

// ─── Symbol bookkeeping ──────────────────────────────────────────────────

type SqlSymbolKind =
  | "class" // table, view, materialized view
  | "function" // function, trigger
  | "method" // procedure
  | "variable" // index
  | "constant" // sequence
  | "type" // type, domain
  | "enum" // type AS ENUM
  | "module"; // schema

interface SymbolDecl {
  /** Canonical symbol name (without schema prefix). */
  name: string;
  /** Schema-qualified parent, when explicit. */
  schema?: string;
  /** Original case-preserved display label (when echoed in docstring). */
  displayLabel?: string;
  /** Symbol kind in the RepoNova graph. */
  kind: SqlSymbolKind;
  /** First decorator: the SQL keyword family that introduced the node. */
  decorator: string;
  /** Additional decorators (modifiers like `temp`, `unique`, `materialized`). */
  extraDecorators?: string[];
  /** Line numbers (1-indexed, relative to original source). */
  startLine: number;
  endLine: number;
}

interface PreprocessedSource {
  /**
   * Source code with `--`, `#`, and `/&#42; &#42;/` comments replaced by
   * spaces of equal length. Line breaks are preserved so character offsets
   * still map to original line numbers.
   */
  text: string;
  /**
   * Leading comment block (lines before the first statement), trimmed and
   * joined. Used as the file-level docstring.
   */
  leadingDocstring?: string;
}

interface StatementSlice {
  /** Slice of the preprocessed source (no comments) ending before `;`. */
  text: string;
  /** Character offset within the (pre-processed) source. */
  start: number;
  /** Line number (1-indexed) at which the statement starts. */
  startLine: number;
  /** Line number (1-indexed) at which the statement ends. */
  endLine: number;
}

// ─── Identifier handling ─────────────────────────────────────────────────

/**
 * Unquote an identifier:
 *   - `"foo"`  → `foo`
 *   - `` `foo` `` → `foo`
 *   - `[foo]`  → `foo`
 *   - `foo`    → `foo`
 *
 * Preserves case as-is (consumers do their own canonicalisation).
 */
function unquoteIdent(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";
  const first = trimmed.charCodeAt(0);
  const last = trimmed.charCodeAt(trimmed.length - 1);
  // "foo" — PostgreSQL / SQL standard
  if (first === 0x22 && last === 0x22) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  // `foo` — MySQL / BigQuery
  if (first === 0x60 && last === 0x60) {
    return trimmed.slice(1, -1).replace(/``/g, "`");
  }
  // [foo] — T-SQL
  if (first === 0x5b && last === 0x5d) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Parse a possibly-qualified identifier into `schema.name`. Supports two-
 * and three-part names; for three-part `db.schema.name` the `db` is dropped.
 *
 * Returns `{ name }` when no qualification is present.
 */
function parseQualifiedName(raw: string): { name: string; schema?: string } {
  const parts = splitQualifiedParts(raw);
  if (parts.length === 0) return { name: "" };
  if (parts.length === 1) return { name: unquoteIdent(parts[0]!) };
  // Take last segment as name, segment immediately before as schema.
  const name = unquoteIdent(parts[parts.length - 1]!);
  const schema = unquoteIdent(parts[parts.length - 2]!);
  return schema ? { name, schema } : { name };
}

/**
 * Split a dotted identifier path while respecting `"..."`, `` `...` ``, and
 * `[...]` quoting (which all allow embedded dots).
 */
function splitQualifiedParts(raw: string): string[] {
  const parts: string[] = [];
  let i = 0;
  let buf = "";
  const len = raw.length;
  while (i < len) {
    const ch = raw[i]!;
    if (ch === '"' || ch === "`") {
      // Read until matching quote.
      buf += ch;
      const quote = ch;
      i++;
      while (i < len) {
        const c = raw[i]!;
        buf += c;
        i++;
        if (c === quote) {
          // Handle escaped doubled quote ("" or ``).
          if (i < len && raw[i] === quote) {
            buf += raw[i]!;
            i++;
            continue;
          }
          break;
        }
      }
      continue;
    }
    if (ch === "[") {
      buf += ch;
      i++;
      while (i < len) {
        const c = raw[i]!;
        buf += c;
        i++;
        if (c === "]") break;
      }
      continue;
    }
    if (ch === ".") {
      if (buf) parts.push(buf);
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf) parts.push(buf);
  return parts;
}

/** Identifier regex piece that matches any of the quoted/bare forms. */
const IDENT_PIECE = String.raw`(?:"(?:[^"]|"")+"|\x60(?:[^\x60]|\x60\x60)+\x60|\[[^\]]+\]|\w+)`;
/** Qualified identifier (one to three parts joined by `.`). */
const QUALIFIED_IDENT = `${IDENT_PIECE}(?:\\.${IDENT_PIECE}){0,2}`;

// ─── Preprocessing ───────────────────────────────────────────────────────

/**
 * Strip all SQL comments while preserving offsets/line numbers, so we can
 * apply position-sensitive regexes without worrying about hash comments
 * (MySQL), dash comments, or `/&#42; &#42;/` blocks splitting tokens.
 *
 * We also strip dollar-quoted string bodies (`$$ ... $$` / `$tag$ ... $tag$`)
 * down to spaces. This neutralises PostgreSQL function bodies — we don't
 * extract symbols from inside them today.
 *
 * One subtlety: the MySQL `DELIMITER $$` client directive repurposes `$$`
 * as a statement terminator, so a file mixing `DELIMITER $$` and bare
 * `$$ ... END $$` for procedure bodies would mis-trigger dollar-quote
 * stripping. We track DELIMITER state during the pre-pass and refuse to
 * dollar-quote-strip a tag that matches the active delimiter.
 */
function preprocess(source: string): PreprocessedSource {
  const len = source.length;
  // Mutable char array; we replace anything we want to neutralise with a
  // space (or keep `\n` so line numbers don't shift).
  const out = source.split("");
  let i = 0;
  let leadingDoc: string | null = null;
  let seenNonComment = false;
  const docBuffer: string[] = [];
  let currentDelim = ";";

  while (i < len) {
    const ch = source[i]!;
    const next = i + 1 < len ? source[i + 1] : "";

    // MySQL DELIMITER directive: line-anchored. We leave the directive
    // text in place (the splitter will recognise and consume it) but we
    // track the active delimiter here so dollar-quote handling below can
    // skip tokens that the splitter intends to use as terminators.
    if ((ch === "D" || ch === "d") && atStartOfLine(source, i)) {
      const m = DELIMITER_DIRECTIVE.exec(source.slice(i));
      if (m) {
        currentDelim = m[1]!;
        // Don't touch the bytes — just advance.
        i += m[0].length;
        seenNonComment = true;
        continue;
      }
    }

    // -- single-line comment
    if (ch === "-" && next === "-") {
      const lineEnd = findNextChar(source, i, "\n");
      const body = source.slice(i + 2, lineEnd).trim();
      if (!seenNonComment && body) docBuffer.push(body);
      for (let k = i; k < lineEnd; k++) out[k] = " ";
      i = lineEnd;
      continue;
    }

    // # single-line comment (MySQL extension). Only when at start of line
    // (after optional whitespace) — bare `#` mid-expression is too risky.
    if (ch === "#" && atStartOfLine(source, i)) {
      const lineEnd = findNextChar(source, i, "\n");
      const body = source.slice(i + 1, lineEnd).trim();
      if (!seenNonComment && body) docBuffer.push(body);
      for (let k = i; k < lineEnd; k++) out[k] = " ";
      i = lineEnd;
      continue;
    }

    // /* ... */ block comment (may span lines, preserve newlines)
    if (ch === "/" && next === "*") {
      const blockStart = i + 2;
      const blockEnd = source.indexOf("*/", blockStart);
      const end = blockEnd === -1 ? len : blockEnd + 2;
      const body = source.slice(blockStart, blockEnd === -1 ? len : blockEnd).trim();
      if (!seenNonComment && body) docBuffer.push(body.split("\n").map((s) => s.trim().replace(/^\*\s*/, "")).join(" ").trim());
      for (let k = i; k < end; k++) {
        if (out[k] !== "\n") out[k] = " ";
      }
      i = end;
      continue;
    }

    // String literal '...' (with '' escape). Neutralise the body so that
    // tokens like FROM / JOIN / REFERENCES that appear inside data strings
    // (or inside the deprecated PG `AS '...'` function body form) don't
    // become false-positive cross-references. The opening and closing
    // quotes are kept so the per-statement extractors still see a valid
    // SQL token sequence (e.g. `DEFAULT '       '`).
    if (ch === "'") {
      const stringEnd = findStringEnd(source, i);
      for (let k = i + 1; k < stringEnd - 1; k++) {
        if (out[k] !== "\n") out[k] = " ";
      }
      i = stringEnd;
      seenNonComment = true;
      continue;
    }

    // Dollar-quoted string (PostgreSQL: $$...$$ or $tag$...$tag$). Replace
    // body with spaces so embedded SQL (function bodies) doesn't pollute
    // the outer extractor — function bodies are out of scope for now.
    //
    // Skip if the tag matches the current MySQL DELIMITER directive (e.g.
    // `DELIMITER $$` followed by a procedure body that ends with `END $$`).
    // PostgreSQL doesn't have DELIMITER directives, so the two notations
    // are never both active in the same file.
    if (ch === "$") {
      const tagEnd = findDollarTagEnd(source, i);
      if (tagEnd !== -1) {
        const tag = source.slice(i, tagEnd + 1);
        if (tag !== currentDelim) {
          const bodyStart = tagEnd + 1;
          const closingIdx = source.indexOf(tag, bodyStart);
          if (closingIdx !== -1) {
            const end = closingIdx + tag.length;
            for (let k = bodyStart; k < closingIdx; k++) {
              if (out[k] !== "\n") out[k] = " ";
            }
            i = end;
            seenNonComment = true;
            continue;
          }
        }
      }
    }

    if (!/\s/.test(ch)) seenNonComment = true;
    i++;
  }

  if (docBuffer.length > 0) {
    leadingDoc = docBuffer.join(" ").replace(/\s+/g, " ").trim();
  }

  return {
    text: out.join(""),
    leadingDocstring: leadingDoc ?? undefined,
  };
}

function findNextChar(src: string, start: number, ch: string): number {
  const idx = src.indexOf(ch, start);
  return idx === -1 ? src.length : idx;
}

function atStartOfLine(src: string, idx: number): boolean {
  for (let k = idx - 1; k >= 0; k--) {
    const c = src[k]!;
    if (c === "\n") return true;
    if (c !== " " && c !== "\t") return false;
  }
  return true;
}

/**
 * Find the end (exclusive) of a single-quoted SQL string literal. SQL escapes
 * a single quote by doubling it (`''`). PostgreSQL also supports E'\n'-style
 * escape strings — we treat them the same since they end on the closing `'`.
 */
function findStringEnd(src: string, start: number): number {
  const len = src.length;
  let i = start + 1;
  while (i < len) {
    const c = src[i]!;
    if (c === "'") {
      if (i + 1 < len && src[i + 1] === "'") {
        i += 2;
        continue;
      }
      return i + 1;
    }
    if (c === "\\" && i + 1 < len) {
      // Skip backslash-escaped character (works for both PG E'...' and
      // MySQL `\` escapes — neither end on the escaped char).
      i += 2;
      continue;
    }
    i++;
  }
  return len;
}

/**
 * Given an index pointing at `$`, return the offset of the closing `$` of
 * the opening tag, or `-1` if this `$` does not start a valid dollar-quote
 * tag (e.g. `$1` parameter placeholder).
 *
 * Valid tags: `$$`, `$identifier$`.
 */
function findDollarTagEnd(src: string, start: number): number {
  if (src[start] !== "$") return -1;
  const len = src.length;
  let i = start + 1;
  while (i < len) {
    const c = src[i]!;
    if (c === "$") return i;
    if (!/[A-Za-z0-9_]/.test(c)) return -1;
    i++;
  }
  return -1;
}

// ─── Statement splitting ─────────────────────────────────────────────────

/** Regex matching a MySQL `DELIMITER xxx` client directive anchored at line start. */
const DELIMITER_DIRECTIVE = /^\s*DELIMITER[ \t]+(\S+)[ \t]*(?=\r?\n|$)/i;

/**
 * Split pre-processed source into statements terminated by the current
 * delimiter (initially `;`) outside of strings, dollar-quotes (already
 * neutralised), and parentheses.
 *
 * We additionally respect `BEGIN ... END` blocks in T-SQL — the `;` inside
 * `BEGIN ... END` is part of the procedure body, not a statement terminator
 * at the top level. Same for PostgreSQL functions, but those are already
 * neutralised by the dollar-quote stripper. For T-SQL we count `BEGIN`/
 * `END` tokens case-insensitively as nesting levels.
 *
 * MySQL `DELIMITER xxx` client directives switch the terminator to
 * `xxx` (typically `//` or `$$`) so that stored-procedure bodies can
 * contain literal `;` statements. The directive itself is a no-op for
 * extraction — we consume the line and update local state.
 */
function splitStatements(src: string): StatementSlice[] {
  const len = src.length;
  const stmts: StatementSlice[] = [];
  let stmtStart = 0;
  let parenDepth = 0;
  let beginDepth = 0;
  let line = 1;
  let stmtStartLine = 1;
  let i = 0;
  let currentDelim = ";";
  // Track whether we've consumed any non-whitespace since stmtStart.
  let hasContent = false;

  const emit = (endExclusive: number, terminatorLen: number): number => {
    const body = src.slice(stmtStart, endExclusive);
    if (hasContent) {
      stmts.push({
        text: body,
        start: stmtStart,
        startLine: stmtStartLine,
        endLine: line,
      });
    }
    let j = endExclusive + terminatorLen;
    while (j < len && /\s/.test(src[j]!)) {
      if (src[j] === "\n") line++;
      j++;
    }
    stmtStart = j;
    stmtStartLine = line;
    hasContent = false;
    return j;
  };

  while (i < len) {
    const ch = src[i]!;

    // Detect DELIMITER directive at start of line.
    if (
      (ch === "D" || ch === "d") &&
      parenDepth === 0 &&
      beginDepth === 0 &&
      atStartOfLine(src, i)
    ) {
      const m = DELIMITER_DIRECTIVE.exec(src.slice(i));
      if (m) {
        // Emit any pending content as a statement first — its terminator is
        // the implicit end-of-source-before-DELIMITER, otherwise we'd glue
        // unrelated statements together.
        if (hasContent) {
          emit(i, 0);
        }
        currentDelim = m[1]!;
        // Advance past the directive (i is at start of the line; m[0] is
        // matched from `i`, so add its length).
        const newI = i + m[0].length;
        // Count any newlines we skipped over (we anchored to line start, so
        // the matched text contains no newlines, but be defensive).
        for (let k = i; k < newI; k++) if (src[k] === "\n") line++;
        i = newI;
        // Skip the trailing newline so the next statement starts on a fresh line.
        while (i < len && (src[i] === " " || src[i] === "\t")) i++;
        if (i < len && (src[i] === "\r" || src[i] === "\n")) {
          if (src[i] === "\r" && i + 1 < len && src[i + 1] === "\n") i += 2;
          else i++;
          line++;
        }
        stmtStart = i;
        stmtStartLine = line;
        hasContent = false;
        continue;
      }
    }

    if (ch === "\n") {
      line++;
      i++;
      continue;
    }
    if (ch === "'") {
      const endIdx = findStringEnd(src, i);
      // Count newlines inside the string body.
      for (let k = i; k < endIdx; k++) if (src[k] === "\n") line++;
      i = endIdx;
      hasContent = true;
      continue;
    }
    if (ch === "(") {
      parenDepth++;
      i++;
      hasContent = true;
      continue;
    }
    if (ch === ")") {
      if (parenDepth > 0) parenDepth--;
      i++;
      hasContent = true;
      continue;
    }
    if (
      parenDepth === 0 &&
      beginDepth === 0 &&
      matchesAt(src, i, currentDelim)
    ) {
      i = emit(i, currentDelim.length);
      continue;
    }

    // Detect BEGIN/END only when whole word and outside parens. This is
    // primarily for T-SQL where stored procedures wrap their body in
    // BEGIN ... END containing inner `;` separated statements that
    // should not terminate the outer CREATE PROCEDURE.
    //
    // We must NOT count `END IF`, `END LOOP`, `END WHILE`, `END CASE`,
    // `END REPEAT` as outer-block terminators — those close their
    // respective control-flow constructs, not a BEGIN block.
    if ((ch === "B" || ch === "b" || ch === "E" || ch === "e") && parenDepth === 0) {
      const word = matchWordCaseless(src, i);
      if (word === "BEGIN") {
        beginDepth++;
        i += 5;
        hasContent = true;
        continue;
      }
      if (word === "END" && beginDepth > 0) {
        // Peek at the next word to see if this is `END <X>` for a
        // control-flow keyword X (in which case it's NOT closing the
        // outer BEGIN).
        let j = i + 3;
        while (j < src.length && /[\s\r\n]/.test(src[j]!)) j++;
        const nextWord = matchWordCaseless(src, j);
        if (
          nextWord === "IF" ||
          nextWord === "LOOP" ||
          nextWord === "WHILE" ||
          nextWord === "CASE" ||
          nextWord === "REPEAT"
        ) {
          // Skip the `END` AND the trailing keyword so the next iteration
          // doesn't try to interpret it.
          i = j + nextWord.length;
          hasContent = true;
          continue;
        }
        beginDepth--;
        i += 3;
        hasContent = true;
        continue;
      }
    }

    if (!/\s/.test(ch)) hasContent = true;
    i++;
  }

  if (hasContent) {
    stmts.push({ text: src.slice(stmtStart, len), start: stmtStart, startLine: stmtStartLine, endLine: line });
  }
  return stmts;
}

/**
 * Return true if `src` contains the substring `needle` starting at offset
 * `i`. Faster than building a substring just to compare equality.
 */
function matchesAt(src: string, i: number, needle: string): boolean {
  if (needle.length === 0) return false;
  if (i + needle.length > src.length) return false;
  for (let k = 0; k < needle.length; k++) {
    if (src[i + k] !== needle[k]) return false;
  }
  return true;
}

/**
 * If the position points to the start of a word, return the upper-cased
 * word (limited to letters); otherwise return `null`. Used by the BEGIN/END
 * counter so it only matches whole tokens (`BEGINNING`, `ENDPOINT` are
 * left alone).
 */
function matchWordCaseless(src: string, i: number): string | null {
  if (i > 0) {
    const prev = src[i - 1]!;
    if (/\w/.test(prev)) return null;
  }
  let j = i;
  while (j < src.length && /[A-Za-z]/.test(src[j]!)) j++;
  if (j === i) return null;
  const next = j < src.length ? src[j]! : "";
  if (/\w/.test(next)) return null;
  return src.slice(i, j).toUpperCase();
}

// ─── Per-statement regexes ───────────────────────────────────────────────

/**
 * Modifier prefix that may appear between `CREATE` and the object kind
 * keyword. Covers PostgreSQL `OR REPLACE`, T-SQL `OR ALTER`, and the
 * MySQL `DEFINER=...`, `SQL SECURITY`, and `ALGORITHM=...` clauses (used
 * in views, functions, procedures, triggers, and events).
 *
 * The DEFINER value can be `CURRENT_USER`, a bare identifier, a quoted
 * identifier (`'user'`, `` `user` ``), and an optional `@host` part with
 * the same quoting options.
 */
const DEFINER_VALUE = String.raw`(?:CURRENT_USER(?:\(\))?|(?:'[^']*'|\x60[^\x60]*\x60|\w+)(?:\s*@\s*(?:'[^']*'|\x60[^\x60]*\x60|\w+))?)`;
const CREATE_MODS = String.raw`(?:OR\s+(?:REPLACE|ALTER)\s+|DEFINER\s*=\s*${DEFINER_VALUE}\s+|SQL\s+SECURITY\s+(?:DEFINER|INVOKER)\s+|ALGORITHM\s*=\s*\w+\s+)*`;

/**
 * Match the leading CREATE clause with optional modifiers and capture
 * the OBJECT kind keyword group. Built dynamically because the leading
 * modifier set is small but varied across dialects.
 *
 * The regex matches up to the first identifier of the target name.
 */
const CREATE_TABLE = new RegExp(
  String.raw`^\s*CREATE\s+${CREATE_MODS}(?:(GLOBAL\s+TEMPORARY|TEMPORARY|TEMP|LOCAL\s+TEMPORARY|UNLOGGED|FOREIGN|VIRTUAL)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QUALIFIED_IDENT})`,
  "i",
);

const CREATE_VIEW = new RegExp(
  String.raw`^\s*CREATE\s+${CREATE_MODS}(MATERIALIZED\s+)?(?:TEMP(?:ORARY)?\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QUALIFIED_IDENT})`,
  "i",
);

const CREATE_FUNCTION = new RegExp(
  String.raw`^\s*CREATE\s+${CREATE_MODS}FUNCTION\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QUALIFIED_IDENT})`,
  "i",
);

const CREATE_PROCEDURE = new RegExp(
  String.raw`^\s*CREATE\s+${CREATE_MODS}PROC(?:EDURE)?\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QUALIFIED_IDENT})`,
  "i",
);

const CREATE_TRIGGER = new RegExp(
  String.raw`^\s*CREATE\s+${CREATE_MODS}(?:CONSTRAINT\s+)?TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QUALIFIED_IDENT})\s+(?:BEFORE|AFTER|INSTEAD\s+OF|FOR)\s+[\s\S]*?\bON\s+(${QUALIFIED_IDENT})`,
  "i",
);

const ALTER_TABLE = new RegExp(
  String.raw`^\s*ALTER\s+TABLE\s+(?:ONLY\s+|IF\s+EXISTS\s+)*(${QUALIFIED_IDENT})`,
  "i",
);

const CREATE_INDEX = new RegExp(
  String.raw`^\s*CREATE\s+(UNIQUE\s+)?(?:CLUSTERED\s+|NONCLUSTERED\s+|BITMAP\s+|FULLTEXT\s+|SPATIAL\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(${QUALIFIED_IDENT})\s+ON\s+(${QUALIFIED_IDENT})`,
  "i",
);

const CREATE_TYPE = new RegExp(
  String.raw`^\s*CREATE\s+TYPE\s+(${QUALIFIED_IDENT})(?:\s+AS\s+(ENUM|RANGE|OBJECT|TABLE))?`,
  "i",
);

const CREATE_DOMAIN = new RegExp(
  String.raw`^\s*CREATE\s+DOMAIN\s+(${QUALIFIED_IDENT})\s+AS\s+`,
  "i",
);

const CREATE_SEQUENCE = new RegExp(
  String.raw`^\s*CREATE\s+(?:TEMP(?:ORARY)?\s+)?SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QUALIFIED_IDENT})`,
  "i",
);

const CREATE_SCHEMA = new RegExp(
  String.raw`^\s*CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:AUTHORIZATION\s+\w+|(${QUALIFIED_IDENT})(?:\s+AUTHORIZATION\s+\w+)?)`,
  "i",
);

// References — used inside CREATE TABLE bodies and elsewhere.
const FK_BLOCK_REGEX = new RegExp(
  String.raw`\bFOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+(${QUALIFIED_IDENT})`,
  "ig",
);

const FK_INLINE_REGEX = new RegExp(
  String.raw`\bREFERENCES\s+(${QUALIFIED_IDENT})`,
  "ig",
);

// FROM / JOIN refs (inside view bodies, function bodies, CTEs).
const FROM_REGEX = new RegExp(
  String.raw`\bFROM\s+(${QUALIFIED_IDENT})`,
  "ig",
);

const JOIN_REGEX = new RegExp(
  String.raw`\b(?:INNER|LEFT|RIGHT|FULL|CROSS|NATURAL)?\s*(?:OUTER\s+)?JOIN\s+(${QUALIFIED_IDENT})`,
  "ig",
);

const CALL_REGEX = new RegExp(
  String.raw`\b(?:CALL|EXEC|EXECUTE)\s+(${QUALIFIED_IDENT})`,
  "ig",
);

// CTE detection: `WITH foo AS (...)`, `, bar AS (...)`. We use this only to
// know that the rest of the statement contains a SELECT body — we don't
// emit CTE names as symbols.

// ─── Extractor implementation ────────────────────────────────────────────

export class SqlExtractor implements LanguageExtractor {
  readonly languageId = "sql";
  readonly wasmFile = undefined;

  extract(_tree: SyntaxTree | null, sourceCode: string, filePath: string): FileExtraction {
    const symbols: SymbolNode[] = [];
    const references: SymbolReference[] = [];

    const moduleName = filePathToModuleName(filePath);
    const fileName = posixBasename(filePath);

    const pre = preprocess(sourceCode);
    const fileNode: FileNodeDeclaration = {
      kind: "module",
      label: fileName,
      docstring: pre.leadingDocstring,
      tags: ["sql"],
    };

    const stmts = splitStatements(pre.text);

    const declared = new Set<string>();
    const pushSymbol = (decl: SymbolDecl): SymbolNode | null => {
      const canonicalName = decl.schema ? `${decl.schema}.${decl.name}` : decl.name;
      if (!decl.name) return null;
      if (declared.has(canonicalName)) return null;
      declared.add(canonicalName);
      const decorators = [decl.decorator, ...(decl.extraDecorators ?? [])];
      const sym: SymbolNode = {
        name: decl.name,
        qualifiedName: `${moduleName}.${canonicalName}`,
        kind: decl.kind,
        decorators,
        startLine: decl.startLine,
        endLine: decl.endLine,
      };
      if (decl.schema) sym.parent = decl.schema;
      if (decl.displayLabel && decl.displayLabel !== decl.name) {
        sym.docstring = decl.displayLabel;
      }
      symbols.push(sym);
      return sym;
    };

    for (const stmt of stmts) {
      if (/^\s*CREATE\b/i.test(stmt.text)) {
        const handled =
          tryTable(stmt, pushSymbol, references) ||
          tryView(stmt, pushSymbol, references) ||
          tryFunction(stmt, pushSymbol, references) ||
          tryProcedure(stmt, pushSymbol, references) ||
          tryTrigger(stmt, pushSymbol, references) ||
          tryIndex(stmt, pushSymbol, references) ||
          tryType(stmt, pushSymbol) ||
          tryDomain(stmt, pushSymbol) ||
          trySequence(stmt, pushSymbol) ||
          tryCreateSchema(stmt, pushSymbol);
        void handled;
        continue;
      }

      if (/^\s*ALTER\s+TABLE\b/i.test(stmt.text)) {
        // ALTER TABLE may carry FOREIGN KEY constraint additions — that's
        // how pg_dump and mysqldump emit them. We still don't extract the
        // ALTER itself as a symbol (the target table was declared by an
        // earlier CREATE), but the FK edges DO need to land on the graph.
        tryAlterTableForeignKeys(stmt, references, moduleName);
        continue;
      }

      // Other statements (INSERT/UPDATE/DELETE/SELECT/GRANT/COMMENT/...)
      // are intentionally ignored — they don't introduce schema-level
      // symbols nor cross-references that the graph layer needs today.
    }

    return {
      filePath,
      language: "sql",
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

// ─── Statement handlers ──────────────────────────────────────────────────

type PushSymbol = (decl: SymbolDecl) => SymbolNode | null;

function tryTable(
  stmt: StatementSlice,
  pushSymbol: PushSymbol,
  references: SymbolReference[],
): boolean {
  const m = CREATE_TABLE.exec(stmt.text);
  if (!m) return false;
  const modifier = m[1]?.toLowerCase().replace(/\s+/g, "_");
  const { name, schema } = parseQualifiedName(m[2]!);
  if (!name) return true;
  const extraDecorators = modifier ? [modifier] : [];
  const sym = pushSymbol({
    name,
    schema,
    kind: "class",
    decorator: "table",
    extraDecorators,
    startLine: stmt.startLine,
    endLine: stmt.endLine,
  });
  if (!sym) return true;
  const fromSymbol = sym.qualifiedName;
  // Body starts after the matched `CREATE TABLE ... <name>` prefix.
  const bodyStart = m.index + m[0].length;
  const body = stmt.text.slice(bodyStart);
  collectForeignKeys(body, bodyStart, stmt, references, fromSymbol);
  return true;
}

function tryView(
  stmt: StatementSlice,
  pushSymbol: PushSymbol,
  references: SymbolReference[],
): boolean {
  const m = CREATE_VIEW.exec(stmt.text);
  if (!m) return false;
  const isMaterialized = !!m[1];
  const { name, schema } = parseQualifiedName(m[2]!);
  if (!name) return true;
  const sym = pushSymbol({
    name,
    schema,
    kind: "class",
    decorator: isMaterialized ? "materialized_view" : "view",
    startLine: stmt.startLine,
    endLine: stmt.endLine,
  });
  if (!sym) return true;
  const bodyStart = m.index + m[0].length;
  const body = stmt.text.slice(bodyStart);
  collectQueryRefs(body, bodyStart, stmt, references, sym.qualifiedName);
  return true;
}

function tryFunction(
  stmt: StatementSlice,
  pushSymbol: PushSymbol,
  references: SymbolReference[],
): boolean {
  const m = CREATE_FUNCTION.exec(stmt.text);
  if (!m) return false;
  const { name, schema } = parseQualifiedName(m[1]!);
  if (!name) return true;
  const sym = pushSymbol({
    name,
    schema,
    kind: "function",
    decorator: "function",
    startLine: stmt.startLine,
    endLine: stmt.endLine,
  });
  if (!sym) return true;
  const bodyStart = m.index + m[0].length;
  const body = stmt.text.slice(bodyStart);
  collectQueryRefs(body, bodyStart, stmt, references, sym.qualifiedName);
  collectCalls(body, bodyStart, stmt, references, sym.qualifiedName);
  return true;
}

function tryProcedure(
  stmt: StatementSlice,
  pushSymbol: PushSymbol,
  references: SymbolReference[],
): boolean {
  const m = CREATE_PROCEDURE.exec(stmt.text);
  if (!m) return false;
  const { name, schema } = parseQualifiedName(m[1]!);
  if (!name) return true;
  const sym = pushSymbol({
    name,
    schema,
    kind: "method",
    decorator: "procedure",
    startLine: stmt.startLine,
    endLine: stmt.endLine,
  });
  if (!sym) return true;
  const bodyStart = m.index + m[0].length;
  const body = stmt.text.slice(bodyStart);
  collectQueryRefs(body, bodyStart, stmt, references, sym.qualifiedName);
  collectCalls(body, bodyStart, stmt, references, sym.qualifiedName);
  return true;
}

function tryTrigger(
  stmt: StatementSlice,
  pushSymbol: PushSymbol,
  references: SymbolReference[],
): boolean {
  const m = CREATE_TRIGGER.exec(stmt.text);
  if (!m) return false;
  const { name, schema } = parseQualifiedName(m[1]!);
  if (!name) return true;
  const sym = pushSymbol({
    name,
    schema,
    kind: "function",
    decorator: "trigger",
    startLine: stmt.startLine,
    endLine: stmt.endLine,
  });
  if (!sym) return true;
  // The trigger's target table — captured in regex group 2.
  const targetIdent = m[2];
  if (targetIdent) {
    const { name: tName, schema: tSchema } = parseQualifiedName(targetIdent);
    const targetName = tSchema ? `${tSchema}.${tName}` : tName;
    if (targetName && targetName !== sym.name) {
      references.push({
        name: targetName,
        fromSymbol: sym.qualifiedName,
        kind: "references",
        line: stmt.startLine,
      });
    }
  }
  return true;
}

function tryIndex(
  stmt: StatementSlice,
  pushSymbol: PushSymbol,
  references: SymbolReference[],
): boolean {
  const m = CREATE_INDEX.exec(stmt.text);
  if (!m) return false;
  const isUnique = !!m[1];
  const { name, schema } = parseQualifiedName(m[2]!);
  if (!name) return true;
  const sym = pushSymbol({
    name,
    schema,
    kind: "variable",
    decorator: "index",
    extraDecorators: isUnique ? ["unique"] : [],
    startLine: stmt.startLine,
    endLine: stmt.endLine,
  });
  if (!sym) return true;
  const targetIdent = m[3]!;
  const { name: tName, schema: tSchema } = parseQualifiedName(targetIdent);
  const targetName = tSchema ? `${tSchema}.${tName}` : tName;
  if (targetName) {
    references.push({
      name: targetName,
      fromSymbol: sym.qualifiedName,
      kind: "references",
      line: stmt.startLine,
    });
  }
  return true;
}

function tryType(stmt: StatementSlice, pushSymbol: PushSymbol): boolean {
  const m = CREATE_TYPE.exec(stmt.text);
  if (!m) return false;
  const { name, schema } = parseQualifiedName(m[1]!);
  if (!name) return true;
  const variant = m[2]?.toLowerCase();
  pushSymbol({
    name,
    schema,
    kind: variant === "enum" ? "enum" : "type",
    decorator: variant ? variant : "type",
    startLine: stmt.startLine,
    endLine: stmt.endLine,
  });
  return true;
}

function tryDomain(stmt: StatementSlice, pushSymbol: PushSymbol): boolean {
  const m = CREATE_DOMAIN.exec(stmt.text);
  if (!m) return false;
  const { name, schema } = parseQualifiedName(m[1]!);
  if (!name) return true;
  pushSymbol({
    name,
    schema,
    kind: "type",
    decorator: "domain",
    startLine: stmt.startLine,
    endLine: stmt.endLine,
  });
  return true;
}

function trySequence(stmt: StatementSlice, pushSymbol: PushSymbol): boolean {
  const m = CREATE_SEQUENCE.exec(stmt.text);
  if (!m) return false;
  const { name, schema } = parseQualifiedName(m[1]!);
  if (!name) return true;
  pushSymbol({
    name,
    schema,
    kind: "constant",
    decorator: "sequence",
    startLine: stmt.startLine,
    endLine: stmt.endLine,
  });
  return true;
}

/**
 * Pull FK edges out of an `ALTER TABLE foo ADD CONSTRAINT name FOREIGN
 * KEY (...) REFERENCES bar(col)` statement (the canonical form emitted
 * by `pg_dump` / `mysqldump`).
 *
 * The source table comes from the `ALTER TABLE <name>` prefix; the
 * target table from each `FOREIGN KEY ... REFERENCES <name>` clause
 * inside the body. Multiple ADDs per ALTER (`, ADD ...`) are tolerated.
 */
function tryAlterTableForeignKeys(
  stmt: StatementSlice,
  references: SymbolReference[],
  moduleName: string,
): void {
  const m = ALTER_TABLE.exec(stmt.text);
  if (!m) return;
  const { name, schema } = parseQualifiedName(m[1]!);
  if (!name) return;
  const sourceCanonical = schema ? `${schema}.${name}` : name;
  const fromSymbol = `${moduleName}.${sourceCanonical}`;
  const bodyStart = m.index + m[0].length;
  const body = stmt.text.slice(bodyStart);
  collectForeignKeys(body, bodyStart, stmt, references, fromSymbol);
}

function tryCreateSchema(stmt: StatementSlice, pushSymbol: PushSymbol): boolean {
  const m = CREATE_SCHEMA.exec(stmt.text);
  if (!m) return false;
  // When CREATE SCHEMA AUTHORIZATION foo is used WITHOUT an explicit
  // schema name, the AUTHORIZATION user IS the schema name. Group 1 is
  // undefined in that case — skip silently (no symbol to emit).
  if (!m[1]) return true;
  const { name } = parseQualifiedName(m[1]);
  if (!name) return true;
  pushSymbol({
    name,
    kind: "module",
    decorator: "schema",
    startLine: stmt.startLine,
    endLine: stmt.endLine,
  });
  return true;
}

// ─── Cross-reference collectors ──────────────────────────────────────────

/**
 * Pull foreign-key references out of a `CREATE TABLE` body. We look for:
 *   - Standalone constraints: `FOREIGN KEY (col, ...) REFERENCES other(col)`
 *   - Inline column FKs: `col TYPE ... REFERENCES other(col)`
 *
 * Both produce an `extends` edge from this table to the referenced table.
 * De-duplicated per target — a multi-column FK still emits one edge.
 */
function collectForeignKeys(
  body: string,
  bodyOffsetInStmt: number,
  stmt: StatementSlice,
  references: SymbolReference[],
  fromSymbol: string,
): void {
  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  FK_BLOCK_REGEX.lastIndex = 0;
  while ((m = FK_BLOCK_REGEX.exec(body)) !== null) {
    const { name, schema } = parseQualifiedName(m[2]!);
    const target = schema ? `${schema}.${name}` : name;
    if (!target || seen.has(target)) continue;
    seen.add(target);
    references.push({
      name: target,
      fromSymbol,
      kind: "extends",
      line: offsetToLine(stmt, bodyOffsetInStmt + m.index),
    });
  }

  // Inline FK: any REFERENCES that wasn't already captured by FOREIGN KEY.
  FK_INLINE_REGEX.lastIndex = 0;
  while ((m = FK_INLINE_REGEX.exec(body)) !== null) {
    // Skip matches consumed by FOREIGN KEY blocks (overlap with above is
    // possible but the dedup set handles it).
    const { name, schema } = parseQualifiedName(m[1]!);
    const target = schema ? `${schema}.${name}` : name;
    if (!target || seen.has(target)) continue;
    seen.add(target);
    references.push({
      name: target,
      fromSymbol,
      kind: "extends",
      line: offsetToLine(stmt, bodyOffsetInStmt + m.index),
    });
  }
}

/**
 * Pull FROM/JOIN references out of a query body (view, function, procedure).
 * Emits `references` edges. De-duplicated per target.
 */
function collectQueryRefs(
  body: string,
  bodyOffsetInStmt: number,
  stmt: StatementSlice,
  references: SymbolReference[],
  fromSymbol: string,
): void {
  const seen = new Set<string>();
  const visit = (re: RegExp): void => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const { name, schema } = parseQualifiedName(m[1]!);
      const target = schema ? `${schema}.${name}` : name;
      if (!target || seen.has(target)) continue;
      seen.add(target);
      references.push({
        name: target,
        fromSymbol,
        kind: "references",
        line: offsetToLine(stmt, bodyOffsetInStmt + m.index),
      });
    }
  };
  visit(FROM_REGEX);
  visit(JOIN_REGEX);
}

/**
 * Pull procedure / function calls out of a function or procedure body.
 * Emits `calls` edges.
 */
function collectCalls(
  body: string,
  bodyOffsetInStmt: number,
  stmt: StatementSlice,
  references: SymbolReference[],
  fromSymbol: string,
): void {
  const seen = new Set<string>();
  CALL_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CALL_REGEX.exec(body)) !== null) {
    const { name, schema } = parseQualifiedName(m[1]!);
    const target = schema ? `${schema}.${name}` : name;
    if (!target || seen.has(target)) continue;
    seen.add(target);
    references.push({
      name: target,
      fromSymbol,
      kind: "calls",
      line: offsetToLine(stmt, bodyOffsetInStmt + m.index),
    });
  }
}

/** Map a character offset (within `stmt.text`) to a 1-indexed line number. */
function offsetToLine(stmt: StatementSlice, offsetWithinStmt: number): number {
  const slice = stmt.text.slice(0, offsetWithinStmt);
  let newlines = 0;
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] === "\n") newlines++;
  }
  return stmt.startLine + newlines;
}

function filePathToModuleName(filePath: string): string {
  const normalized = toPosix(filePath);
  return normalized.replace(/\.[^.]+$/, "").replace(/\//g, ".");
}
