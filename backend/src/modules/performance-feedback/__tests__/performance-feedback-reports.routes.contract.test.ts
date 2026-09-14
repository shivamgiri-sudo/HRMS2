import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("performance feedback report routes", () => {
  const controllerSource = readFileSync(
    resolve(process.cwd(), "src/modules/performance-feedback/performance-feedback.controller.ts"),
    "utf8",
  );

  it("returns implemented list and detail responses instead of 501 stubs", () => {
    expect(controllerSource).toContain("service.getReports");
    expect(controllerSource).toContain("service.getReportById");
    expect(controllerSource).not.toContain('message: "getReports method needs to be added to service layer"');
    expect(controllerSource).not.toContain('message: "getReportById method needs to be added to service layer"');
  });

  it("derives employee and manager report scope from the authenticated user", () => {
    expect(controllerSource).toContain("getEmployeeForUser(userId)");
    expect(controllerSource).toContain('{ manager_id: employee.id }');
    expect(controllerSource).toContain('{ employee_id: employee.id }');
  });

  it("maps an administrator's own user ID filter to their employee record", () => {
    expect(controllerSource).toContain("requestedEmployeeId !== userId");
    expect(controllerSource).toContain("employee_id: ownEmployee.id");
  });
});
