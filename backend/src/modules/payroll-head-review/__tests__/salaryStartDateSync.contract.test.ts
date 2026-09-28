import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * There is exactly one salary start date. Payroll Head assigns it (and may backdate it, before
 * joining or before today, with a mandatory reason - owner decision 2026-09-25); every stored copy
 * of it - employees.salary_start_date (what payroll reads), the ATS validation row, the package
 * date, the salary assignment and the component assignment - is written together, in ONE
 * transaction, by salary-start-date.service.ts.
 *
 * History: this file used to pin a best-effort helper, syncSalaryStartDateEverywhere, whose writes
 * ended in `.catch(() => {})`. Payroll Head's backdated date hit the CHECK constraint on
 * employees.salary_start_date, the error was swallowed, and payroll kept reading the joining date:
 * 73 of 213 HRMS-onboarded employees (395 backdated days) ended up paid on a different date from
 * the one Payroll Head assigned. The contracts below pin the replacement so it cannot regress to a
 * swallowed, non-atomic write.
 *
 * The behaviour of the central service itself is tested in
 * payroll/__tests__/salary-start-date.service.test.ts.
 */
const SERVICE = readFileSync(
  resolve(
    process.cwd(),
    "src/modules/payroll-head-review/payroll-head-review.service.ts",
  ),
  "utf8",
);

/** Source of one function, from its declaration to the next top-level declaration. */
function bodyOf(name: string): string {
  const start = SERVICE.search(
    new RegExp(`(export )?async function ${name}\\(`),
  );
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const rest = SERVICE.slice(start + 10);
  const next = rest.search(
    /\n(export )?(async )?function |\nexport async function |\n\/\*\*\n/,
  );
  return SERVICE.slice(start, next < 0 ? undefined : start + 10 + next);
}

describe("salary start date is written once, atomically, by the central service", () => {
  it("no longer has the swallowing best-effort helper or the old date lock", () => {
    expect(SERVICE).not.toContain("syncSalaryStartDateEverywhere(");
    expect(SERVICE).not.toContain("assertSalaryDateLock(");
  });

  it("imports the central service", () => {
    expect(SERVICE).toContain('from "../payroll/salary-start-date.service.js"');
  });

  it("writeComponentAssignment (assign / create-and-assign) validates first, writes in one transaction, then commits the date everywhere", () => {
    const fn = bodyOf("writeComponentAssignment");
    expect(fn).toContain("connection.beginTransaction()");
    expect(fn).toContain("...actorAuthority(ctx.roles)");
    // Validation must precede the first write, otherwise the locks see the fresh date as "already carried".
    expect(fn.indexOf("prepareSalaryStartDate(")).toBeGreaterThan(-1);
    expect(fn.indexOf("prepareSalaryStartDate(")).toBeLessThan(
      fn.indexOf("INSERT INTO salary_component_assignments"),
    );
    expect(fn.indexOf("commitSalaryStartDate(")).toBeGreaterThan(
      fn.indexOf("UPDATE employee_salary_assignment"),
    );
    expect(fn.indexOf("commitSalaryStartDate(")).toBeLessThan(
      fn.indexOf("connection.commit()"),
    );
    expect(fn).toContain("connection.rollback()");
  });

  it("approveOfferedPackage (one-click approval) does the same", () => {
    const fn = bodyOf("approveOfferedPackage");
    expect(fn).toContain("connection.beginTransaction()");
    expect(fn.indexOf("prepareSalaryStartDate(")).toBeLessThan(
      fn.indexOf("INSERT INTO salary_component_assignments"),
    );
    expect(fn.indexOf("commitSalaryStartDate(")).toBeLessThan(
      fn.indexOf("connection.commit()"),
    );
    expect(fn).toContain("connection.rollback()");
  });

  it("updateAssignmentEffectiveDate validates first and commits the date everywhere inside its transaction", () => {
    const fn = bodyOf("updateAssignmentEffectiveDate");
    expect(fn.indexOf("prepareSalaryStartDate(")).toBeGreaterThan(-1);
    expect(fn.indexOf("prepareSalaryStartDate(")).toBeLessThan(
      fn.indexOf("INSERT INTO employee_salary_assignment"),
    );
    expect(fn.indexOf("commitSalaryStartDate(")).toBeGreaterThan(
      fn.indexOf("INSERT INTO employee_salary_assignment"),
    );
    expect(fn.indexOf("commitSalaryStartDate(")).toBeLessThan(
      fn.indexOf("connection.commit()"),
    );
  });

  it("updateSalaryStartDate delegates every copy to the central service inside a transaction", () => {
    const fn = bodyOf("updateSalaryStartDate");
    expect(fn).toContain("applySalaryStartDate(connection");
    expect(fn).toContain('source: "payroll_head_change_start_date"');
    expect(fn).toContain("connection.beginTransaction()");
    expect(fn).toContain("connection.commit()");
    // The old body updated validation and employees by hand.
    expect(fn).not.toContain("UPDATE employees SET salary_start_date");
    expect(fn).not.toContain("UPDATE ats_payroll_hr_validation");
  });

  it("no date-related write in this file swallows its error", () => {
    for (const name of [
      "writeComponentAssignment",
      "approveOfferedPackage",
      "updateAssignmentEffectiveDate",
      "updateSalaryStartDate",
    ]) {
      expect(bodyOf(name), `${name} swallows an error`).not.toMatch(
        /\.catch\(\(\) => \{\}\)/,
      );
      expect(bodyOf(name), `${name} swallows an error`).not.toMatch(
        /\.catch\(\(e\) => console\.warn\('\[payroll-head-review\] could not sync ESA/,
      );
    }
  });

  it("approve() refuses a review whose salary start date disagrees across the employee's records", () => {
    const fn = bodyOf("approve");
    expect(fn).toContain("getSalaryStartDateConsistency(db, employeeId)");
    expect(fn).toContain("SALARY_DATE_INCONSISTENT");
    expect(fn.indexOf("getSalaryStartDateConsistency")).toBeLessThan(
      fn.indexOf("UPDATE employee_payroll_head_review SET status = 'approved'"),
    );
  });

  it("does not reintroduce a hard 'before joining' rejection for Payroll Head paths - the central service owns that rule", () => {
    expect(SERVICE).not.toContain("cannot be before date of joining");
    expect(SERVICE).not.toContain("SALARY_START_BEFORE_JOINING");
  });
});
