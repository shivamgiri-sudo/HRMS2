import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  resolve(process.cwd(), "src/modules/reporting/executors/wfm.executor.ts"), "utf8");

/**
 * week-off-calendar filtered on `ws.shift_name = 'WO'`. wfm_shift_master holds three shifts —
 * General, Evening and Night — and no 'WO' row, so that predicate matched 0 of 413,386 roster
 * assignments and the report had never returned anything.
 *
 * The function's own doc comment said week-offs come from `is_week_off = 1 or shift_name = 'WO'`,
 * but only the half that matches nothing was ever implemented.
 *
 * Same shape as the maternity register that filtered on a hard-coded leave_code list: a literal
 * standing in for business meaning, where the literal does not exist in the data. The failure is
 * silent both times — an empty roster report looks like a quiet week.
 */
describe("week-off-calendar filter", () => {
  const block = (() => {
    const start = src.indexOf("export async function weekOffCalendar");
    expect(start, "weekOffCalendar not found").toBeGreaterThan(-1);
    const end = src.indexOf("export async function", start + 10);
    return src.slice(start, end === -1 ? src.length : end);
  })();

  const code = block.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  it("selects week-offs by is_week_off, the column that carries the meaning", () => {
    expect(code).toMatch(/wra\.is_week_off\s*=\s*1/);
  });

  it("does not filter on a shift named 'WO', which does not exist", () => {
    // If a 'WO' shift is ever created this test should be revisited deliberately — but it must
    // not come back as the ONLY filter, which is how the report returned nothing.
    expect(code).not.toMatch(/shift_name\s*=\s*'WO'/);
  });

  it("still reports cost centre and process", () => {
    // Mandatory on an employee-grain report; a week-off calendar that cannot be read by cost
    // centre cannot be checked against payroll's week-off entitlement.
    expect(code).toContain("cost_centre_code");
    expect(code).toContain("cost_centre_name");
    expect(code).toContain("process_name");
  });
});
