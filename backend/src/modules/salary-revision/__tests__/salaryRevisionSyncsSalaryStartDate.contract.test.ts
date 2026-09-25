import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Approving a Salary Date Revision must move the date payroll actually reads
 * (employees.salary_start_date) and the review screen's copy
 * (ats_payroll_hr_validation.salary_start_date), inside the same transaction as the
 * assignment change. Found in browser testing: the approval only moved
 * employee_salary_assignment, so payroll kept the old date.
 */
const SERVICE = readFileSync(
  resolve(process.cwd(), "src/modules/salary-revision/salary-revision.service.ts"),
  "utf8",
);
const approveBranch = SERVICE;

describe("salary date revision approval keeps one salary start date", () => {
  it("updates employees.salary_start_date with the approved date", () => {
    expect(approveBranch).toMatch(
      /UPDATE employees SET salary_start_date = \?\s+WHERE id = \?[\s\S]*?req\.requested_effective_from,\s*req\.employee_id/,
    );
  });

  it("updates the latest ats_payroll_hr_validation row for the employee's candidate", () => {
    expect(approveBranch).toMatch(/UPDATE ats_payroll_hr_validation SET salary_start_date = \?/);
    expect(approveBranch).toMatch(/JOIN employees e ON e\.candidate_id = v\.candidate_id/);
    expect(approveBranch).toMatch(/ORDER BY v\.created_at DESC LIMIT 1/);
  });

  it("does both before the request is marked approved, on the same transaction connection", () => {
    const emp = SERVICE.indexOf("UPDATE employees SET salary_start_date");
    const val = SERVICE.indexOf("UPDATE ats_payroll_hr_validation SET salary_start_date");
    const done = SERVICE.indexOf("SET status = ?, reviewed_by = ?");
    expect(emp).toBeGreaterThan(0);
    expect(val).toBeGreaterThan(emp);
    expect(done).toBeGreaterThan(val);
    expect(SERVICE.slice(emp - 60, emp)).toContain("connection.execute");
  });
});
