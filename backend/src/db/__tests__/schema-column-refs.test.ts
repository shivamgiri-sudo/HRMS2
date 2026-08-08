import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { columnRefsIn, brokenRefs, type ColumnRef } from "./schema-column-refs.js";

/**
 * Regenerate the baseline (same scanner as the assertions, so the two cannot drift):
 *
 *   SCHEMA_REFS_WRITE_BASELINE=1 npx vitest run src/db/__tests__/schema-column-refs
 *
 * Only ever do that to record a DELIBERATE change. Regenerating it to turn a red build
 * green is exactly the failure this guard exists to prevent — it re-admits a query that
 * throws at runtime and reports a fabricated zero.
 */
const WRITE_BASELINE = process.env.SCHEMA_REFS_WRITE_BASELINE === "1";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(HERE, "..", "..");
const SNAPSHOT = resolve(HERE, "..", "..", "..", "sql", "schema-snapshot.json");
const BASELINE = resolve(HERE, "schema-column-refs.baseline.json");

type Snapshot = { tableCount: number; columnCount: number; tables: Record<string, string[]> };

function tsFilesUnder(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      tsFilesUnder(full, acc);
    } else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

function scanRepo(schema: Snapshot): Map<string, ColumnRef[]> {
  const byFile = new Map<string, ColumnRef[]>();
  for (const file of tsFilesUnder(SRC_DIR)) {
    const broken = brokenRefs(columnRefsIn(readFileSync(file, "utf8")), schema.tables);
    if (broken.length) {
      byFile.set(relative(SRC_DIR, file).split(sep).join("/"), broken);
    }
  }
  return byFile;
}

const key = (f: string, r: ColumnRef) => `${f}::${r.table}.${r.column}`;

function writeBaseline(byFile: Map<string, ColumnRef[]>): void {
  const out: Record<string, string[]> = {};
  for (const [file, refs] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
    out[file] = refs.map((r) => `${r.table}.${r.column}`).sort();
  }
  writeFileSync(BASELINE, JSON.stringify(out, null, 2) + "\n");
}

describe("schema column references", () => {
  // --- the scanner itself ------------------------------------------------
  const schema = { dept: ["id", "dept_name"] };

  it("resolves an alias and flags a column the table does not have", () => {
    const sql = "const q = `SELECT dm.dept_name, dm.department_name FROM dept dm`;";
    expect(brokenRefs(columnRefsIn(sql), schema)).toEqual([
      { table: "dept", column: "department_name" },
    ]);
  });

  it("ignores tables that are not in the snapshot", () => {
    const sql = "const q = `SELECT xx.whatever FROM some_other_table xx`;";
    expect(brokenRefs(columnRefsIn(sql), schema)).toEqual([]);
  });

  it("does not let an alias leak from one statement into the next", () => {
    // `dm` is dept in the first statement; in the second it is a table we know nothing
    // about, so dm.anything there must not be attributed to dept.
    const sql =
      "const a = `SELECT dm.dept_name FROM dept dm`; const b = `SELECT dm.anything FROM unknown_table dm`;";
    expect(brokenRefs(columnRefsIn(sql), schema)).toEqual([]);
  });

  it("skips an alias bound to two tables in one statement rather than guessing", () => {
    const sql = "const q = `SELECT dm.department_name FROM dept d JOIN other dm ON 1=1`;";
    expect(brokenRefs(columnRefsIn(sql), schema)).toEqual([]);
  });

  it("does not treat prose in a SQL comment as a column use", () => {
    const sql = "const q = `SELECT dm.dept_name -- dm.department_name was the old name\n FROM dept dm`;";
    expect(brokenRefs(columnRefsIn(sql), schema)).toEqual([]);
  });

  it("does not treat a JS method call as a column", () => {
    const sql = "const q = `SELECT dm.dept_name FROM dept d WHERE id IN (${dm.join(',')})`;";
    expect(brokenRefs(columnRefsIn(sql), schema)).toEqual([]);
  });

  it("ignores template literals that contain no SQL", () => {
    expect(columnRefsIn("const s = `hello ${dm.department_name} world`;")).toEqual([]);
  });

  // --- the snapshot ------------------------------------------------------
  it("ships a schema snapshot covering the whole database", () => {
    const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot;
    expect(snap.tableCount).toBeGreaterThan(800);
    expect(Object.keys(snap.tables).length).toBe(snap.tableCount);
    expect(snap.tables.employees).toContain("employment_status");
  });

  // --- the ratchet -------------------------------------------------------
  /**
   * The baseline records the broken references that already existed when this guard was
   * added. They are real bugs, not false positives — 140 of them sit in modules/reporting/,
   * where fixing them needs a decision about what each report means, not a rename. This
   * test's job is to stop the count going UP while that work happens, and to notice when
   * a fix lets it come down.
   *
   * The explicit timeout is not padding. scanRepo() walks and parses all 1,434 .ts files
   * under src/, which measured 2.5s to 9.3s on the same machine depending on cache warmth —
   * straddling vitest's 5s default, and this project sets no global testTimeout. So the test
   * fails intermittently on timing rather than on a real broken reference, and its failure
   * message still says "New broken column reference(s)", which sends whoever sees it hunting
   * for a column bug that is not there. A guard that cries wolf is a guard people learn to
   * ignore, which costs more than the guard is worth.
   */
  it("introduces no column reference that the database cannot satisfy", () => {
    const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot;
    if (WRITE_BASELINE) {
      writeBaseline(scanRepo(snap));
      return;
    }
    const baseline: Record<string, string[]> = JSON.parse(readFileSync(BASELINE, "utf8"));

    const allowed = new Set<string>();
    for (const [file, refs] of Object.entries(baseline)) {
      for (const r of refs) allowed.add(`${file}::${r}`);
    }

    const regressions: string[] = [];
    for (const [file, refs] of scanRepo(snap)) {
      for (const r of refs) {
        if (!allowed.has(key(file, r))) regressions.push(key(file, r));
      }
    }

    expect(
      regressions,
      `New broken column reference(s). The column does not exist in mas_hrms, so this query ` +
        `throws at runtime and whatever wraps it will report nothing — or a fabricated zero.\n` +
        `Check backend/sql/schema-snapshot.json for the real column name.\n` +
        regressions.map((r) => `  - ${r}`).join("\n")
    ).toEqual([]);
  }, 60_000);

  it("keeps the baseline honest — every entry is still broken and still present", () => {
    if (WRITE_BASELINE) return;
    const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot;
    const baseline: Record<string, string[]> = JSON.parse(readFileSync(BASELINE, "utf8"));

    const live = new Set<string>();
    for (const [file, refs] of scanRepo(snap)) {
      for (const r of refs) live.add(key(file, r));
    }

    const stale: string[] = [];
    for (const [file, refs] of Object.entries(baseline)) {
      for (const r of refs) {
        if (!live.has(`${file}::${r}`)) stale.push(`${file}::${r}`);
      }
    }

    expect(
      stale,
      `Baseline entries that are no longer broken — good news. Remove them from ` +
        `schema-column-refs.baseline.json so the ratchet tightens and cannot regress:\n` +
        stale.map((s) => `  - ${s}`).join("\n")
    ).toEqual([]);
    // Same full-repo scan as the ratchet above, so the same timeout applies.
  }, 60_000);
});
