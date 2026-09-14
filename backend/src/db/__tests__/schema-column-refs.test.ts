import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { columnRefsIn, brokenRefs, unknownWriteTargets, writeColumnRefs, type ColumnRef } from "./schema-column-refs.js";

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
const TABLE_BASELINE = resolve(HERE, "schema-unknown-tables.baseline.json");
const WRITE_COL_BASELINE = resolve(HERE, "schema-write-columns.baseline.json");

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


  it("sees write targets the column scanner is blind to", () => {
    const known = { leave_request: ["id"] };
    // None of these yield a single column ref, which is how three broken
    // statements survived in the exit flow.
    expect(unknownWriteTargets("const q = `UPDATE leave_requests SET status = ?`;", known)).toEqual(["leave_requests"]);
    expect(unknownWriteTargets("const q = `INSERT INTO leave_requests (id) VALUES (?)`;", known)).toEqual(["leave_requests"]);
    expect(unknownWriteTargets("const q = `DELETE FROM leave_requests WHERE id = ?`;", known)).toEqual(["leave_requests"]);
    expect(unknownWriteTargets("const q = `UPDATE leave_request SET status = ?`;", known)).toEqual([]);
  });

  it("does not treat prose in a template literal as a write", () => {
    expect(unknownWriteTargets("const s = `update the leave_requests page`;", {})).toEqual([]);
    expect(unknownWriteTargets("const s = `SELECT 1`;", {})).toEqual([]);
  });


  it("sees columns inside writes, which the column scanner cannot", () => {
    const known = { upload_batch_row: ["id", "row_status", "error_messages"] };
    const bad = (sql: string) => brokenRefs(writeColumnRefs(sql), known).map((r) => `${r.table}.${r.column}`);

    expect(bad("const q = `UPDATE upload_batch_row SET row_status = 'error', error_message = ? WHERE id = ?`;"))
      .toEqual(["upload_batch_row.error_message"]);
    expect(bad("const q = `UPDATE upload_batch_row SET row_status = 'error', error_messages = ? WHERE id = ?`;"))
      .toEqual([]);
    expect(bad("const q = `INSERT INTO upload_batch_row (id, error_message) VALUES (?, ?)`;"))
      .toEqual(["upload_batch_row.error_message"]);
  });

  it("skips writes it cannot attribute with certainty", () => {
    const known = { upload_batch_row: ["id"] };
    const bad = (sql: string) => brokenRefs(writeColumnRefs(sql), known);
    // dynamic column list
    expect(bad("const q = `UPDATE upload_batch_row SET ${sets.join(',')} WHERE id = ?`;")).toEqual([]);
    // multi-table update: a SET column could belong to either side
    expect(bad("const q = `UPDATE upload_batch_row JOIN u ON u.id = upload_batch_row.id SET zzz = ?`;")).toEqual([]);
    // qualified assignment
    expect(bad("const q = `UPDATE upload_batch_row SET upload_batch_row.zzz = ?`;")).toEqual([]);
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


  // --- the table ratchet -------------------------------------------------
  /**
   * The column ratchet above cannot see a query that names a table which does not
   * exist at all — brokenRefs() skips unknown tables on purpose, because most of
   * them are CTEs, derived-table aliases or tables in another database.
   *
   * That gap hid a real defect for months. exit.service's `exited` branch wrote to
   * `employee_asset_assignment` (no such table) and `leave_requests` (the table is
   * `leave_request`), both inside a .catch() that logged a warning and let the exit
   * report success, so no exit ever revoked LMS access or cancelled leave.
   *
   * This baseline therefore contains genuine noise alongside genuine bugs, and that
   * is fine: the job is to stop the list growing. A newly invented table name fails
   * here even though the column guard cannot see it.
   */
  it("introduces no write to a table the database does not have", () => {
    const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot;

    const found = new Map<string, string[]>();
    for (const file of tsFilesUnder(SRC_DIR)) {
      const tables = unknownWriteTargets(readFileSync(file, "utf8"), snap.tables);
      if (tables.length) found.set(relative(SRC_DIR, file).split(sep).join("/"), tables);
    }

    if (WRITE_BASELINE) {
      const out: Record<string, string[]> = {};
      for (const [file, tables] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
        out[file] = tables;
      }
      writeFileSync(TABLE_BASELINE, JSON.stringify(out, null, 2) + "\n");
      return;
    }

    const baseline: Record<string, string[]> = JSON.parse(readFileSync(TABLE_BASELINE, "utf8"));
    const allowed = new Set<string>();
    for (const [file, tables] of Object.entries(baseline)) {
      for (const t of tables) allowed.add(`${file}::${t}`);
    }

    const regressions: string[] = [];
    for (const [file, tables] of found) {
      for (const t of tables) {
        if (!allowed.has(`${file}::${t}`)) regressions.push(`${file}::${t}`);
      }
    }

    expect(
      regressions,
      `Query names a table that is not in mas_hrms. If it is a CTE or a table in ` +
        `another database, add it to schema-unknown-tables.baseline.json. If it is a ` +
        `typo or a renamed table, the statement throws at runtime — and if it is ` +
        `wrapped in a .catch(), it fails silently and the caller reports success.\n` +
        regressions.map((r) => `  - ${r}`).join("\n")
    ).toEqual([]);
  }, 60_000);


  // --- the write-column ratchet ------------------------------------------
  /**
   * Neither guard above looks inside a write. columnRefsIn() yields only
   * alias-qualified columns from SELECT/FROM/JOIN, and the table ratchet checks
   * the table name and stops there - so `INSERT INTO t (a, b)` and
   * `UPDATE t SET a = ?` name columns that nothing validates.
   *
   * Seven bulk-upload services wrote error_message when the column is
   * error_messages. The statement sat inside the per-row catch, so one failing
   * row made the handler itself throw and aborted the entire upload with a
   * message about a column rather than about the row.
   */
  it("introduces no write naming a column its table does not have", () => {
    const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot;

    const found = new Map<string, string[]>();
    for (const file of tsFilesUnder(SRC_DIR)) {
      const bad = brokenRefs(writeColumnRefs(readFileSync(file, "utf8")), snap.tables);
      if (bad.length) {
        found.set(
          relative(SRC_DIR, file).split(sep).join("/"),
          bad.map((r) => `${r.table}.${r.column}`).sort()
        );
      }
    }

    if (WRITE_BASELINE) {
      const out: Record<string, string[]> = {};
      for (const [file, refs] of [...found].sort(([a], [b]) => a.localeCompare(b))) out[file] = refs;
      writeFileSync(WRITE_COL_BASELINE, JSON.stringify(out, null, 2) + "\n");
      return;
    }

    const baseline: Record<string, string[]> = JSON.parse(readFileSync(WRITE_COL_BASELINE, "utf8"));
    const allowed = new Set<string>();
    for (const [file, refs] of Object.entries(baseline)) {
      for (const r of refs) allowed.add(`${file}::${r}`);
    }

    const regressions: string[] = [];
    for (const [file, refs] of found) {
      for (const r of refs) {
        if (!allowed.has(`${file}::${r}`)) regressions.push(`${file}::${r}`);
      }
    }

    expect(
      regressions,
      `A write names a column its table does not have, so the statement throws ` +
        `ER_BAD_FIELD_ERROR at runtime. If it sits in a catch, the failure is ` +
        `invisible - or worse, the handler throws from inside itself.\n` +
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
