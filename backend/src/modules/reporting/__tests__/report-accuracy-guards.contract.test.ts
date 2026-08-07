import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_CATALOG } from "../report-catalog.js";

/**
 * Guards for the three defect classes found by running the reports' own SQL against
 * live mas_hrms on 2026-08-07. Each `it` below fails on the code as it stood that day.
 *
 * 1. CC_HEADCOUNT had no active filter at all, so it counted every employee row ever
 *    created: 58,627 against a true active headcount of 1,125 — a 52x overstatement.
 *    It also grouped by call_centre_code, which is NULL in all 58,627 rows, so it
 *    silently fell back to branch. A call-centre report wearing a cost-centre name.
 *
 * 2. `headcount` filtered on active_status AND employment_status (1,123) while
 *    `employee-master` filtered on active_status alone (1,125). Two answers to one
 *    question. Ruling of 2026-08-07: active_status = 1 is the single definition.
 *
 * 3. 22 of 60 tables named in catalog `sourceTables` do not exist in production.
 *    schema-snapshot.json is a faithful mirror of live (883 tables, verified equal to
 *    information_schema on 2026-08-07), so it is the oracle here — no DB needed.
 *    Note information_schema returns UPPERCASE keys through mysql2, which silently
 *    inverts naive assertions; reading the snapshot avoids that trap entirely.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const LIVE_TABLES: ReadonlySet<string> = (() => {
  const snapshot = JSON.parse(read("sql/schema-snapshot.json")) as {
    generatedFrom: string;
    tables: Record<string, unknown>;
  };
  expect(snapshot.generatedFrom, "snapshot must be of mas_hrms").toBe("mas_hrms");
  return new Set(Object.keys(snapshot.tables));
})();

/** Slice one function body out of a source file, for targeted assertions. */
const functionBody = (source: string, signature: string): string => {
  const start = source.indexOf(signature);
  expect(start, `${signature} not found`).toBeGreaterThan(-1);
  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
};

describe("cc_headcount counts only active employees", () => {
  const source = read("src/modules/reporting/reporting.service.ts");
  const query = (() => {
    const start = source.indexOf("cc_headcount:");
    expect(start, "cc_headcount builder not found").toBeGreaterThan(-1);
    // Builders are comma-separated entries in the QUERIES map; stop at the next one.
    const next = source.indexOf("\n  employee_dir:", start);
    return source.slice(start, next === -1 ? start + 2000 : next);
  })();

  it("filters on active_status, so it cannot report 58,627 for a 1,125-person company", () => {
    expect(query).toMatch(/active_status\s*=\s*1/);
  });

  it("does not present a call-centre grouping as a cost centre", () => {
    // call_centre_code is a dialer/biometric integration key. If this report keeps it,
    // its registered name must say so — the cost centre is a separate FK on employees
    // and is served by the `cost-centre-headcount` report in the suite.
    //
    // The rename ships as migration 1084 rather than an edit to 049, which is already
    // applied in production.
    if (/call_centre_code/.test(query)) {
      const rename = read("sql/1084_cc_headcount_disambiguate_cost_vs_call_centre.sql");
      expect(
        /Call Centre \(Dialer\) Headcount/.test(rename),
        "report groups by call_centre_code, so its registered name must disambiguate it from cost centre",
      ).toBe(true);
    }
  });

  it("never aliases the dialer key as a cost-centre-looking column", () => {
    // The original emitted `AS cc_code` while a sibling join aliased cost_centre_master
    // as `cc` — two different CCs in one result set.
    expect(query).not.toMatch(/AS\s+cc_code/i);
  });
});

describe("one definition of an active employee", () => {
  const source = read("src/modules/reporting/executors/employee.executor.ts");

  it("headcount and employee-master agree, both filtering on active_status alone", () => {
    const headcount = functionBody(source, "export async function headcount(");
    // The employment_status conjunct excluded 2 real employees on 2026-08-07 and made
    // headcount disagree with every other employee-grain report.
    expect(headcount).not.toMatch(/employment_status/);
    expect(headcount).toMatch(/active_status\s*=\s*1/);
  });
});

