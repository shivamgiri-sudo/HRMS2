import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { isOwnLmsEmployeeReference } from "../lms-integration.routes.js";

describe("LMS learner progress access", () => {
  const employee = {
    id: "employee-uuid",
    employee_code: "EMP001",
  };

  it("accepts the caller's employee UUID or employee code", () => {
    expect(isOwnLmsEmployeeReference("employee-uuid", employee)).toBe(true);
    expect(isOwnLmsEmployeeReference("emp001", employee)).toBe(true);
  });

  it("rejects a different employee reference", () => {
    expect(isOwnLmsEmployeeReference("MAS99999", employee)).toBe(false);
    expect(isOwnLmsEmployeeReference("", employee)).toBe(false);
    expect(isOwnLmsEmployeeReference("employee-uuid", null)).toBe(false);
  });

  it("enforces ownership after role authentication and before loading progress", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/modules/lms-integration/lms-integration.routes.ts"),
      "utf8",
    );
    const route = source.slice(source.indexOf('lmsIntegrationRouter.get("/learner-progress/:employeeId"'));

    expect(route.indexOf("requireLmsProgressAccess")).toBeGreaterThan(-1);
    expect(route.indexOf("requireLmsProgressAccess")).toBeLessThan(route.indexOf("h(async"));
  });
});
