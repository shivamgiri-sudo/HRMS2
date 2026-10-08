import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Owner ruling 2026-10-01: DPDP withdrawal admin queue is branch-scoped for hr (dpo/admin org-wide).
const { buildRequesterScope, guard, listAll, getStats } = vi.hoisted(() => ({
  buildRequesterScope: vi.fn(async () => ({ sql: "dcw.requester_id IN (X)", params: ["br-1"] }) as any),
  guard: vi.fn((_q: any, _s: any, next: any) => next()),
  listAll: vi.fn(async () => []),
  getStats: vi.fn(async () => ({})),
}));
vi.mock("../dpdp-withdrawal.scope.js", () => ({ buildRequesterScope, withdrawalScopeGuard: guard, withdrawalDecideGuard: (_q: any, _s: any, next: any) => next() }));
vi.mock("../dpdp-withdrawal.service.js", () => ({ listAll, getStats, getById: vi.fn(async () => ({ id: "w1" })), getTasksForWithdrawal: vi.fn(async () => []) }));
vi.mock("../../../shared/roleResolver.js", () => ({ getUserRoleContext: vi.fn(async () => ({ primaryRole: "hr" })) }));
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _r: any, next: any) => { req.authUser = { id: "u-hr" }; next(); } };
});
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));

import { dpdpWithdrawalRouter } from "../dpdp-withdrawal.routes.js";
const app = () => { const a = express(); a.use(express.json()); a.use("/api/privacy", dpdpWithdrawalRouter); return a; };

beforeEach(() => { vi.clearAllMocks(); guard.mockImplementation((_q: any, _s: any, next: any) => next()); });

describe("dpdp withdrawal branch scope", () => {
  it("list passes the server scope alongside the client branch filter", async () => {
    await request(app()).get("/api/privacy/dpdp-withdrawal?branch_id=other");
    expect(listAll).toHaveBeenCalledWith(expect.objectContaining({ branchId: "other" }), { sql: "dcw.requester_id IN (X)", params: ["br-1"] });
  });
  it("stats are scoped", async () => {
    await request(app()).get("/api/privacy/dpdp-withdrawal/stats");
    expect(getStats).toHaveBeenCalledWith({ sql: "dcw.requester_id IN (X)", params: ["br-1"] });
  });
  it("org-wide caller gets null scope", async () => {
    buildRequesterScope.mockResolvedValueOnce(null);
    await request(app()).get("/api/privacy/dpdp-withdrawal");
    expect((listAll.mock.calls[0] as any)[1]).toBeNull();
  });
  it("id routes run through the scope guard and stop out-of-scope requests", async () => {
    guard.mockImplementation((_q: any, s: any) => s.status(403).json({ success: false }));
    const res = await request(app()).get("/api/privacy/dpdp-withdrawal/w1/tasks");
    expect(res.status).toBe(403);
  });
});