describe("every declared source table exists in production", () => {
  const withSources = REPORT_CATALOG.filter(
    (r): r is typeof r & { sourceTables: string[] } =>
      Array.isArray((r as { sourceTables?: unknown }).sourceTables),
  );

  it("has a catalog to check", () => {
    expect(withSources.length).toBeGreaterThan(0);
  });

  it("names no table that is absent from mas_hrms", () => {
    // A dotted name is a cross-database source (db_audit.call_quality_assessment,
    // Shivamgiri.v_call_master_unified_kpi). This snapshot is of mas_hrms alone and
    // cannot adjudicate those.
    const isCrossDatabase = (table: string) => table.includes(".");

    // asset_movement_log has no equivalent anywhere; asset-movement-log is marked
    // blocked and its executor throws ReportSourceUnavailableError naming the table.
    // Keeping it in sourceTables is what documents *why* the report is blocked.
    const BLOCKED_BY_DESIGN = new Set(["asset_movement_log"]);

    const phantom = withSources
      .flatMap(r => r.sourceTables.map(table => ({ code: r.code, table })))
      .filter(({ table }) => !isCrossDatabase(table) && !BLOCKED_BY_DESIGN.has(table))
      .filter(({ table }) => !LIVE_TABLES.has(table));

    const detail = [...new Set(phantom.map(p => `${p.table} (${p.code})`))].sort();
    expect(detail, `sourceTables naming non-existent tables:\n${detail.join("\n")}`).toEqual([]);
  });
});

describe("no executor queries a table that does not exist", () => {
  const EXECUTOR_FILES = [
    "employee",
    "attendance",
    "leave",
    "payroll",
    "statutory",
    "exit",
    "recruitment",
    "operations",
    "wfm",
    "assets",
    "lms",
    "identity",
    "governance",
  ];

  /**
   * Only SQL counts. English prose says "derived from the roster" and "joined to the
   * ledger", and a bare FROM/JOIN regex reads those as table names — that noise buried
   * the seven real hits on the first run.
   *
   * SQL in this codebase always lives in template literals, so scan those and nothing
   * else, then drop `--` comments inside them (which carry prose of their own).
   */
  const sqlOnly = (source: string): string =>
    [...source.matchAll(/`([^`]*)`/g)]
      .map(([, body]) => body.replace(/--[^\n]*/g, " "))
      .join("\n");

  /**
   * Tables an executor may reference despite being absent from mas_hrms, because it
   * handles the absence *visibly* rather than returning an empty result. Each entry
   * needs a reason — this list is not a place to park a silent failure.
   */
  const HANDLED_ABSENT: Record<string, string> = {
    form_16_record:
      "form16Status probes it and falls back to a query over employees that reports every " +
      "employee as NOT_GENERATED — true, and visible, when no Form 16 exists.",
    asset_movement_log:
      "assetMovementLog throws ReportSourceUnavailableError naming the table; the catalog " +
      "entry is marked blocked. No equivalent exists (asset_service_log is servicing, not custody).",
    leave_encashment_request:
      "leaveEncashmentRegister throws ReportSourceUnavailableError naming the table; the " +
      "catalog entry is marked blocked.",
  };

  it("resolves every FROM and JOIN target against the live schema", () => {
    const offenders: string[] = [];

    for (const name of EXECUTOR_FILES) {
      const source = sqlOnly(read(`src/modules/reporting/executors/${name}.executor.ts`));
      // Real table references only: FROM/JOIN followed by a bare snake_case identifier.
      // Subqueries "FROM (" and template interpolation "FROM ${" are skipped by the pattern.
      // A trailing "." means a cross-database reference (db_audit.call_quality_assessment),
      // which this snapshot of mas_hrms cannot and should not adjudicate.
      const matches = source.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)(\.)?/gi);
      for (const [, table, qualified] of matches) {
        if (qualified) continue;
        const t = table.toLowerCase();
        if (["select", "dual", "lateral", "unnest"].includes(t)) continue;
        if (t in HANDLED_ABSENT) continue;
        if (!LIVE_TABLES.has(t)) offenders.push(`${t} (${name}.executor.ts)`);
      }
    }

    const detail = [...new Set(offenders)].sort();
    expect(detail, `executors querying non-existent tables:\n${detail.join("\n")}`).toEqual([]);
  });
});
