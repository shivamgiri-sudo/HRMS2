import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every path that changes a salary start date goes through salary-start-date.service.ts.
 *
 * Payroll reads employees.salary_start_date, but the same date is stored in five places, and six
 * separate code paths used to write different subsets of them (73 of 213 HRMS-onboarded employees
 * ended up paid on a date other than the one Payroll Head assigned). These contracts pin the
 * wiring so a seventh path cannot quietly appear.
 */
const SRC = resolve(process.cwd(), "src");
const read = (rel: string) => readFileSync(resolve(SRC, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(full, out);
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe("only the central service writes employees.salary_start_date", () => {
  const WRITE = /UPDATE\s+employees\s+SET[^`;]*\bsalary_start_date\b/i;

  it("no other source file updates the column", () => {
    const offenders = walk(SRC)
      .filter((f) => WRITE.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(SRC.length + 1).split(sep).join("/"));
    expect(offenders).toEqual(["modules/payroll/salary-start-date.service.ts"]);
  });

  it("employee edit no longer puts salary_start_date in its own SET list", () => {
    const svc = read("modules/employees/employee.service.ts");
    expect(svc).not.toMatch(/sets\.push\("salary_start_date/);
    expect(svc).toContain("setSalaryStartDate(");
    expect(svc).toContain('source: "employee_edit"');
  });
});

describe("Payroll Head-owned date: the writers around it", () => {
  it("salary date revision approval validates first, writes the assignment, then commits every copy", () => {
    const svc = read("modules/salary-revision/salary-revision.service.ts");
    expect(svc).toContain("prepareSalaryStartDate(connection");
    expect(svc).toContain("...actorAuthority(reviewerRoles)");
    expect(svc).toContain('source: "revision_request_approved"');
    const prepare = svc.indexOf("prepareSalaryStartDate(connection");
    const firstAssignmentWrite = svc.indexOf("UPDATE employee_salary_assignment");
    const insert = svc.indexOf("INSERT INTO employee_salary_assignment");
    const commit = svc.indexOf("commitSalaryStartDate(connection");
    expect(prepare).toBeGreaterThan(-1);
    expect(prepare).toBeLessThan(firstAssignmentWrite);
    expect(commit).toBeGreaterThan(insert);
  });

  it("Joining Control Room refuses an approved employee's date change BEFORE writing, and syncs an existing employee after", () => {
    const svc = read("modules/ats/joining-control-room.service.ts");
    const guard = svc.indexOf("assertSalaryDateNotOwnedByPayrollHead(db, candidateId, salaryStartDate)");
    const write = svc.indexOf("UPDATE ats_payroll_hr_validation");
    const sync = svc.indexOf("syncSalaryStartDateForCandidate(");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(write);
    expect(sync).toBeGreaterThan(write);
  });

  it("Payroll HR validation refuses an approved employee's date change before writing", () => {
    const svc = read("modules/ats/payroll-hr.service.ts");
    expect(svc).toContain("assertSalaryDateNotOwnedByPayrollHead(connection, input.candidate_id, salaryStartDate)");
    expect(svc.indexOf("assertSalaryDateNotOwnedByPayrollHead(connection")).toBeLessThan(
      svc.indexOf("INSERT INTO ats_payroll_hr_validation"),
    );
  });

  it("Payroll Head routes pass the session roles and the optional reason, and expose the mismatch report before /:employeeId", () => {
    const routes = read("modules/payroll-head-review/payroll-head-review.routes.ts");
    expect(routes.match(/req\.authUser!\.roles, reasonOf\(reason\)/g)?.length).toBe(4);
    expect(routes).toContain("req.authUser!.roles\n  );"); // assignment-effective-date
    const mismatch = routes.indexOf('router.get("/salary-date-mismatches"');
    expect(mismatch).toBeGreaterThan(-1);
    expect(mismatch).toBeLessThan(routes.indexOf('router.get("/:employeeId"'));
  });
});

describe("validate first, write second: no half-done edits", () => {
  it("Payroll Head create-and-assign validates the date before it creates the catalog package", () => {
    const svc = read("modules/payroll-head-review/payroll-head-review.service.ts");
    const fn = svc.slice(svc.indexOf("export async function createAndAssignPackage("));
    expect(fn.indexOf("checkSalaryStartDate({")).toBeGreaterThan(-1);
    expect(fn.indexOf("checkSalaryStartDate({")).toBeLessThan(fn.indexOf("await createPackage("));
  });

  it("Joining Control Room runs every date rule before it writes the validation row", () => {
    const svc = read("modules/ats/joining-control-room.service.ts");
    const check = svc.indexOf("checkSalaryStartDateForCandidate({");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(svc.indexOf("UPDATE ats_payroll_hr_validation"));
  });

  it("employee edit validates the date before the profile UPDATE and applies it after, never before", () => {
    const svc = read("modules/employees/employee.service.ts");
    const check = svc.indexOf("await checkSalaryStartDate(salaryDateChange)");
    const profileUpdate = svc.indexOf("UPDATE employees SET ${sets.join");
    const apply = svc.indexOf("await setSalaryStartDate(salaryDateChange)");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(profileUpdate);
    expect(apply).toBeGreaterThan(profileUpdate);
  });
});

describe("payroll readiness", () => {
  const gov = read("modules/payroll/payroll-governance.service.ts");

  it("reports SALARY_START_DATE_MISMATCH, as a blocker only when the gate flag is on", () => {
    expect(gov).toContain('code: "SALARY_START_DATE_MISMATCH"');
    expect(gov).toContain('severity: enforced ? "blocker" : "warning"');
    expect(gov).toContain("isSalaryStartDateGateEnforced()");
  });

  it("fails closed: a check that cannot run is a blocker, never a pass", () => {
    const block = gov.slice(gov.indexOf('code: "SALARY_START_DATE_CHECK_ERROR"'));
    expect(block.slice(0, 200)).toContain('severity: "blocker"');
  });
});
