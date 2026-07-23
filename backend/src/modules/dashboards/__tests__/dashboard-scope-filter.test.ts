import { describe, expect, it } from "vitest";

import {
  buildEmployeeLinkedScopeWhere,
  buildScopeWhereEmployees,
  type DashboardScope,
} from "../../../shared/dashboardScope.js";

function scope(overrides: Partial<DashboardScope>): DashboardScope {
  return {
    level: "ORG_ALL",
    branchIds: [],
    processIds: [],
    employeeIds: [],
    userId: "user-1",
    role: "employee",
    ...overrides,
  };
}

describe("dashboard team and self scope filters", () => {
  it("filters self scope with the authenticated employee id when available", () => {
    const result = buildScopeWhereEmployees(
      scope({ level: "SELF_ONLY", employeeIds: ["emp-1"] }),
      "e",
    );

    expect(result).toEqual({ sql: "e.id IN (?)", params: ["emp-1"] });
  });

  it("filters team scope with resolved direct and indirect employee ids", () => {
    const result = buildScopeWhereEmployees(
      scope({ level: "TEAM_ONLY", employeeIds: ["emp-2", "emp-3"] }),
      "e",
    );

    expect(result).toEqual({
      sql: "e.id IN (?,?)",
      params: ["emp-2", "emp-3"],
    });
  });

  it("filters employee-linked domain tables instead of collapsing to 1=0", () => {
    const result = buildEmployeeLinkedScopeWhere(
      scope({ level: "TEAM_ONLY", employeeIds: ["emp-2", "emp-3"] }),
      "attendance.employee_id",
      "attendance.branch_id",
      "attendance.process_id",
    );

    expect(result).toEqual({
      sql: "attendance.employee_id IN (?,?)",
      params: ["emp-2", "emp-3"],
    });
  });

  it("fails closed when a team or self scope has no resolved employees", () => {
    expect(
      buildEmployeeLinkedScopeWhere(
        scope({ level: "TEAM_ONLY", employeeIds: [] }),
        "employee_id",
      ),
    ).toEqual({ sql: "1=0", params: [] });
  });
});
