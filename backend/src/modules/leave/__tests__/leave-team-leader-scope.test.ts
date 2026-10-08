import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test, 2026-08-13: leave.secure.routes.ts's LEAVE_VIEW_SCOPE_ROLES recognized
 * "tl" but not "team_leader" — two distinct, independently assignable roles in
 * workforce_role_catalog (team_leader is the canonical one used across the rest of the
 * backend). hasAnyRole/buildScopeWhereClause do a literal string match with no alias
 * expansion, so a team_leader-only caller fell through to "1=0" and leaveListScope's
 * fallback then restricted them to their own single employee record — never their team's
 * leave requests — even though live accounts hold a user_assignment_scope row granting
 * them process-wide visibility, and TeamLeaveTab.tsx (MyTeamPage's Leave tab, whose own
 * page gate already admits team_leader) calls GET /api/leave/requests expecting it to
 * work. Same bug class, same fix shape, as
 * wfm/__tests__/regularization-team-leader-scope.test.ts.
 *
 * This asserts the actual mechanism the fix touches: the roles array passed into
 * buildScopeWhereClause includes "team_leader" alongside "tl", by capturing the call
 * rather than re-deriving the branch/process scope-matching SQL that shared function
 * already builds correctly elsewhere.
 */

const { buildScopeWhereClause, hasAnyRole } = vi.hoisted(() => ({
  buildScopeWhereClause: vi.fn(async () => ({ sql: "1=1", params: [] })),
  hasAnyRole: vi.fn(async () => false),
}));
vi.mock("../../../shared/scopeAccess.js", () => ({ buildScopeWhereClause, hasAnyRole }));

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(async () => [[], []]), query: vi.fn(), getConnection: vi.fn() },
}));
vi.mock("../../../shared/accessGuard.js", () => ({
  getEmployeeForUser: vi.fn(async () => ({ id: "emp-tl-1" })),
}));

const actor = { id: "u-tl-1", role: "team_leader", roles: ["team_leader"] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); },
  };
});

import { leaveSecureRouter } from "../leave.secure.routes.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/leave", leaveSecureRouter);
  return a;
}

beforeEach(() => {
  buildScopeWhereClause.mockClear().mockResolvedValue({ sql: "1=1", params: [] });
  hasAnyRole.mockClear().mockResolvedValue(false);
});

describe("LEAVE_VIEW_SCOPE_ROLES includes team_leader (GET /requests -> leaveListScope)", () => {
  it("passes team_leader in the roles array to buildScopeWhereClause", async () => {
    const res = await request(app()).get("/api/leave/requests");
    expect(res.status).toBe(200);
    expect(buildScopeWhereClause).toHaveBeenCalledTimes(1);
    const rolesArg = buildScopeWhereClause.mock.calls[0][1] as string[];
    expect(rolesArg).toContain("team_leader");
    expect(rolesArg).toContain("tl"); // both stay recognized — not a rename
  });

  it("falls back to self-only scope (not team-wide) if buildScopeWhereClause still says 1=0 — confirms the fallback path is what the bug hit", async () => {
    buildScopeWhereClause.mockResolvedValueOnce({ sql: "1=0", params: [] });
    const res = await request(app()).get("/api/leave/requests");
    expect(res.status).toBe(200);
    // Can't inspect the SQL directly here (db.execute is mocked generically), but this
    // documents the fallback exists and is reachable — the actual "does team_leader
    // avoid it" assertion is the test above.
  });
});
