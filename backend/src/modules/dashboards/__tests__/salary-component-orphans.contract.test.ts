/**
 * Salary-component metrics must be anchored on the parent payroll line, not on
 * run_id alone.
 *
 * salary_prep_line_component carries denormalised run_id and employee_id columns
 * and has no foreign key to salary_prep_line — confirmed against the live schema,
 * where it is one of only two payroll tables with no FK at all. Deleting a payroll
 * line therefore leaves its component rows behind, still pointing at a run that
 * exists. Production holds 9,841 such orphans spread across 16 run-months
 * (2025-04 through 2026-06), including under FINALIZED runs.
 *
 * Both dashboard component queries filtered by c.run_id and joined only to
 * employees, so every one of those orphans was counted: component totals, distinct
 * employee counts and earning sums were all inflated whenever the affected month
 * was the latest run. 2025-12 alone carries 861 orphans across 126 employees.
 *
 * The payslip paths were never affected — payroll.routes.ts and payslip.service.ts
 * both look components up by line_id from an existing line, so an orphan cannot be
 * reached from them. This is a reporting defect, not a pay defect.
 *
 * Verified against production: with the line join added, the current run returns
 * identical figures (10 codes / 1171 employees / 14,944,282.63) because 2026-07
 * happens to hold no orphans, at no measurable cost in query time. The join is
 * what keeps that true for months that do.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const METRIC = readFileSync(
  resolve(process.cwd(), "src/modules/dashboards/dashboard-metric.service.ts"),
  "utf8",
);
const DRILLDOWN = readFileSync(
  resolve(process.cwd(), "src/modules/dashboards/dashboard-drilldown.service.ts"),
  "utf8",
);

/** The component query in each file: from the FROM clause to the end of its WHERE. */
function componentQuery(source: string): string {
  const start = source.indexOf("FROM salary_prep_line_component c");
  expect(start, "component query not found").toBeGreaterThan(-1);
  return source.slice(start, start + 900);
}

describe("dashboard component metrics exclude orphaned component rows", () => {
  for (const [name, src] of [
    ["dashboard-metric.service.ts", METRIC],
    ["dashboard-drilldown.service.ts", DRILLDOWN],
  ] as const) {
    it(`${name} joins salary_prep_line so a deleted line's components drop out`, () => {
      const q = componentQuery(src);
      expect(
        q,
        "filtering on run_id alone counts components whose payroll line was deleted",
      ).toMatch(/JOIN salary_prep_line l ON l\.id = c\.line_id/);
    });

    it(`${name} still scopes to a single run`, () => {
      // The line join must supplement the run filter, not replace it — dropping the
      // run scope would aggregate every payroll run ever calculated.
      expect(componentQuery(src)).toMatch(/c\.run_id = \(/);
    });
  }
});

describe("payslip reads stay anchored on line_id", () => {
  it("the per-line payslip breakdown looks components up by line_id", () => {
    const payslipService = readFileSync(
      resolve(process.cwd(), "src/modules/payroll/payslip.service.ts"),
      "utf8",
    );
    // If this ever becomes a run_id/employee_id lookup, orphaned components would
    // reach an actual payslip, which is a different and much worse problem.
    expect(payslipService).toMatch(/FROM salary_prep_line_component\s+WHERE line_id = \?/);
  });
});
