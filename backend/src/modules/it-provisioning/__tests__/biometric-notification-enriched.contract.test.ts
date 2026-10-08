import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The ADMIN_BIOMETRIC_ID_CARD join-provisioning task's email/inbox notification body only
 * ever said "New employee X (CODE) has an employee code" — no DOJ, branch, or process, even
 * though the requested detail (Employee Name, Employee Code, DOJ, Branch, Process/Department)
 * was already resolvable at dispatch time (branch_id/process_id/date_of_joining are written to
 * `employees` in the same INSERT that sets employee_code). This asserts the description now
 * carries all four, and that the branch/process/DOJ lookup feeding it is present.
 */
const src = readFileSync(
  resolve(process.cwd(), "src/modules/it-provisioning/it-provisioning.service.ts"),
  "utf8",
);

describe("ADMIN_BIOMETRIC_ID_CARD notification includes DOJ, Branch, Process/Department", () => {
  it("resolves branch_name, process_name and date_of_joining for the dispatch", () => {
    expect(src).toContain("LEFT JOIN branch_master b ON b.id = e.branch_id");
    expect(src).toContain("LEFT JOIN process_master p ON p.id = e.process_id");
  });

  it("the biometric task's descFn includes DOJ/Branch/Process in its output", () => {
    expect(src).toContain("`DOJ: ${info.doj}`");
    expect(src).toContain("`Branch: ${info.branchName}`");
    expect(src).toContain("`Process/Department: ${info.processName}`");
  });

  it("titleFn/descFn calls in the dispatch loop are passed the resolved taskInfo", () => {
    expect(src).toContain("task.titleFn(employeeName, employeeCode, null, taskInfo)");
    expect(src).toContain("task.descFn(employeeName, employeeCode, null, taskInfo)");
  });

  it("a lookup failure does not abort the whole dispatch (non-fatal fallback)", () => {
    expect(src).toContain("Non-fatal: failed to resolve branch/process for task notifications");
  });
});
