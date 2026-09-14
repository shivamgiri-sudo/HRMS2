import { describe, expect, it } from "vitest";
import { REPORT_CATALOG } from "../report-catalog.js";
import { EXECUTOR_MAP } from "../executors/index.js";
import {
  IDENTITY_SPINE_COLUMNS,
  MANDATORY_IDENTITY_COLUMNS,
  identitySpineSelect,
  identitySpineJoins,
} from "../identity-spine.js";

/**
 * The mandate (2026-08-07): employee code, cost centre and process name are mandatory on
 * every report with one row per employee.
 *
 * Measured against the catalog that day: 84 of 115 reports carried employee code, 55
 * carried process, 8 carried cost centre, and 2 carried all three. This test is what stops
 * that sliding back, and what forces a deliberate decision on each new report.
 *
 * Aggregate reports are exempt: a row that is one branch, one cost centre or one month has
 * no single employee to name. The exemption is by declared rowGrain, not by guesswork.
 */

const isEmployeeGrain = (r: (typeof REPORT_CATALOG)[number]): boolean => {
  const grain = (r.rowGrain ?? "").toLowerCase();
  if (!grain.includes("per employee")) return false;
  // "One row per employee per month" is still employee-grain. "One row per branch per
  // employee count" is not — but no such grain exists; the guard below is for aggregates
  // that merely mention employees in passing.
  if (/^one row per (branch|cost cent|process|department|month|day|shift|course|asset)/.test(grain)) return false;
  return true;
};

const columnKeys = (r: (typeof REPORT_CATALOG)[number]): string[] =>
  (r.columns ?? []).map(c => c.key);

describe("identity spine helper", () => {
  it("emits every column it declares", () => {
    const sql = identitySpineSelect("e");
    for (const col of IDENTITY_SPINE_COLUMNS) {
      // A column arrives one of three ways: aliased (`... AS employee_name`), selected
      // bare off the employees alias (`e.date_of_joining`), or selected bare off one of
      // the spine's own join aliases (`spine_b.branch_name`).
      const selected = new RegExp(
        `(AS\\s+${col}\\b)|(\\be\\.${col}\\b)|(\\bspine_[a-z]+\\.${col}\\b)`
      ).test(sql);
      expect(selected, `spine SELECT does not emit ${col}`).toBe(true);
    }
  });

  it("never aliases the dialer key as a cost centre", () => {
    const sql = identitySpineSelect("e");
    expect(sql).not.toMatch(/call_centre_code/);
    expect(sql).not.toMatch(/AS\s+cc_code/i);
  });

  it("does not fall back to the legacy free-text cost_center_code", () => {
    // Of 1,125 active employees, 1,061 resolve through the FK and 64 have neither, so the
    // fallback rescues 0 rows while introducing a second spelling of the truth.
    expect(identitySpineSelect("e")).not.toMatch(/cost_center_code/);
  });

  it("joins every master with LEFT JOIN, so an unmapped employee still appears", () => {
    const joins = identitySpineJoins("e");
    const tables = [
      "branch_master",
      "department_master",
      "designation_master",
      "process_master",
      "cost_centre_master",
    ];
    for (const t of tables) {
      expect(joins, `${t} must be LEFT JOINed`).toMatch(new RegExp(`LEFT JOIN\\s+${t}\\b`));
    }
    // An INNER JOIN anywhere here would drop the 64 employees with no cost centre and the
    // 143 with no process, shrinking headcount from 1,125 without saying so.
    expect(joins).not.toMatch(/(?<!LEFT )\bJOIN\s+(branch|department|designation|process|cost_centre)_master/);
  });

  it("resolves the reporting manager through both manager columns", () => {
    // reporting_manager_id and manager_id disagree on real rows; 9 employees are mapped
    // only via manager_id, and manager-mapping exists to report that disagreement.
    expect(identitySpineJoins("e")).toMatch(
      /COALESCE\(e\.reporting_manager_id,\s*e\.manager_id\)/
    );
  });

  it("uses collision-proof aliases", () => {
    // Callers already join branch_master as `b` and process_master as `p`. A second join
    // under the same alias is a SQL error, so the spine prefixes its own.
    const joins = identitySpineJoins("e");
    for (const alias of ["spine_b", "spine_d", "spine_des", "spine_p", "spine_cc", "spine_mgr"]) {
      expect(joins).toContain(alias);
    }
  });
});

