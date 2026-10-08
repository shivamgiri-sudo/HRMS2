/**
 * Payroll must calculate a run with the salary that was in force during that
 * run's month, not whatever assignment happens to be active today.
 *
 * The employee/salary join was `ON esa.employee_id = e.id` filtered by
 * `esa.active_status = 1`, with no reference to the run month at all. Because
 * payroll-nightly-recalc.worker.ts re-runs every open run each night, entering a
 * salary revision silently rewrote older still-open months at the new figure.
 *
 * Two details in the fix are load-bearing and easy to undo by accident:
 *
 *  1. Selection is on effective_from, never effective_to. No write path has ever
 *     populated effective_to — all 230 superseded rows in production have it
 *     NULL — so effective_to cannot be used to bound a historical lookup.
 *  2. The COALESCE fallback. Without it, an employee whose every assignment
 *     begins after the run month matches no row, and an INNER JOIN drops them
 *     from the run entirely — paying them nothing, which is worse than the
 *     staleness this fixes.
 *
 * Verified against production before shipping: identical headcount for 2026-08,
 * 2026-07 and 2026-05 (1113 / 1113 / 912 rows, old query vs new), and exactly
 * one employee's CTC corrected in months at or before 2026-04 — which is the
 * defect being repaired, not a regression.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CALC = readFileSync(
  resolve(process.cwd(), "src/modules/payroll/payrollCalculate.service.ts"),
  "utf8",
);

/**
 * The employee-selection statement inside calculatePayrollRunScoped, anchored on
 * its own SELECT list rather than on "FROM employees e" — that phrase appears in
 * several queries in this file, and matching the first one silently asserted
 * against the wrong statement.
 */
function employeeQuery(): string {
  const start = CALC.indexOf("SELECT e.id AS employee_id, e.employee_code,");
  expect(start, "employee-selection query not found").toBeGreaterThan(-1);
  const end = CALC.indexOf("const employees = empRows", start);
  return CALC.slice(start, end === -1 ? start + 3000 : end);
}

/** The same statement with SQL comments stripped, so prose about a column is not
 *  mistaken for the query using that column. */
function employeeQuerySqlOnly(): string {
  return employeeQuery().replace(/--[^\n]*/g, "");
}

describe("salary is selected as of the run month", () => {
  it("bounds the assignment by effective_from against the run month", () => {
    const q = employeeQuery();
    expect(q).toMatch(/p\.effective_from <= LAST_DAY\(CONCAT\(\?, '-01'\)\)/);
  });

  it("no longer selects the salary row by active_status alone", () => {
    // The old rule. If this string comes back as the join predicate, the run is
    // once again being calculated at today's salary.
    const q = employeeQuery();
    expect(q).not.toMatch(/JOIN employee_salary_assignment esa ON esa\.employee_id = e\.id/);
    expect(CALC).not.toMatch(/const empConds: string\[\] = \["esa\.active_status = 1"\]/);
  });

  it("orders by effective_from descending so the most recent assignment in force wins", () => {
    expect(employeeQuery()).toMatch(
      /ORDER BY p\.effective_from DESC, p\.active_status DESC, p\.created_at DESC/,
    );
  });

  it("does not depend on effective_to, which no write path populates", () => {
    expect(
      employeeQuerySqlOnly(),
      "every superseded row in production has effective_to NULL, so bounding on it would match nothing",
    ).not.toContain("effective_to");
  });

  it("keeps SQL comments free of backticks, which would terminate the template literal", () => {
    // Learned the hard way: a backtick used to quote an identifier inside one of this
    // query's -- comments ends the JS template literal and breaks the entire module at
    // parse time, taking five unrelated test files down with it.
    const comments = employeeQuery().match(/--[^\n]*/g) ?? [];
    for (const line of comments) {
      expect(line, "use plain quotes in SQL comments inside a template literal").not.toContain("`");
    }
  });
});

describe("no employee can be dropped from a run by the new join", () => {
  it("falls back to the currently active assignment when nothing predates the run month", () => {
    const q = employeeQuery();
    expect(q).toContain("COALESCE(");
    // The fallback arm: the active row, used when the point-in-time arm finds nothing.
    expect(q).toMatch(/WHERE a\.employee_id = e\.id AND a\.active_status = 1/);
  });

  it("keeps the join INNER only because the fallback guarantees a row", () => {
    // Documented so nobody "simplifies" the COALESCE away and turns this into a
    // silent employee-dropping filter.
    const q = employeeQuery();
    const coalesceArms = (q.match(/SELECT (p|a)\.id/g) ?? []).length;
    expect(coalesceArms, "expected both the point-in-time arm and the active-row fallback").toBe(2);
  });
});

describe("parameter binding order", () => {
  it("binds run_month before runId, matching the order the joins appear in", () => {
    // The point-in-time join precedes the spl_existing join in the statement, so
    // its placeholder binds first. Getting this backwards silently calculates the
    // run against a month-shaped run id.
    expect(CALC).toMatch(/\[run\.run_month, runId, \.\.\.empParams\]/);
  });
});
