import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Role access on the billability API, exercised through the real router.
 *
 * The grant in migration 1066, the route guard in finance.routes.tsx and BILLABILITY_ROLES here
 * are three separate lists that must agree. A contract test already compares them as text; this
 * one drives the actual middleware, so a role that is listed but rejected at runtime — or one
 * that is not listed and gets through anyway — fails here rather than in front of a user.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

// Only requireAuth is stood in for; spreading the real module keeps requireWriteAccess, which
// the write routes mount and which is undefined under a wholesale mock.
let actor: { id: string; role: string; roles: string[] } = { id: "u1", role: "finance", roles: ["finance"] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); },
  };
});

// The real requireRole needs no database here: it takes the cached branch when authUser.roles
// is populated, which is exactly what the app does after requireAuth.
async function appFor(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.authUser = actor; next(); });
  const router = (await import("../billability.routes.js")).default;
  app.use("/api/finance/billability", router);
  return app;
}

const GRANTED = ["super_admin", "finance", "payroll_head", "payroll_branch"];
const DENIED = ["employee", "hr", "recruiter", "wfm", "manager"];

beforeEach(() => {
  execute.mockReset();
  // Every read route ends in a SELECT; shape is irrelevant to an access test.
  execute.mockResolvedValue([[], []]);
});

describe("billability API — role access", () => {
  for (const role of GRANTED) {
    it(`allows ${role} to read the cost-centre activity`, async () => {
      const res = await request(await appFor(role)).get("/api/finance/billability/cost-centre-activity");
      expect(res.status, `${role} was granted this page in 1066 and must not be refused by the API`).toBe(200);
    });
  }

  for (const role of DENIED) {
    it(`refuses ${role}`, async () => {
      const res = await request(await appFor(role)).get("/api/finance/billability/cost-centre-activity");
      expect(res.status, `${role} holds no grant and must not reach billability data`).toBe(403);
    });
  }

  it("refuses an unauthenticated caller outright", async () => {
    const app = express();
    app.use(express.json());
    const router = (await import("../billability.routes.js")).default;
    app.use("/api/finance/billability", router);
    const res = await request(app).get("/api/finance/billability/cost-centre-activity");
    // requireRole answers 401 when there is no identity at all, not 403.
    expect(res.status).toBe(401);
  });

  it("refuses a write from a role that may only read", async () => {
    // No role outside the granted four may write, and the write guard must be mounted — a page
    // that opens and then 403s on save is the worst of both.
    const res = await request(await appFor("hr"))
      .post("/api/finance/billability/matrix")
      .send({ processId: "p1", designationId: "d1", isBillable: true, effectiveFrom: "2026-08-01", changeReason: "x" });
    expect(res.status).toBe(403);
  });
});
