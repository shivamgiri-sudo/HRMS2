/**
 * information_schema results come back with UPPERCASE keys. Read them accordingly.
 *
 * MySQL 8 labels the result set TABLE_NAME / COLUMN_NAME / DATA_TYPE / TABLE_ROWS no
 * matter how the SELECT is written — `SELECT table_name` still yields `TABLE_NAME`.
 * Verified against live 8.0.42: `row.table_name` is undefined, `row.TABLE_NAME` is
 * "employees". An explicit `AS table_name` alias is what restores the lowercase key.
 *
 * This is a silent failure, which is why it needs a guard rather than review. Nothing
 * throws: String(undefined) is "undefined", so a Map keyed on it builds fine and every
 * later lookup by real table name simply misses. It has cost this codebase twice —
 * all 14 BPO master reports 500'd for months, and journey-audit reported all of its
 * sources as TABLE_MISSING while returning no rows, against tables that were present
 * and populated.
 *
 * Two ways to be correct, both accepted here:
 *   1. alias in SQL      — SELECT TABLE_NAME AS table_name
 *   2. read both cases   — row.table_name ?? row.TABLE_NAME, or a pick() helper
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "..", "..");

const INFORMATION_SCHEMA_COLUMNS = ["table_name", "column_name", "data_type", "table_rows"];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      sourceFiles(full, found);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Comments must come out before anything is judged.
 *
 * Every fix for this bug explains itself by naming TABLE_NAME in a comment, and the
 * defensive-read heuristic below would read that prose as the defence itself — so
 * re-introducing the bug under an intact comment would pass. That false negative was
 * real: the first version of this guard did not catch a deliberately reverted fix.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Does this file defend against the uppercase key when it reads a result row? */
function readsBothCases(code: string, column: string): boolean {
  const upper = column.toUpperCase();
  // `row.table_name ?? row.TABLE_NAME`, `r['table_name'] ?? r['TABLE_NAME']`,
  // or a pick(row, "table_name") helper that tries both internally.
  return code.includes(upper) || /\bpick\s*\(/.test(code);
}

describe("information_schema key casing", () => {
  const offenders: string[] = [];

  for (const file of sourceFiles(SRC)) {
    const source = stripComments(fs.readFileSync(file, "utf8"));
    if (!/information_schema/i.test(source)) continue;

    for (const match of source.matchAll(/SELECT\s+([\s\S]*?)\s+FROM\s+information_schema/gi)) {
      const selectList = match[1];
      // A very long capture means the regex ran past the statement it meant to read.
      if (selectList.length > 300) continue;

      for (const column of INFORMATION_SCHEMA_COLUMNS) {
        const selectsBareLowercase = new RegExp(`(?<![.\\w])${column}(?![\\w])`).test(selectList);
        const aliased = new RegExp(`AS\\s+${column}`, "i").test(selectList);
        if (selectsBareLowercase && !aliased && !readsBothCases(source, column)) {
          offenders.push(`${path.relative(SRC, file).replace(/\\/g, "/")} selects bare \`${column}\``);
        }
      }
    }
  }

  it("every information_schema read either aliases or handles both cases", () => {
    expect(
      [...new Set(offenders)],
      "Selecting bare lowercase from information_schema yields undefined on MySQL 8. "
        + "Alias it (SELECT TABLE_NAME AS table_name) or read row.TABLE_NAME as a fallback",
    ).toEqual([]);
  });

  it("knows what it is scanning — the known consumers are still present", () => {
    const consumers = sourceFiles(SRC).filter((f) =>
      /information_schema/i.test(stripComments(fs.readFileSync(f, "utf8"))),
    );
    // Guards against the scan silently passing because it matched nothing at all.
    expect(consumers.length).toBeGreaterThan(10);
  });
});
