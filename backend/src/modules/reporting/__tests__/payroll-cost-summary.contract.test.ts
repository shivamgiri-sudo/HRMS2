import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_CATALOG } from "../report-catalog.js";
import { EXECUTOR_MAP } from "../executors/index.js";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/**
 * Payroll → Cost Summary was a dead menu item. `payrollCostSummary` had been
 * registered and working the whole time, but "payroll-cost-summary" appeared in
 * neither the backend nor the frontend catalog, so the Report Library had nothing to
 * list and the deep link from /payroll/cost-summary resolved to an empty selection.
 * Visible to super_admin, payroll_head and finance; usable by none of them.
 *
 * Found by the frontend deep-link reachability test, not by anything here — the
 * backend had no check that a registered executor is reachable, or that a catalog
 * entry describes the columns its executor actually returns.
 *
 * Verified against mas_hrms for 2026-07 on 2026-08-06: 146 groups, 70 with non-zero
 * gross, summing to 14,965,032.41 — equal to that run's total, so the aggregation
 * neither drops nor double-counts a line.
 */
const CODE = "payroll-cost-summary";

/** Exactly what the executor's SELECT list produces, in order. */
const EXPECTED_COLUMNS = [
  "branch_name",
  "process_name",
  "department_name",
  // Cost centre added on request. The executor now GROUPs by it, so this report's grain
  // changed: money columns split by cost centre instead of repeating a branch/process total.
  "cost_centre_code",
  "cost_centre_name",
  "run_month",
  "employee_count",
  "total_gross",
  "total_pf_employer",
  "total_esic_employer",
  "total_ctc",
  "total_net",
];

const executorSource = read("src/modules/reporting/executors/payroll.executor.ts");

const body = (() => {
  const start = executorSource.indexOf("export async function payrollCostSummary(");
  expect(start, "payrollCostSummary not found").toBeGreaterThan(-1);
  const next = executorSource.indexOf("\nexport async function ", start + 1);
  return executorSource.slice(start, next === -1 ? executorSource.length : next);
})();

describe("payroll cost summary", () => {
  it("is registered as an executor", () => {
    expect(Object.keys(EXECUTOR_MAP)).toContain(CODE);
  });

  it("has a catalog entry, so the library can list it and the deep link resolves", () => {
    // Without this the Payroll → Cost Summary menu item goes nowhere, which is the
    // whole defect: a working query nobody could reach.
    expect(REPORT_CATALOG.find(r => r.code === CODE)).toBeDefined();
  });

  it("declares exactly the columns the executor returns", () => {
    const entry = REPORT_CATALOG.find(r => r.code === CODE)!;
    expect(entry.columns.map(c => c.key)).toEqual(EXPECTED_COLUMNS);
  });

  it("still produces every declared column in its SQL", () => {
    // Guards the other direction: if the SELECT list is edited, the catalog must move
    // with it, or the grid renders blank columns and drops values that were returned.
    for (const key of EXPECTED_COLUMNS) {
      expect(body, `SELECT list no longer produces ${key}`).toMatch(
        new RegExp(`(AS\\s+${key}\\b|\\.${key}\\b)`),
      );
    }
  });

  it("keeps employer-cost columns marked sensitive and classified as financial", () => {
    // Matches the sibling cost reports (cost-centre-salary-summary,
    // process-lob-salary-cost). 'restricted' means non-super-admins are routed to
    // email delivery rather than immediate download — deliberate for salary cost.
    const entry = REPORT_CATALOG.find(r => r.code === CODE)!;
    expect(entry.sensitivityLevel).toBe("restricted");
    expect(entry.containsFinancialData).toBe(true);

    for (const key of ["total_gross", "total_pf_employer", "total_esic_employer", "total_ctc", "total_net"]) {
      expect(entry.columns.find(c => c.key === key)?.sensitive, `${key} not marked sensitive`).toBe(true);
    }
  });

  it("grants the report to every role the menu offers it to", () => {
    // navConfig exposes /payroll/cost-summary to payroll_head, who is absent from
    // ROLES_PAYROLL. Using that set here would have listed the report and then denied
    // it — a dead link of a subtler kind.
    const entry = REPORT_CATALOG.find(r => r.code === CODE)!;
    for (const role of ["super_admin", "payroll_head", "finance"]) {
      expect(entry.viewRoles, `${role} can see the menu item but not the report`).toContain(role);
    }
  });

  it("aggregates rather than listing individual employees", () => {
    // The grain is the reason this is branch/process/department cost and carries no
    // PII. Losing the GROUP BY would turn it into a per-employee salary listing at a
    // sensitivity classified for aggregates.
    expect(body).toContain("GROUP BY");
    expect(REPORT_CATALOG.find(r => r.code === CODE)!.containsPII).toBe(false);
  });
});
