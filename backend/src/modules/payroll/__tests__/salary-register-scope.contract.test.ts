/**
 * The salary register shows what was actually run.
 *
 * TWO INDEPENDENT LIMITS, and they answer different questions:
 *
 *   * WHAT THE RUN COVERS — the register lists the run's own lines, and each line's cost centre
 *     comes from the stamp written at calculation. Deriving it from employees.cost_centre_id
 *     instead would let a later transfer rewrite a closed month: the register would move, and a
 *     cost centre that was paid could read as unpaid.
 *
 *   * WHAT THIS VIEWER MAY SEE — the existing branch/process row filter, which stays exactly as it
 *     was. A caller with no scope is refused outright rather than handed an empty workbook, because
 *     an empty file reads as "this run has no payroll" rather than "you have no access".
 *
 * Neither substitutes for the other. Dropping the first would show a Payroll Head cost centres that
 * were never run; dropping the second would hand any hr or finance user the whole organisation's
 * salary register, including decrypted account numbers.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const routes = fs.readFileSync(path.resolve(DIR, "../payroll-extended.routes.ts"), "utf8");

/** The salary-sheet export handler only. */
function exportHandler(): string {
  const start = routes.indexOf('"/runs/:id/salary-sheet-export"');
  expect(start, "salary-sheet-export route not found").toBeGreaterThan(-1);
  const next = routes.indexOf("payrollExtendedRouter.", start + 10);
  return routes.slice(start, next === -1 ? undefined : next);
}

describe("cost centre comes from the run, not from the employee's current posting", () => {
  it("reads the stamp written on the line", () => {
    expect(exportHandler()).toContain("stamped_cc.cost_centre_code");
  });

  it("joins the stamp through salary_prep_line, not through employees", () => {
    expect(exportHandler()).toContain("stamped_cc ON stamped_cc.id = spl.cost_centre_id");
  });

  it("prefers the stamp over the employee's current cost centre", () => {
    /*
     * Order inside the COALESCE is the whole behaviour. With the employee first, every stamped line
     * would still resolve to today's posting and the stamp would be decorative.
     */
    const handler = exportHandler();
    const coalesce = handler.slice(handler.indexOf("AS CostCenter") - 200, handler.indexOf("AS CostCenter"));
    expect(coalesce.indexOf("stamped_cc.cost_centre_code")).toBeLessThan(
      coalesce.indexOf("ccm.cost_centre_code"),
    );
  });

  it("still resolves a cost centre for the legacy runs, whose lines carry no stamp", () => {
    /*
     * The 104 company runs predate the stamp and are never backfilled. Without the fallback their
     * registers would render a blank CostCenter column for every row — a regression on reports
     * people already rely on.
     */
    expect(exportHandler()).toContain("ccm.cost_centre_code");
  });
});

describe("the viewer's own scope still applies", () => {
  it("row-filters to the caller's branch and process", () => {
    const handler = exportHandler();
    expect(handler).toContain("buildScopeWhereClause");
    expect(handler).toContain("e.branch_id");
  });

  it("refuses a caller with no scope rather than returning an empty workbook", () => {
    // An empty file reads as "this run has no payroll", not "you have no access" — the wrong
    // answer to a question about permission.
    const handler = exportHandler();
    expect(handler).toContain('scoped.sql === "1=0"');
    expect(handler).toContain("403");
  });
});
