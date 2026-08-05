/**
 * Superseding a salary assignment must close the old row's validity window, not
 * just clear its active flag.
 *
 * All three write paths set active_status = 0 and left effective_to NULL, which is
 * true of every one of the 230 superseded rows in production. A row reading
 * "effective from 2024-04-01" with no end date cannot answer "what was this
 * employee's CTC on a given date" — which is exactly what reproducing an older
 * payroll run, or an audit of one, has to do.
 *
 * This is also why the point-in-time salary lookup in payrollCalculate.service.ts
 * had to key on effective_from and could not use effective_to: there was nothing
 * in it to read. These two changes are independent on purpose — the calculation is
 * correct whether or not this backfills going forward.
 *
 * Scope: forward-looking only. Existing rows are not backfilled here; that is a
 * data change requiring approval, not a code change.
 *
 * Verified against production via EXPLAIN (writes nothing): the statement is
 * index-backed, DATE_SUB('2026-09-01', INTERVAL 1 DAY) closes the prior row on
 * 2026-08-31, and COALESCE preserves an end date that was already recorded.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PAYROLL = readFileSync(resolve(process.cwd(), "src/modules/payroll/payroll.service.ts"), "utf8");
const INCREMENT = readFileSync(
  resolve(process.cwd(), "src/modules/salary-increment/salaryIncrement.service.ts"),
  "utf8",
);

/** Every statement that deactivates an assignment, across both services. */
function deactivationStatements(): string[] {
  const out: string[] = [];
  for (const src of [PAYROLL, INCREMENT]) {
    const re = /UPDATE employee_salary_assignment[\s\S]{0,400}?active_status = 1`/g;
    for (const m of src.matchAll(re)) out.push(m[0]);
  }
  return out;
}

describe("every salary-assignment deactivation closes effective_to", () => {
  it("finds all three known write paths", () => {
    // assignSalary + bulkAssignSalary (payroll.service.ts) and the increment
    // implement step (salaryIncrement.service.ts). If this count changes, a new
    // write path appeared and needs the same treatment.
    expect(deactivationStatements()).toHaveLength(3);
  });

  it("sets effective_to alongside active_status in each of them", () => {
    for (const stmt of deactivationStatements()) {
      expect(stmt, `a deactivation still leaves effective_to NULL:\n${stmt}`).toMatch(
        /effective_to = COALESCE\(effective_to, DATE_SUB\(\?, INTERVAL 1 DAY\)\)/,
      );
    }
  });

  it("closes the old row the day before the new one takes effect, never on the same day", () => {
    // Same-day would leave two rows both claiming the changeover date, so a
    // point-in-time lookup could legitimately return either.
    for (const stmt of deactivationStatements()) {
      expect(stmt).toContain("INTERVAL 1 DAY");
      expect(stmt).not.toMatch(/effective_to = \?/);
    }
  });

  it("never overwrites an end date that was already recorded", () => {
    // assignSalary accepts an explicit effectiveTo on the incoming row; a blind
    // assignment here would discard a deliberately recorded window.
    for (const stmt of deactivationStatements()) {
      expect(stmt).toMatch(/COALESCE\(effective_to,/);
    }
  });
});

describe("the closing date comes from the incoming assignment", () => {
  it("assignSalary binds input.effectiveFrom before the employee id", () => {
    expect(PAYROLL).toMatch(/\[input\.effectiveFrom, input\.employeeId\]/);
  });

  it("bulkAssignSalary binds input.effectiveFrom ahead of the id list", () => {
    // The IN (...) placeholders follow the SET clause, so the date must bind first
    // or every employee id shifts one position and the update silently misfires.
    expect(PAYROLL).toMatch(/\[input\.effectiveFrom, \.\.\.ids\]/);
  });

  it("the increment path binds the request's effective_from", () => {
    expect(INCREMENT).toMatch(/\[req\.effective_from, req\.employee_id\]/);
  });
});
