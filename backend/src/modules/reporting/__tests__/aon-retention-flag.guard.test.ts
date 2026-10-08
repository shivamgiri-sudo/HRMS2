import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Unlike aon-retention-flag.routes.test.ts (which mocks requireRole/requireScopedRole away to
// isolate the handler logic), THIS file exercises the real middleware chain end to end -- it is
// the regression test for CRITICAL/IMPORTANT-3 of the final whole-branch review: `/flag-retention`
// previously had `requireAuth` only, so any authenticated employee could flag ANY employee.id in
// ANY branch/process with no row-scope check at all.

const { upsertOpenWorkItem } = vi.hoisted(() => ({ upsertOpenWorkItem: vi.fn() }));
vi.mock("../../../shared/workItem.js", () => ({ upsertOpenWorkItem }));

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

let currentUser: { id: string; role: string } = { id: "u1", role: "hr" };
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = currentUser; next(); },
}));

const { aonRetentionFlagRouter } = await import("../aon-retention-flag.routes.js");

const app = express();
app.use(express.json());
app.use("/api/reports/aon-analytics", aonRetentionFlagRouter);

describe("POST /flag-retention -- role and scope guard (real middleware)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = { id: "u1", role: "hr" };
  });

  it("rejects a role outside the allow-list (a plain employee cannot flag anyone)", async () => {
    currentUser = { id: "emp-x", role: "employee" };
    // requireRole has no cached req.authUser.roles here, so it looks the role up itself
    // (`SELECT role_key FROM user_roles ...`) before requireScopedRole -- or the handler --
    // ever runs.
    dbExecute.mockResolvedValueOnce([[{ role_key: "employee" }], []]);

    const res = await request(app)
      .post("/api/reports/aon-analytics/flag-retention")
      .send({ employeeId: "emp-1" });

    expect(res.status).toBe(403);
    expect(upsertOpenWorkItem).not.toHaveBeenCalled();
  });
});
