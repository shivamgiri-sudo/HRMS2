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

describe("salary date revision approval keeps one salary start date", () => {
  it("moves employees.salary_start_date and the validation row through the central service, not by hand", () => {
    expect(SERVICE).toContain("commitSalaryStartDate(connection, prepared)");
    expect(SERVICE).not.toContain("UPDATE employees SET salary_start_date");
    expect(SERVICE).not.toContain("UPDATE ats_payroll_hr_validation SET salary_start_date");
  });

  it("validates before the assignment is touched and commits every copy on the same transaction connection", () => {
    const prepare = SERVICE.indexOf("prepareSalaryStartDate(connection");
    const assignmentWrite = SERVICE.indexOf("UPDATE employee_salary_assignment");
    const commit = SERVICE.indexOf("commitSalaryStartDate(connection, prepared)");
    const done = SERVICE.indexOf("SET status = ?, reviewed_by = ?");
    expect(prepare).toBeGreaterThan(0);
    expect(assignmentWrite).toBeGreaterThan(prepare);
    expect(commit).toBeGreaterThan(assignmentWrite);
    expect(done).toBeGreaterThan(commit);
  });
});
