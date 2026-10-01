import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Security centre (owner ruling 2026-10-01): hr / it / security see only events about their own scope. */
const { dbExecute, state } = vi.hoisted(() => ({ dbExecute: vi.fn(), state: { roles: ["hr"] as string[] } }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../shared/enterpriseScope.js", () => ({
  resolveUserBusinessScope: async () => ({ roles: state.roles, assignments: [], branchId: "b1", employeeId: "e1" }),
  buildEmployeeScopeCondition: () => ({ sql: "e.branch_id = ?", params: ["b1"] }),
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1", role: "hr" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
const { securityCenterRouter } = await import("../security-center.routes.js");
const app = () => { const a = express(); a.use(express.json()); a.use("/api/security-center", securityCenterRouter); return a; };

beforeEach(() => { state.roles = ["hr"]; dbExecute.mockReset(); dbExecute.mockResolvedValue([[{}], []]); });

describe("security centre scoping", () => {
  it("events list for hr is limited to events about employees of its branch", async () => {
    await request(app()).get("/api/security-center/events");
    const [sql, params] = dbExecute.mock.calls.find(([q]) => /SELECT \* FROM security_audit_event/.test(q))!;
    expect(sql).toMatch(/actor_user_id IN \(SELECT e\.user_id FROM employees e WHERE e\.branch_id = \?\)/);
    expect(sql).toMatch(/target_employee_id IN/);
    expect(params).toEqual(["b1", "b1", "b1"]);
  });
  it("summary counts are scoped too", async () => {
    await request(app()).get("/api/security-center/summary");
    const q = dbExecute.mock.calls.find(([s]) => /logins_today/.test(s))!;
    expect(q[0]).toMatch(/AND \(actor_user_id IN/);
    const u = dbExecute.mock.calls.find(([s]) => /FROM auth_user/.test(s))!;
    expect(u[0]).toMatch(/WHERE id IN \(SELECT e\.user_id/);
  });
  it("admin is scoped like hr (owner ruling 2026-10-01)", async () => {
    state.roles = ["admin"];
    await request(app()).get("/api/security-center/events");
    const [sql] = dbExecute.mock.calls.find(([q]) => /SELECT \* FROM security_audit_event/.test(q))!;
    expect(sql).toMatch(/actor_user_id IN/);
  });
  it("org-wide roles and the DPO are unrestricted", async () => {
    for (const r of ["super_admin", "dpo"]) {
      state.roles = [r]; dbExecute.mockClear();
      await request(app()).get("/api/security-center/events");
      const [sql] = dbExecute.mock.calls.find(([q]) => /SELECT \* FROM security_audit_event/.test(q))!;
      expect(sql).not.toMatch(/actor_user_id IN/);
    }
  });
});
