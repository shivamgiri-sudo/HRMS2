import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

const { hasRole } = vi.hoisted(() => ({ hasRole: vi.fn() }));
vi.mock("../../../../shared/accessGuard.js", () => ({ hasRole }));

const { getUserRoleContext } = vi.hoisted(() => ({ getUserRoleContext: vi.fn() }));
vi.mock("../../../../shared/roleResolver.js", () => ({ getUserRoleContext }));

const { resolveDashboardScope, DashboardScopeConfigurationError, buildScopeWhereEmployees } = vi.hoisted(() => {
  class DashboardScopeConfigurationError extends Error {
    statusCode = 409;
    code = "DASHBOARD_SCOPE_NOT_CONFIGURED";
    constructor(role: string, scopeType: string) {
      super(`No active ${scopeType} scope is configured for role ${role}`);
      this.name = "DashboardScopeConfigurationError";
    }
  }
  return {
    resolveDashboardScope: vi.fn(),
    DashboardScopeConfigurationError,
    buildScopeWhereEmployees: vi.fn(() => ({ sql: "1=0", params: [] })),
  };
});
vi.mock("../../../../shared/dashboardScope.js", () => ({
  resolveDashboardScope,
  DashboardScopeConfigurationError,
  buildScopeWhereEmployees,
}));

vi.mock("../../../communication/dispatch.service.js", () => ({
  resolveEmailContact: (emp: { email: string | null }) => emp.email,
}));

import { resolveDailyBriefRecipient } from "../daily-brief-recipient.resolver.js";

const EMPLOYEE_ROW = {
  id: "emp-1",
  user_id: "user-1",
  full_name: "Priya Sharma",
  email: "priya@masindia.com",
  official_email: "priya@masindia.com",
  active_status: 1,
};

describe("daily-brief-recipient.resolver: scope fail-closed", () => {
  beforeEach(() => {
    execute.mockReset();
    hasRole.mockReset();
    getUserRoleContext.mockReset();
    resolveDashboardScope.mockReset();
  });

  it("marks the recipient unresolvable (not silently included) when the scope cannot be configured", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM employees WHERE id")) return [[EMPLOYEE_ROW]];
      if (sql.includes("FROM auth_user")) return [[{ is_blocked: 0 }]];
      return [[]];
    });
    hasRole.mockResolvedValue(true); // eligible role
    getUserRoleContext.mockResolvedValue({ primaryRole: "team_leader", roleKeys: ["team_leader"], isSuperAdmin: false, isHO: false });
    resolveDashboardScope.mockRejectedValue(
      new DashboardScopeConfigurationError("team_leader", "reporting hierarchy"),
    );

    const result = await resolveDailyBriefRecipient("emp-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unresolved.employeeId).toBe("emp-1");
      expect(result.unresolved.reason).toContain("No active reporting hierarchy scope");
    }
  });

  it("resolves a recipient with a valid scope, carrying the team employee ids through", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM employees WHERE id")) return [[EMPLOYEE_ROW]];
      if (sql.includes("FROM auth_user")) return [[{ is_blocked: 0 }]];
      if (sql.includes("FROM employees e WHERE e.active_status")) return [[{ id: "report-1" }, { id: "report-2" }]];
      return [[]];
    });
    hasRole.mockResolvedValue(true);
    getUserRoleContext.mockResolvedValue({ primaryRole: "team_leader", roleKeys: ["team_leader"], isSuperAdmin: false, isHO: false });
    resolveDashboardScope.mockResolvedValue({
      level: "TEAM_ONLY",
      branchIds: [],
      processIds: [],
      employeeIds: ["report-1", "report-2"],
      userId: "user-1",
      role: "team_leader",
    });
    buildScopeWhereEmployees.mockReturnValue({ sql: "e.id IN (?,?)", params: ["report-1", "report-2"] });

    const result = await resolveDailyBriefRecipient("emp-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipient.teamEmployeeIds).toEqual(["report-1", "report-2"]);
      expect(result.recipient.scopeLabel).toBe("Your direct/indirect reports");
    }
  });

  it("marks the recipient unresolvable when the role is not one of the MVP eligible roles", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM employees WHERE id")) return [[EMPLOYEE_ROW]];
      if (sql.includes("FROM auth_user")) return [[{ is_blocked: 0 }]];
      return [[]];
    });
    hasRole.mockResolvedValue(false); // not eligible

    const result = await resolveDailyBriefRecipient("emp-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unresolved.reason).toContain("Not an eligible role");
    }
    expect(resolveDashboardScope).not.toHaveBeenCalled();
  });
});
