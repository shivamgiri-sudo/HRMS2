import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test, 2026-08-13: MyTeamPage.tsx's own page gate (MANAGER_ROLES) lists
 * "team_leader", "tl" and "assistant_manager" as allowed to open the page, but the
 * backend endpoints its tabs actually call did not include those roles in their
 * requireRole(...) lists — so a real caller holding only one of those roles saw the
 * page render, then every meaningful tab 403 on every request. Verified live against
 * production: 11 active accounts hold exactly these roles today (8 team_leader,
 * 2 assistant_manager, 1 tl).
 *
 * This asserts the fix at the layer that actually matters — the HTTP boundary — for
 * every endpoint MyTeamPage's tabs call in management.routes.ts. tl is not asserted
 * separately: ROLE_ALIASES maps team_leader<->tl bidirectionally inside requireRole,
 * so a route open to team_leader is already open to tl by construction (see
 * platform/policy/roles.ts).
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

vi.mock("../../../shared/accessGuard.js", () => ({
  hasRole: vi.fn(async (_userId: string, ...roles: string[]) =>
    roles.some((r) => ["team_leader", "assistant_manager"].includes(r))
  ),
  getEmployeeForUser: vi.fn(async () => ({ id: "emp-tl-1" })),
}));

vi.mock("../management.service.js", () => ({
  managementService: {
    getDirectReportIds: vi.fn(async () => ["emp-report-1"]),
    listAlerts: vi.fn(async () => []),
    acknowledgeAlert: vi.fn(async () => undefined),
    createCoachingSession: vi.fn(async () => ({ id: "coaching-1" })),
  },
}));

let actorRoles: string[] = ["team_leader"];
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => {
      req.authUser = { id: "u-tl-1", role: actorRoles[0], roles: actorRoles };
      next();
    },
  };
});

import { managementRouter } from "../management.routes.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/management", managementRouter);
  return a;
}

beforeEach(() => {
  execute.mockReset().mockResolvedValue([[], []]);
});

describe("management.routes.ts — MyTeamPage's endpoints admit team_leader/assistant_manager", () => {
  for (const roles of [["team_leader"], ["assistant_manager"]]) {
    describe(`caller role: ${roles[0]}`, () => {
      beforeEach(() => { actorRoles = roles; });

      it("GET /team-overview is not 403", async () => {
        const res = await request(app()).get("/api/management/team-overview");
        expect(res.status).not.toBe(403);
      });

      it("GET /team-members is not 403", async () => {
        const res = await request(app()).get("/api/management/team-members");
        expect(res.status).not.toBe(403);
      });

      it("GET /agent-performance is not 403", async () => {
        const res = await request(app()).get("/api/management/agent-performance");
        expect(res.status).not.toBe(403);
      });

      it("GET /alerts is not 403", async () => {
        const res = await request(app()).get("/api/management/alerts?acknowledged=false");
        expect(res.status).not.toBe(403);
      });

      it("POST /alerts/:id/acknowledge is not 403", async () => {
        const res = await request(app()).post("/api/management/alerts/alert-1/acknowledge");
        expect(res.status).not.toBe(403);
      });

      it("POST /coaching is not 403", async () => {
        const res = await request(app())
          .post("/api/management/coaching")
          .send({ employee_id: "emp-report-1", session_date: "2026-08-13", session_type: "1:1" });
        expect(res.status).not.toBe(403);
      });
    });
  }

  it("a role with no team-leadership grant at all still gets 403 (the gate still excludes someone)", async () => {
    actorRoles = ["employee"];
    const res = await request(app()).get("/api/management/team-overview");
    expect(res.status).toBe(403);
  });
});
