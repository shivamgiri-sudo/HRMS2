import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** IT provisioning (owner ruling 2026-10-01): SLA endpoints fail closed; dashboard / bulk ops are scoped. */
const { dbExecute, state, rowScope } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  state: { admin: false, superAdmin: false, level: "BRANCH_ALL", branchIds: ["b1"] as string[] },
  rowScope: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1", roles: ["hr"] }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRole: vi.fn(async () => state.admin), getEmployeeForUser: vi.fn() }));
vi.mock("../../../shared/scopeAccess.js", async (orig) => ({ ...(await orig<any>()), hasAnyRole: vi.fn(async () => state.superAdmin) }));
vi.mock("../../../shared/roleResolver.js", () => ({ getUserRoleContext: async () => ({ primaryRole: "hr", roleKeys: ["hr"] }) }));
vi.mock("../../../shared/dashboardScope.js", () => ({
  resolveDashboardScope: async () => ({ level: state.level, branchIds: state.branchIds, processIds: [], employeeIds: [] }),
  narrowDashboardScope: async (s: any) => s,
}));
vi.mock("../../exit/exitScope.js", () => ({ dashboardRowScopeSql: rowScope }));
vi.mock("../../org/branchScope.js", () => ({
  resolveCallerBranchScope: async () => ({ orgWide: state.admin, branchIds: state.branchIds }),
  branchPredicate: (s: any) => (s.orgWide ? { sql: "1=1", params: [] } : { sql: "branch_id IN (?)", params: s.branchIds }),
}));
vi.mock("../../employees/employee-activation.service.js", () => ({ findSlaViolations: vi.fn(async () => []) }));
vi.mock("../it-provisioning.service.js", async (orig) => ({ ...(await orig<any>()), getProvisioningStats: vi.fn(async () => ({})) }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));

const { default: router } = await import("../it-provisioning.routes.js").then((m: any) => ({ default: m.default ?? m.itProvisioningRouter ?? Object.values(m).find((v: any) => typeof v === "function" && v.stack) }));
const app = () => { const a = express(); a.use(express.json()); a.use("/api/it-provisioning", router as any); return a; };

beforeEach(() => {
  state.admin = false; state.superAdmin = false; state.level = "BRANCH_ALL"; state.branchIds = ["b1"];
  dbExecute.mockReset(); dbExecute.mockResolvedValue([[], []]);
  rowScope.mockReset(); rowScope.mockResolvedValue({ sql: "e.branch_id IN (?)", params: ["b1"] });
});

describe("it-provisioning scoping", () => {
  it("sla/summary for a caller with no resolvable branch returns nothing and runs no query (was: org-wide)", async () => {
    state.branchIds = [];
    const res = await request(app()).get("/api/it-provisioning/sla/summary");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(dbExecute).not.toHaveBeenCalled();
  });
  it("sla/violations for an unresolvable scope is empty", async () => {
    state.branchIds = [];
    const res = await request(app()).get("/api/it-provisioning/sla/violations");
    expect(res.body.count).toBe(0);
  });
  it("it-dashboard-summary scopes tickets, assets and employee directory for hr", async () => {
    await request(app()).get("/api/it-provisioning/it-dashboard-summary");
    const sqls = dbExecute.mock.calls.map(([q]) => String(q));
    expect(sqls.find((q) => /FROM helpdesk_ticket\s+WHERE category/.test(q))).toMatch(/employee_id IN \(SELECT e\.id FROM employees e WHERE e\.branch_id IN/);
    expect(sqls.find((q) => /FROM asset_master/.test(q))).toMatch(/branch_id IN \(\?\)/);
    expect(sqls.find((q) => /ORDER BY e\.employee_code/.test(q))).toMatch(/\(e\.branch_id IN \(\?\)\)/);
  });
  it("bulk-sync only looks up employees inside the caller's scope", async () => {
    await request(app()).post("/api/it-provisioning/bulk-sync").send({ rows: [{ employee_code: "MAS1" }] });
    const [sql, params] = dbExecute.mock.calls[0];
    expect(sql).toMatch(/\(e\.branch_id IN \(\?\)\)/);
    expect(params).toEqual(["MAS1", "b1"]);
  });

  // Owner ruling 2026-10-01: admin is branch-scoped like hr. accessGuard.hasRole answers true for admin
  // (state.admin), but only super_admin skips the row scope.
  it("it-dashboard-summary for admin (not super_admin) is still scoped to its branch", async () => {
    state.admin = true;
    await request(app()).get("/api/it-provisioning/it-dashboard-summary");
    const sqls = dbExecute.mock.calls.map(([q]) => String(q));
    expect(sqls.find((q) => /ORDER BY e\.employee_code/.test(q))).toMatch(/\(e\.branch_id IN \(\?\)\)/);
  });
  it("it-dashboard-summary for super_admin is unrestricted", async () => {
    state.admin = true; state.superAdmin = true;
    await request(app()).get("/api/it-provisioning/it-dashboard-summary");
    const sqls = dbExecute.mock.calls.map(([q]) => String(q));
    expect(sqls.find((q) => /ORDER BY e\.employee_code/.test(q))).not.toMatch(/branch_id IN/);
  });
  it("bulk-sync for admin only looks up employees inside its branch", async () => {
    state.admin = true;
    await request(app()).post("/api/it-provisioning/bulk-sync").send({ rows: [{ employee_code: "MAS1" }] });
    const [sql, params] = dbExecute.mock.calls[0];
    expect(sql).toMatch(/\(e\.branch_id IN \(\?\)\)/);
    expect(params).toEqual(["MAS1", "b1"]);
  });
  it("sla/summary for admin with no resolvable branch returns nothing", async () => {
    state.admin = true; state.branchIds = [];
    const res = await request(app()).get("/api/it-provisioning/sla/summary");
    expect(res.body.data).toEqual([]);
    expect(dbExecute).not.toHaveBeenCalled();
  });
});
