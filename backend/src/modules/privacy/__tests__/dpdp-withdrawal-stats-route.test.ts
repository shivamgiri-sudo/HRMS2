import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

/**
 * Regression test for a route-shadowing bug, found and fixed 2026-08-13 — same class as
 * the vendor-payments/aging fix.
 *
 * GET /dpdp-withdrawal/stats used to be registered ~80 lines after
 * GET /dpdp-withdrawal/:id. Express matches routes in registration order, and :id matches
 * any literal segment — so every request to .../stats was swallowed by the :id handler as
 * svc.getById('stats', ...), which never matches a real row (id is a UUID column) and the
 * caller got a 404 "Not found or access denied" instead of the aggregate stats payload.
 * NativeDPDPWithdrawalAdmin.tsx's fetchStats() swallows that error as "non-critical", so
 * the dashboard's stats cards silently rendered empty forever with no visible failure.
 *
 * getById is mocked to resolve null, mirroring what the real "no row with id='stats'"
 * query returns, so a regression back to the old ordering fails this test the same way
 * production failed: a 404 instead of the stats shape.
 */

const { getStats, getById } = vi.hoisted(() => ({
  getStats: vi.fn(async () => ({ pending: 3, approved: 5, rejected: 1 })),
  getById: vi.fn(async () => null),
}));
vi.mock("../dpdp-withdrawal.service.js", () => ({ getStats, getById }));

vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => {
      req.authUser = { id: "u-hr-1", role: "hr" };
      next();
    },
  };
});
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../../shared/roleResolver.js", () => ({
  getUserRoleContext: vi.fn(async () => ({ primaryRole: "hr" })),
}));

import { dpdpWithdrawalRouter } from "../dpdp-withdrawal.routes.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/privacy", dpdpWithdrawalRouter);
  return a;
}

describe("GET /dpdp-withdrawal/stats", () => {
  it("reaches the stats handler, not the :id handler shadowing it", async () => {
    const res = await request(app()).get("/api/privacy/dpdp-withdrawal/stats");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ pending: 3, approved: 5, rejected: 1 });
    expect(getStats).toHaveBeenCalledTimes(1);
    // The bug's signature: the :id handler resolves the record for id="stats" — assert it
    // was never even called, not just that the response happened to look right.
    expect(getById).not.toHaveBeenCalled();
  });

  it("still resolves a real withdrawal id through the :id handler", async () => {
    getById.mockResolvedValueOnce({ id: "real-uuid-123", status: "pending" });

    const res = await request(app()).get("/api/privacy/dpdp-withdrawal/real-uuid-123");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: "real-uuid-123", status: "pending" });
    expect(getById).toHaveBeenCalledWith("real-uuid-123", "u-hr-1", true);
  });
});
