/**
 * Extract a single Changesets-format release section from a CHANGELOG.md.
 *
 * Used by:
 *   - .github/workflows/release.yml (passed to `gh release create --notes-file`)
 *   - tools/bootstrap-plugin (same notes for the manual one-off bootstrap)
 *
 * Behaviour:
 *   - Locates the heading `## <version>` (exact match, optional trailing
 *     whitespace allowed).
 *   - Captures every line below it until the next `## ` heading or EOF,
 *     dropping the heading itself and trimming surrounding blank lines.
 *   - Prints the resulting body to stdout and exits 0.
 *   - If the section is not found, exits 1 with a message on stderr.
 *   - On usage / read errors, exits 2 with a message on stderr.
 *
 * Usage:
 *   node .github/scripts/extract-changelog.mjs <CHANGELOG.md path> <version>
 *
 * Example:
 *   node .github/scripts/extract-changelog.mjs packages/lang-svg/CHANGELOG.md 0.2.0
 */
import { readFile } from "node:fs/promises";

/**
 * Extract the body under `## <version>` up to the next `## ` heading or EOF.
 * The header line itself is excluded; surrounding blank lines are trimmed.
 * Returns null if the version header is not found.
 *
 * @param {string} text   Full CHANGELOG.md content.
 * @param {string} version  Exact version string (e.g. "0.2.0").
 * @returns {string | null}
 */
export function extractSection(text, version) {
  const lines = text.split(/\r?\n/);
  const headerRe = new RegExp(`^##\\s+${escapeRegExp(version)}\\s*$`);

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headerRe.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }

  return lines.slice(start, end).join("\n").trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
  const [, , changelogPath, version] = process.argv;
  if (!changelogPath || !version) {
    process.stderr.write(
      "usage: extract-changelog.mjs <CHANGELOG.md path> <version>\n",
    );
    process.exit(2);
  }

  let text;
  try {
    text = await readFile(changelogPath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`cannot read ${changelogPath}: ${msg}\n`);
    process.exit(2);
  }

  const section = extractSection(text, version);
  if (section === null) {
    process.stderr.write(
      `version ${version} not found in ${changelogPath}\n`,
    );
    process.exit(1);
  }

  process.stdout.write(section);
  if (!section.endsWith("\n")) process.stdout.write("\n");
}

// Run main only when invoked as a script (works on POSIX and Windows).
const invokedPath = process.argv[1] ?? "";
if (invokedPath.endsWith("extract-changelog.mjs")) {
  main();
}
