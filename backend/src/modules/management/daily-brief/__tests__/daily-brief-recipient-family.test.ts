/**
 * Role-family resolution tests for the daily-brief-recipient.resolver.ts widening pass
 * (Gap 1 — see that file's header for the full role-family -> resolution-strategy table).
 *
 * One representative role per family, plus the three roles that are eligible for the
 * daily brief but have NO bucket at all in shared/dashboardScope.ts (branch_admin,
 * it_head, trainer — verified against that file's real SYSTEM_WIDE_ROLES/
 * HEAD_OFFICE_ROLES/ORG_ALL_ROLES/BRANCH_ALL_ROLES/PROCESS_OR_TEAM_ROLES/TEAM_ROLES/
 * SELF_ONLY_ROLES sets), which must fail closed rather than accept that file's silent
 * SELF_ONLY fallback.
 */
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

import { resolveDailyBriefRecipient, DAILY_BRIEF_ELIGIBLE_ROLES } from "../daily-brief-recipient.resolver.js";

const EMPLOYEE_ROW = {
  id: "emp-1",
  user_id: "user-1",
  full_name: "Test Recipient",
  email: "person@masindia.com",
  official_email: "person@masindia.com",
  active_status: 1,
};

function mockEmployeeAndAuth() {
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM employees WHERE id")) return [[EMPLOYEE_ROW]];
    if (sql.includes("FROM auth_user")) return [[{ is_blocked: 0 }]];
    return [[]];
  });
}

describe("daily-brief-recipient.resolver: eligible role widening", () => {
  it("includes the full 25-role live catalog, not just the original MVP four", () => {
    for (const role of [
      "team_leader", "tl", "manager", "assistant_manager", "process_manager", "branch_head",
      "branch_admin", "wfm", "qa", "trainer", "hr", "branch_it", "recruiter", "payroll",
      "payroll_admin", "payroll_head", "payroll_hr", "finance", "finance_head", "accounts_head",
      "it", "it_head", "ceo", "admin", "super_admin",
    ]) {
      expect(DAILY_BRIEF_ELIGIBLE_ROLES).toContain(role);
    }
    expect(DAILY_BRIEF_ELIGIBLE_ROLES.length).toBe(25);
  });
});