describe("the two exception reports backing the conventions", () => {
  it.each(["org-mapping-gaps", "employee-status-conflicts"])(
    "%s is registered, catalogued and reachable",
    (code) => {
      expect(Object.keys(EXECUTOR_MAP), `${code} has no executor`).toContain(code);
      const entry = REPORT_CATALOG.find(r => r.code === code);
      expect(entry, `${code} has no catalog entry, so nothing can list it`).toBeDefined();
    }
  );

  it("org-mapping-gaps names which attribute is missing", () => {
    const entry = REPORT_CATALOG.find(r => r.code === "org-mapping-gaps");
    expect(columnKeys(entry!)).toContain("missing_attributes");
  });
});

describe("mandatory identity columns on employee-grain reports", () => {
  const employeeGrain = REPORT_CATALOG.filter(isEmployeeGrain);

  it("finds employee-grain reports to check", () => {
    expect(employeeGrain.length).toBeGreaterThan(10);
  });

  /**
   * Reports the mandate does not apply to, each with the reason it does not. Two distinct
   * cases, kept together because both mean "not a gap to be closed later":
   *
   *  - a file format whose columns are dictated by an external system, where an extra
   *    column corrupts the upload;
   *  - a report marked `blocked` in the catalog because the data it needs does not exist,
   *    where adding identity columns to nothing would achieve nothing.
   */
  const EXEMPT_WITH_REASON: Record<string, string> = {
    "pf-ecr-format":
      "EPFO ECR upload file. Column set and order are dictated by EPFO (uan, gross_wages, " +
      "epf_wages, eps_wages, edli_wages, ...). Adding employee code or cost centre would " +
      "break the upload. Use pf-contribution-register for the internal view.",
    // missing-documents-report was exempted here on the grounds that it was "blocked in the
    // catalog" because no org-wide list of required documents existed. Both halves of that are
    // now false: onboarding_document_master is present, active and populated, the report was
    // built on it, and it declares employee_code, cost_centre_code, cost_centre_name and
    // process_name. The exemption is removed rather than reworded — leaving it would mean this
    // guard silently stopped checking a report that now complies, which is how an exemption list
    // rots into a blind spot.
  };

  /**
   * The mandate is about the fact being present, not about a particular spelling. Reports
   * built to a mandated workbook layout (leave-balance and its grouped header rows) carry
   * the same facts under their own names.
   */
  const SYNONYMS: Record<string, readonly string[]> = {
    employee_code: ["employee_code", "emp_code", "candidate_code"],
    cost_centre_code: ["cost_centre_code", "cost_center_code", "cost_center", "cost_centre"],
    cost_centre_name: ["cost_centre_name", "cost_center_name", "cost_center", "cost_centre"],
    process_name: ["process_name", "process"],
  };

  const hasFact = (keys: string[], fact: string): boolean =>
    (SYNONYMS[fact] ?? [fact]).some(k => keys.includes(k));

  /**
   * Reports not yet migrated to the spine. This list may only ever shrink — it is the
   * remaining work made explicit, not a permanent exemption. Delete an entry as its
   * executor gains the spine.
   *
   * 57 employee-grain reports were short of the mandate when this test was written on
   * 2026-08-07, against a catalog where only 2 of 115 reports carried all three facts.
   *
   * Every entry still listed is served by an inline `case` block in
   * report-suite.routes.ts rather than by an executor. They are deliberately left until
   * those blocks are folded into executors: adding the spine to SQL that is scheduled for
   * deletion would be wasted, and would deepen the split where one report's on-screen
   * preview, its direct XLSX and its emailed XLSX can each run a different query.
   */
  const NOT_YET_MIGRATED = new Set<string>([
    // Served by inline case blocks in report-suite.routes.ts, not by an executor — they
    // migrate when Phase 3 collapses those into executors.
    // Lives in identity.executor.ts, migrates with that file.
  ]);

  it("every migrated employee-grain report carries employee code, cost centre and process", () => {
    const offenders: string[] = [];

    for (const report of employeeGrain) {
      if (NOT_YET_MIGRATED.has(report.code)) continue;
      if (report.code in EXEMPT_WITH_REASON) continue;
      const keys = columnKeys(report);
      const missing = MANDATORY_IDENTITY_COLUMNS.filter(c => !hasFact(keys, c));
      if (missing.length > 0) offenders.push(`${report.code}: missing ${missing.join(", ")}`);
    }

    // Reported in full rather than as a count, so the next person sees the work list.
    expect(
      offenders.sort(),
      `employee-grain reports missing mandatory identity columns ` +
        `(add the spine to the executor, then the columns here):\n${offenders.sort().join("\n")}`
    ).toEqual([]);
  });
});
