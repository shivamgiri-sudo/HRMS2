import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Policy acknowledgement summary (owner ruling 2026-10-01): counts are limited to the caller's scope. */
const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-hr" }; next(); },
  requireWriteAccess: (_q: any, _s: any, next: any) => next(),
}));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser: async () => null }));
vi.mock("../../../shared/scopeAccess.js", () => ({ hasAnyRole: async () => true }));
vi.mock("../../org/branchScope.js", () => ({ employeeRowScope: async () => ({ sql: "e.branch_id = ?", params: ["b1"] }) }));
const { policiesRouter } = await import("../policies.routes.js");
const app = () => { const a = express(); a.use("/api/policies", policiesRouter); return a; };

beforeEach(() => { dbExecute.mockReset(); dbExecute.mockResolvedValue([[{ n: 3 }], []]); });

describe("policies admin summary", () => {
  it("headcount and acknowledgements carry the caller's branch scope", async () => {
    await request(app()).get("/api/policies/admin/summary");
    const sqls = dbExecute.mock.calls.map(([q, p]) => [String(q), p] as const);
    const head = sqls.find(([q]) => /COUNT\(\*\) AS n FROM employees e/.test(q))!;
    expect(head[0]).toMatch(/\(e\.branch_id = \?\)/);
    expect(head[1]).toEqual(["b1"]);
    const acks = sqls.find(([q]) => /company_policy_acknowledgement a0/.test(q))!;
    expect(acks[0]).toMatch(/JOIN employees e ON e\.id = a0\.employee_id WHERE \(e\.branch_id = \?\)/);
    expect(acks[1]).toEqual(["b1"]);
  });
});
