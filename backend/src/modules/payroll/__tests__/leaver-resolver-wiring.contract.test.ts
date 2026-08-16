/**
 * §9 — selection and proration must use the SAME employment end resolver.
 *
 * employment-end-date.test.ts already covers the resolver thoroughly: precedence, all six
 * scenarios the ruling named, and payableThrough's capping. Every one of those exercises the
 * helper IN ISOLATION, which means none of them can see the failure this file exists to catch —
 * payrollCalculate.service.ts quietly growing a second, divergent leaver bound. All 18 would
 * still pass while an employee was selected on one definition of "employed" and paid on another,
 * which is precisely the defect the ruling was issued to end.
 *
 * That is not hypothetical here. Before the ruling this service selected on
 * employees.date_of_leaving (NULL on all 58,840 rows, so inert) and prorated on the same dead
 * column, while the only thing actually excluding leavers was employment_status = 'active' — a
 * different question, wrong in both directions.
 *
 * Re-verified against live data 2026-08-17, not just asserted here:
 *   2026-07 selection 1,327 · 2026-08 selection 1,233 — both matching the shipped figures
 *   flood check 0 of the end-dateless non-actives admitted
 *   165 mid-month leavers, 193 joiners, 12 terminated, 76 non-active with a resolvable end date
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EMPLOYMENT_END_DATE_SELECT } from "../employment-end-date.js";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
/** The service documents the OLD behaviour at length; assert on code, never on the prose. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const CALC = stripComments(read("src/modules/payroll/payrollCalculate.service.ts"));

describe("the calculation service is wired to the one resolver", () => {
  it("selects the run population with employmentWindowPredicate()", () => {
    expect(CALC).toContain("employmentWindowPredicate()");
  });

  it("fetches the end date with the SAME resolver, not a hand-rolled expression", () => {
    expect(CALC).toContain("EMPLOYMENT_END_DATE_SELECT");
    expect(CALC).toContain("AS employment_end_date");
  });

  it("prorates through the fetched value, so selection and payment cannot diverge", () => {
    expect(CALC).toContain("payableThrough(emp.employment_end_date");
  });

  it("resolves the end date BEFORE it is prorated on", () => {
    const fetched = CALC.indexOf("AS employment_end_date");
    const prorated = CALC.indexOf("payableThrough(emp.employment_end_date");
    expect(fetched).toBeGreaterThan(-1);
    expect(prorated).toBeGreaterThan(fetched);
  });
});

describe("no second leaver definition may reappear", () => {
  it("has no live date_of_leaving predicate", () => {
    // The column is NULL on all 58,840 rows. Any predicate on it is inert by construction, and
    // an inert leaver bound reads as a working control — which is how this went unnoticed.
    expect(CALC).not.toMatch(/date_of_leaving\s*(IS\s+NULL|>=|<=|<|>)/i);
  });

  it("has no standalone employment_status = 'active' filter on the run population", () => {
    // Status is folded INTO the window predicate, and only as the end-date-NULL arm. A separate
    // status filter would re-exclude the mid-month leavers the ruling exists to pay.
    expect(CALC).not.toMatch(/employment_status\s*\)?\s*=\s*'active'/i);
    expect(CALC).not.toMatch(/LOWER\(\s*e\.employment_status\s*\)\s*=\s*'active'/i);
  });

  it("does not read date_of_exit directly — precedence belongs to the resolver", () => {
    // date_of_exit is rank 2 INSIDE the resolver. Reading it here would skip the exit_request
    // LWD that outranks it, and pay a leaver to the wrong day.
    expect(CALC).not.toMatch(/e\.date_of_exit/);
  });
});

describe("the resolver keeps its timezone-safe shape", () => {
  it("hands the end date to JS as a formatted string, never a DATE", () => {
    // mysql2 returns a DATE as a host-timezone JS Date, and on a leaver bound a one-day shift is
    // the difference between a paid and an unpaid final working day.
    expect(String(EMPLOYMENT_END_DATE_SELECT)).toContain("DATE_FORMAT");
    expect(String(EMPLOYMENT_END_DATE_SELECT)).toContain("%Y-%m-%d");
  });
});
