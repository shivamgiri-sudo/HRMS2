import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Billability access with processPnlRouter mounted in FRONT of it, exactly as app.ts does.
 *
 * billability.routes.access.test.ts mounts billabilityRouter alone on a bare express(), which is
 * why it passed while the API was in fact 403 for payroll_branch in production. processPnlRouter
 * is mounted on the shared "/api/finance" base ahead of "/api/finance/billability", and it carried
 * a PATH-LESS `router.use(requireRole(...PNL_READ_ROLES))`. Express runs a path-less use() for
 * every request that reaches the router, whatever the prefix, and requireRole answers 403 rather
 * than calling next() — so the request never got as far as billabilityRouter.
 *
 * payroll_branch is the role that proves it: it is in BILLABILITY_ROLES and not in
 * PNL_READ_ROLES, and no entry in ROLE_ALIASES bridges the two.
 *
 * The mount order below must stay in step with app.ts. Reordering the two app.use() calls there
 * without reordering them here would let this test keep passing against a broken app.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

let actor: { id: string; role: string; roles: string[] } = { id: "u1", role: "finance", roles: ["finance"] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); },
  };
});

import billabilityRouter from "../billability.routes.js";
import { processPnlRouter } from "../process-pnl.routes.js";

/** The two mounts from app.ts, in app.ts's order. */
function appFor(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.authUser = actor; next(); });
  app.use("/api/finance", processPnlRouter);
  app.use("/api/finance/billability", billabilityRouter);
  return app;
}

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue([[], []]);
});

describe("billability API reached past processPnlRouter", () => {
  // payroll_branch is the one that regressed; the other three are in both lists and would have
  // passed even with the bug, so they are here only to prove the mount itself still works.
  for (const role of ["payroll_branch", "finance", "payroll_head", "super_admin"]) {
    it(`lets ${role} through to billability with processPnlRouter mounted first`, async () => {
      const res = await request(appFor(role)).get("/api/finance/billability/cost-centre-activity");
      expect(
        res.status,
        `${role} holds a billability grant; a router mounted earlier on the shared /api/finance `
          + `base must not be able to answer for it`
      ).toBe(200);
    });
  }

  it("still refuses a role that holds no billability grant", async () => {
    // The fix must not turn into a hole: scoping the P&L gate to /pnl removes an accidental
    // denial, it does not remove billabilityRouter's own guard.
    const res = await request(appFor("hr")).get("/api/finance/billability/cost-centre-activity");
    expect(res.status).toBe(403);
  });

  it("still refuses a non-P&L role on the P&L routes the gate exists to protect", async () => {
    const res = await request(appFor("hr")).get("/api/finance/pnl/summary?period=2026-08");
    expect(res.status, "scoping the gate to /pnl must not stop it guarding /pnl").toBe(403);
  });
});
