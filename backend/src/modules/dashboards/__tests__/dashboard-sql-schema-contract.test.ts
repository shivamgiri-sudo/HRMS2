import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

import {
  buildSqlSchemaSnapshot,
  columnSource,
  hasColumn,
  hasTable,
} from "../../../shared/sqlSchemaSnapshot.js";
import { DASHBOARD_SQL_MANIFEST } from "../../../shared/dashboardSqlManifest.js";

/**
 * Guards the class of bug that produced both the payroll dashboard's hard 500 and the
 * CEO KPI panel's permanent emptiness: SQL referencing a column that does not exist.
 *
 * MySQL resolves identifiers before evaluating expressions, so wrapping an unknown
 * column in COALESCE() does not save it — it still raises ER_BAD_FIELD_ERROR. And
 * because these reads swallow their errors to degrade gracefully, the failure looked
 * exactly like "no data". Parsing the migrations catches it with no database.
 */
const SQL_DIR = resolve(__dirname, "../../../../sql");
const snapshot = buildSqlSchemaSnapshot(SQL_DIR);

describe("dashboard SQL schema contract", () => {
  it("parses the migration corpus into a usable schema snapshot", () => {
    // Sanity check the parser itself — a silently empty snapshot would make every
    // assertion below vacuously pass.
    expect(snapshot.allFiles.length).toBeGreaterThan(400);
    expect(snapshot.tables.size).toBeGreaterThan(200);
    expect(hasTable(snapshot, "employees")).toBe(true);
    expect(hasColumn(snapshot, "employees", "branch_id")).toBe(true);
    expect(hasColumn(snapshot, "salary_prep_line", "gross_salary")).toBe(true);
  });

  it("every table the dashboard SQL reads is created by some migration", () => {
    const missing = DASHBOARD_SQL_MANIFEST.filter(
      (dep) => !dep.optional && !hasTable(snapshot, dep.table),
    ).map((dep) => `${dep.table} (read by ${dep.usedBy})`);

    expect(missing, `Tables referenced by dashboard code but never created:\n  ${missing.join("\n  ")}`)
      .toEqual([]);
  });

  it("every column the dashboard SQL reads exists in some migration", () => {
    const missing: string[] = [];
    for (const dep of DASHBOARD_SQL_MANIFEST) {
      if (dep.optional && !hasTable(snapshot, dep.table)) continue;
      for (const column of dep.columns) {
        if (!hasColumn(snapshot, dep.table, column)) {
          missing.push(`${dep.table}.${column} — read by ${dep.usedBy}`);
        }
      }
    }

    expect(
      missing,
      `Columns referenced by dashboard code that exist in no migration:\n  ${missing.join("\n  ")}\n\n` +
        `These raise ER_BAD_FIELD_ERROR at runtime. If the column was renamed, update the ` +
        `query; if it is genuinely new, add an additive migration.`,
    ).toEqual([]);
  });

  it("reports dashboard columns supplied only by migrations the runner does not source", () => {
    // Not a failure: several unsourced migrations ARE applied in production, so the
    // runner is a lower bound on the real schema. But a fresh environment built purely
    // from 000_run_all.sql would lack these, so they must stay visible.
    const unsourced: string[] = [];
    for (const dep of DASHBOARD_SQL_MANIFEST) {
      for (const column of dep.columns) {
        const origin = columnSource(snapshot, dep.table, column);
        if (origin && !snapshot.sourcedFiles.has(origin)) {
          unsourced.push(`${dep.table}.${column} <- ${origin}`);
        }
      }
    }

    // Assert only that we can compute it; the list is informational.
    expect(Array.isArray(unsourced)).toBe(true);
    if (unsourced.length > 0) {
      console.warn(
        `[schema-drift] dashboard columns from migrations absent from 000_run_all.sql:\n  ` +
          unsourced.join("\n  "),
      );
    }
  });

  it("pins the specific columns that caused the payroll 500 and the empty KPI panel", () => {
    // Regression pins. If any of these ever parse as present, either a migration added
    // them (fine — delete the pin) or the parser regressed (not fine).
    expect(hasColumn(snapshot, "salary_prep_run", "run_label")).toBe(false);
    expect(hasColumn(snapshot, "salary_prep_run", "closed_at")).toBe(false);
    expect(hasColumn(snapshot, "salary_prep_line", "gross_pay")).toBe(false);
    expect(hasColumn(snapshot, "salary_prep_line", "net_pay")).toBe(false);
    expect(hasColumn(snapshot, "salary_prep_line", "gross_amount")).toBe(false);
    expect(hasColumn(snapshot, "salary_prep_line", "net_amount")).toBe(false);
    expect(hasColumn(snapshot, "kpi_daily_actual", "score_pct")).toBe(false);
    expect(hasColumn(snapshot, "kpi_daily_actual", "record_date")).toBe(false);
    expect(hasColumn(snapshot, "kpi_daily_actual", "process_id")).toBe(false);

    // ...and the replacements those queries must use instead.
    expect(hasColumn(snapshot, "salary_prep_run", "auto_closed_at")).toBe(true);
    expect(hasColumn(snapshot, "salary_prep_line", "gross_salary")).toBe(true);
    expect(hasColumn(snapshot, "salary_prep_line", "net_salary")).toBe(true);
    expect(hasColumn(snapshot, "kpi_daily_actual", "score_date")).toBe(true);
    expect(hasColumn(snapshot, "kpi_daily_actual", "actual_value")).toBe(true);
  });
});
