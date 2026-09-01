import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level role gate for Manual P&L Adjustments (Part B).
 *
 * Mirrors billability-mount-order.access.test.ts's pattern: real processPnlRouter, mocked db,
 * mocked auth so the actor's role is controlled per test. Proves the approval endpoint actually
 * refuses a role outside ADJUSTMENT_APPROVE_ROLES — not just that the service layer would, since
 * the service never runs role checks itself (the route does).
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection: vi.fn() } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists: vi.fn().mockResolvedValue(true) }));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));

let actor: { id: string; role: string; roles: string[] } = { id: "u1", role: "finance_head", roles: ["finance_head"] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; req.userRoles = actor.roles; next(); },
  };
});

import { processPnlRouter } from "../process-pnl.routes.js";

function appAs(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use("/api/finance", processPnlRouter);
  return app;
}

function mockEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "adj-1", process_id: "proc-1", period_code: "2026-07", adjustment_type: "reward",
    amount: 50000, reason: "test", status: "pending", created_by: "someone-else",
    created_at: new Date().toISOString(), approved_by: null, approved_at: null,
    rejection_reason: null, ...overrides,
  };
}

beforeEach(() => {
  execute.mockReset();
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("SELECT * FROM pnl_manual_adjustment WHERE id")) return [[mockEntry()], []];
    if (q.startsWith("UPDATE pnl_manual_adjustment")) return [{ affectedRows: 1 }, []];
    if (q.includes("FROM pnl_manual_adjustment a")) return [[mockEntry({ status: "approved" })], []];
    return [[], []];
  });
});

describe("PUT /api/finance/pnl/manual-adjustments/:id/approve — role gate", () => {
  it("blocks a role outside ADJUSTMENT_APPROVE_ROLES", async () => {
    // "employee" holds no finance role at all — the plainest possible unauthorized caller.
    const res = await request(appAs("employee")).put("/api/finance/pnl/manual-adjustments/adj-1/approve");
    expect(res.status, "an unauthorized role must never be allowed to approve a P&L adjustment").toBe(403);
  });

  it("blocks branch_head too — can CREATE an adjustment but not APPROVE one", async () => {
    // branch_head is in ADJUSTMENT_WRITE_ROLES (can raise a request) but deliberately not in
    // ADJUSTMENT_APPROVE_ROLES (cannot approve/reject) — same separation budget-topup.service.ts
    // draws between its create and review role sets.
    const res = await request(appAs("branch_head")).put("/api/finance/pnl/manual-adjustments/adj-1/approve");
    expect(res.status).toBe(403);
  });

  it("allows finance_head to approve", async () => {
    const res = await request(appAs("finance_head")).put("/api/finance/pnl/manual-adjustments/adj-1/approve");
    expect(res.status).toBe(200);
  });

  it("allows super_admin to approve", async () => {
    const res = await request(appAs("super_admin")).put("/api/finance/pnl/manual-adjustments/adj-1/approve");
    expect(res.status).toBe(200);
  });
});

describe("POST /api/finance/pnl/manual-adjustments — role gate", () => {
  it("blocks a role outside ADJUSTMENT_WRITE_ROLES", async () => {
    const res = await request(appAs("employee"))
      .post("/api/finance/pnl/manual-adjustments")
      .send({ processId: "proc-1", periodCode: "2026-07", adjustmentType: "reward", amount: 1000, reason: "x" });
    expect(res.status).toBe(403);
  });

  it("allows branch_head to create", async () => {
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.startsWith("SELECT id, branch_id FROM process_master")) return [[{ id: "proc-1", branch_id: "b1" }], []];
      if (q.startsWith("INSERT INTO pnl_manual_adjustment")) return [{ affectedRows: 1 }, []];
      if (q.includes("FROM pnl_manual_adjustment a")) return [[mockEntry()], []];
      return [[], []];
    });
    const res = await request(appAs("branch_head"))
      .post("/api/finance/pnl/manual-adjustments")
      .send({ processId: "proc-1", periodCode: "2026-07", adjustmentType: "reward", amount: 1000, reason: "x" });
    expect(res.status).toBe(201);
  });
});
