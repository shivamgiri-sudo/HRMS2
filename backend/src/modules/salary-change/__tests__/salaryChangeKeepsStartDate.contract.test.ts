import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A salary change adds a new salary line effective on the change date. It must never move the salary
 * START date: employee_salary_assignment.effective_from and employees.salary_start_date are owned by
 * the salary-start-date service. Found in browser testing: the change wrote effective_from = the change
 * date (even a date before joining) while the employee record kept its own, so the two disagreed.
 */
const SRC = readFileSync(
  resolve(process.cwd(), "src/modules/salary-change/salary-change.service.ts"),
  "utf8",
);
const start = SRC.indexOf("UPDATE employee_salary_assignment");
const assignmentUpdate = SRC.slice(start, SRC.indexOf(".catch", start));

describe("changeSalary leaves the salary start date alone", () => {
  it("only syncs ctc_annual on the active assignment", () => {
    expect(assignmentUpdate).toMatch(/SET ctc_annual = \?, updated_at = NOW\(\)/);
  });

  it("does not write effective_from or employees.salary_start_date anywhere", () => {
    expect(assignmentUpdate).not.toMatch(/effective_from/);
    expect(SRC).not.toMatch(/UPDATE employees[^`]*salary_start_date/);
  });
});
