import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * There is exactly one salary start date, not three. Payroll HR picks it at offer
 * stage; Payroll Head can change it (including backdating it -- an intentional,
 * supported action, confirmed directly by the user, not something to validate
 * against); Payroll HR can separately request a change that Payroll Head approves.
 * Whichever of those happened last is "the" date, and every place that stores or
 * displays it must reflect it -- the payroll-driving assignment
 * (employee_salary_assignment.effective_from), the review screen's own record
 * (ats_payroll_hr_validation.salary_start_date), and the employee's own record
 * (employees.salary_start_date, what the Employee page shows).
 *
 * Before this fix, only updateAssignmentEffectiveDate wrote back to
 * ats_payroll_hr_validation, and NOTHING wrote to employees.salary_start_date after
 * creation. writeComponentAssignment (assignPackage/createAndAssignPackage) and
 * approveOfferedPackage -- the two most common "assign/approve the package" actions
 * -- wrote the real date into the payroll-driving tables but never the other two, so
 * the review screen and the Employee page both kept showing the ORIGINAL date after
 * Payroll Head had already moved payroll on. Confirmed live: 30 of 60 sampled
 * employees already disagreed this way (e.g. ESTUTI ESTUTI: payroll moved to
 * 2026-09-08 when Payroll Head assigned her package, but both other copies of the
 * date stayed on the original 2026-09-11).
 *
 * IMPORTANT: an earlier version of this fix mistakenly assumed
 * employee_salary_assignment.effective_from was always the one, ground-truth date
 * and synced the OTHER two fields to match it -- which is backwards when Payroll
 * Head's own package-assignment date is itself the stale/wrong one (as it was for
 * ESTUTI, whose payroll got backdated to before her own joining date by a Payroll
 * Head action with no upstream cause). The correct fix propagates whatever date was
 * JUST set by the action that ran (not a fixed direction), and does not add any
 * "can't be before date of joining" validation to the package-assignment paths --
 * that would contradict the confirmed-intentional backdating feature.
 */
const SERVICE = readFileSync(
  resolve(process.cwd(), "src/modules/payroll-head-review/payroll-head-review.service.ts"),
  "utf8",
);

describe("salary start date stays in sync across all three of its copies", () => {
  it("defines one shared, non-fatal sync helper that updates both the validation row and employees.salary_start_date", () => {
    expect(SERVICE).toMatch(/async function syncSalaryStartDateEverywhere\(/);
    const helper = SERVICE.slice(
      SERVICE.indexOf("async function syncSalaryStartDateEverywhere("),
      SERVICE.indexOf("export async function updateAssignmentEffectiveDate("),
    );
    // Non-fatal: a missing candidate_id is valid for a direct hire with no ATS offer,
    // and a failed best-effort display sync must never block the real payroll write.
    expect(helper).toMatch(/if \(candidateId\)/);
    expect(helper).toContain("UPDATE ats_payroll_hr_validation SET salary_start_date");
    expect(helper).toContain("UPDATE employees SET salary_start_date");
    expect((helper.match(/\.catch\(\(\) => \{\}\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("does NOT reject a date before date_of_joining in the shared helper -- backdating is intentional", () => {
    const helper = SERVICE.slice(
      SERVICE.indexOf("async function syncSalaryStartDateEverywhere("),
      SERVICE.indexOf("export async function updateAssignmentEffectiveDate("),
    );
    expect(helper).not.toMatch(/date_of_joining/);
    expect(helper).not.toMatch(/cannot be before/i);
  });

  it("writeComponentAssignment (assignPackage / createAndAssignPackage) syncs all copies of the date", () => {
    const fn = SERVICE.slice(
      SERVICE.indexOf("async function writeComponentAssignment("),
      SERVICE.indexOf("export async function assignPackage"),
    );
    expect(fn).toMatch(/await syncSalaryStartDateEverywhere\(db, employeeId, candidateId, effectiveDate\);/);
  });

  it("both writeComponentAssignment callers pass the real candidate_id through", () => {
    const assignBlock = SERVICE.slice(
      SERVICE.indexOf("export async function assignPackage"),
      SERVICE.indexOf("export async function createAndAssignPackage"),
    );
    expect(assignBlock).toMatch(/writeComponentAssignment\([^)]*review\.candidate_id/s);

    const createAndAssignBlock = SERVICE.slice(
      SERVICE.indexOf("export async function createAndAssignPackage"),
      SERVICE.indexOf("export async function acceptPackage"),
    );
    expect(createAndAssignBlock).toMatch(/writeComponentAssignment\([^)]*review\.candidate_id/s);
  });

  it("approveOfferedPackage (the one-click approval path) syncs all copies of the date too", () => {
    const fn = SERVICE.slice(
      SERVICE.indexOf("export async function approveOfferedPackage"),
      SERVICE.indexOf("// ── Notification helpers"),
    );
    expect(fn).toMatch(/await syncSalaryStartDateEverywhere\(db, employeeId, review\.candidate_id[^,]*, effectiveDate\);/);
  });

  it("updateAssignmentEffectiveDate still syncs via the shared helper (behavior-preserving rename)", () => {
    const fn = SERVICE.slice(
      SERVICE.indexOf("export async function updateAssignmentEffectiveDate("),
      SERVICE.indexOf("// ── Salary package actions"),
    );
    expect(fn).toMatch(/await syncSalaryStartDateEverywhere\(connection, employeeId, review\.candidate_id[^,]*, newDate\);/);
  });

  it("updateSalaryStartDate (Payroll HR request / Payroll Head approval path) now also updates employees.salary_start_date", () => {
    const fn = SERVICE.slice(
      SERVICE.indexOf("export async function updateSalaryStartDate("),
      SERVICE.indexOf("/**\n * There is exactly one salary start date"),
    );
    expect(fn).toContain("UPDATE ats_payroll_hr_validation SET salary_start_date = ? WHERE id = ?");
    expect(fn).toMatch(/UPDATE employees SET salary_start_date = \?/);
  });
});