describe("daily-brief-recipient.resolver: role-family team-resolution strategy", () => {
  beforeEach(() => {
    execute.mockReset();
    hasRole.mockReset().mockResolvedValue(true);
    getUserRoleContext.mockReset();
    resolveDashboardScope.mockReset();
    buildScopeWhereEmployees.mockReset().mockReturnValue({ sql: "1=0", params: [] });
  });

  it("process_manager (process_functional family) resolves via PROCESS_ALL scope -> a process/branch employee set, not a direct-reports walk", async () => {
    mockEmployeeAndAuth();
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM employees WHERE id")) return [[EMPLOYEE_ROW]];
      if (sql.includes("FROM auth_user")) return [[{ is_blocked: 0 }]];
      if (sql.includes("FROM employees e WHERE e.active_status")) return [[{ id: "proc-emp-1" }, { id: "proc-emp-2" }]];
      return [[]];
    });
    getUserRoleContext.mockResolvedValue({ primaryRole: "process_manager", roleKeys: ["process_manager"], isSuperAdmin: false, isHO: false });
    resolveDashboardScope.mockResolvedValue({
      level: "PROCESS_ALL",
      branchIds: ["branch-1"],
      processIds: ["process-1"],
      employeeIds: [],
      userId: "user-1",
      role: "process_manager",
    });
    buildScopeWhereEmployees.mockReturnValue({ sql: "e.process_id IN (?)", params: ["process-1"] });

    const result = await resolveDailyBriefRecipient("emp-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipient.teamEmployeeIds).toEqual(["proc-emp-1", "proc-emp-2"]);
      expect(result.recipient.scopeLabel).toBe("Your process");
      // process_functional family never gets a payroll-style scope descriptor.
      expect(result.recipient.scopeDescriptor).toBeUndefined();
    }
  });

  it("payroll_head (payroll_finance family) gets a branch/process scope descriptor, NOT a per-employee team list", async () => {
    mockEmployeeAndAuth();
    getUserRoleContext.mockResolvedValue({ primaryRole: "payroll_head", roleKeys: ["payroll_head"], isSuperAdmin: false, isHO: false });
    // payroll_head is in dashboardScope.ts's HEAD_OFFICE_ROLES -> unconditional ORG_ALL.
    resolveDashboardScope.mockResolvedValue({
      level: "ORG_ALL",
      branchIds: [],
      processIds: [],
      employeeIds: [],
      userId: "user-1",
      role: "payroll_head",
    });

    const result = await resolveDailyBriefRecipient("emp-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      // No per-employee resolution query should have run for this family.
      expect(execute).not.toHaveBeenCalledWith(
        expect.stringContaining("FROM employees e WHERE e.active_status"),
        expect.anything(),
      );
      expect(result.recipient.teamEmployeeIds).toEqual([]);
      expect(result.recipient.scopeDescriptor).toEqual({ branchIds: [], processIds: [] });
      expect(result.recipient.scopeLabel).toBe("Organization-wide (payroll/finance)");
    }
  });

  it("payroll_hr (payroll_finance family) with a BRANCH_ALL scope carries the real branch ids in scopeDescriptor", async () => {
    mockEmployeeAndAuth();
    getUserRoleContext.mockResolvedValue({ primaryRole: "payroll_hr", roleKeys: ["payroll_hr"], isSuperAdmin: false, isHO: false });
    resolveDashboardScope.mockResolvedValue({
      level: "BRANCH_ALL",
      branchIds: ["branch-9"],
      processIds: [],
      employeeIds: [],
      userId: "user-1",
      role: "payroll_hr",
    });

    const result = await resolveDailyBriefRecipient("emp-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipient.teamEmployeeIds).toEqual([]);
      expect(result.recipient.scopeDescriptor).toEqual({ branchIds: ["branch-9"], processIds: [] });
    }
  });

  it("super_admin (executive family) resolves ORG_ALL scope into rollup mode, not per-employee refusal", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM employees WHERE id")) return [[EMPLOYEE_ROW]];
      if (sql.includes("FROM auth_user")) return [[{ is_blocked: 0 }]];
      if (sql.includes("SELECT id FROM employees WHERE active_status = 1")) {
        return [[{ id: "org-emp-1" }, { id: "org-emp-2" }, { id: "org-emp-3" }]];
      }
      return [[]];
    });
    getUserRoleContext.mockResolvedValue({ primaryRole: "super_admin", roleKeys: ["super_admin"], isSuperAdmin: true, isHO: true });
    resolveDashboardScope.mockResolvedValue({
      level: "ORG_ALL",
      branchIds: [],
      processIds: [],
      employeeIds: [],
      userId: "user-1",
      role: "super_admin",
    });

    const result = await resolveDailyBriefRecipient("emp-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      // The old Phase-B behavior refused ORG_ALL outright and returned [] (making every
      // module NOT_APPLICABLE). This pass resolves the real org-wide population instead.
      expect(result.recipient.teamEmployeeIds).toEqual(["org-emp-1", "org-emp-2", "org-emp-3"]);
      expect(result.recipient.scopeDescriptor).toEqual({ branchIds: [], processIds: [] });
      expect(result.recipient.scopeLabel).toBe("Organization-wide (executive rollup)");
    }
  });

  it.each(["branch_admin", "it_head", "trainer"])(
    "%s has no bucket in shared/dashboardScope.ts and is refused as an UnresolvedRecipient, not silently narrowed to SELF_ONLY",
    async (role) => {
      mockEmployeeAndAuth();
      getUserRoleContext.mockResolvedValue({ primaryRole: role, roleKeys: [role], isSuperAdmin: false, isHO: false });

      const result = await resolveDailyBriefRecipient("emp-1");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.unresolved.reason).toContain("no scope-resolution bucket");
      }
      // resolveDashboardScope must never even be called for these — the bucket check
      // happens first, so no SELF_ONLY fallback from that file is ever reached.
      expect(resolveDashboardScope).not.toHaveBeenCalled();
    },
  );
});
