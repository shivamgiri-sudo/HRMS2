import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test, 2026-08-13: wfm.regularization.secure.routes.ts recognized "tl" but
 * not "team_leader" in every one of its role-scope arrays, even though they are two
 * distinct, independently assignable roles in WORKFORCE_ROLE_CATALOG and team_leader is
 * the canonical one used across the rest of the backend (54 files vs. a handful for tl).
 * Verified live: 8 active accounts hold team_leader, 1 holds tl (a demo account).
 *
 * Net effect before this fix: a real team_leader saw only their OWN regularization
 * requests (buildScopeWhereClause fell through to 1=0, then listScope's fallback to
 * self-only), never their team's — despite AttendanceRegularization.tsx's own
 * APPROVER_ROLES granting them the bulk-approve/per-row approve UI.
 *
 * This asserts the actual mechanism the fix touches: every role array this file passes
 * into scopeAccess's role-checking functions now includes "team_leader" alongside "tl",
 * by capturing the roles argument scopeAccess.js's functions are called with rather than
 * re-deriving the branch/process scope-matching SQL those functions build.
 */

const { hasAnyRole, buildScopeWhereClause, hasScopedAccess } = vi.hoisted(() => ({
  hasAnyRole: vi.fn(async () => false),
  buildScopeWhereClause: vi.fn(async () => ({ sql: "1=1", params: [] })),
  hasScopedAccess: vi.fn(async () => true),
}));
vi.mock("../../../shared/scopeAccess.js", () => ({ hasAnyRole, buildScopeWhereClause, hasScopedAccess }));

const { dbExecute } = vi.hoisted(() => ({
  dbExecute: vi.fn(async (sql: string) => {
    // employeeTarget()'s lookup — canAccessEmployee needs a real row or it 403s before
    // ever reaching the isPrivileged check this test asserts on.
    if (/FROM employees\s+WHERE id = \?/.test(sql)) {
      return [[{ id: "emp-report-1", branch_id: "b-1", process_id: "p-1", lob_id: null, department_id: null, reporting_manager_id: "emp-tl-1", manager_id: null }], []];
    }
    return [[], []];
  }),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: dbExecute, query: dbExecute, getConnection: vi.fn() },
}));
vi.mock("../../../shared/accessGuard.js", () => ({
  getEmployeeForUser: vi.fn(async () => ({ id: "emp-tl-1" })),
}));
vi.mock("../wfm.service.js", () => ({
  wfmService: {
    listRegularizations: vi.fn(async () => []),
    submitRegularization: vi.fn(async () => ({ id: "reg-1" })),
  },
}));

const actor = { id: "u-tl-1", role: "team_leader", roles: ["team_leader"] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); },
  };
});

import { wfmRegularizationSecureRouter } from "../wfm.regularization.secure.routes.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/wfm", wfmRegularizationSecureRouter);
  return a;
}

beforeEach(() => {
  hasAnyRole.mockClear().mockResolvedValue(false);
  buildScopeWhereClause.mockClear().mockResolvedValue({ sql: "1=1", params: [] });
  hasScopedAccess.mockClear().mockResolvedValue(true);
});

describe("WFM_VIEW_SCOPE_ROLES includes team_leader (GET /regularizations -> listScope)", () => {
  it("passes team_leader in the roles array to buildScopeWhereClause", async () => {
    const res = await request(app()).get("/api/wfm/regularizations");
    expect(res.status).toBe(200);
    expect(buildScopeWhereClause).toHaveBeenCalledTimes(1);
    const rolesArg = buildScopeWhereClause.mock.calls[0][1] as string[];
    expect(rolesArg).toContain("team_leader");
    expect(rolesArg).toContain("tl"); // both stay recognized — not a rename
  });
});

describe("submit-on-behalf isPrivileged checks include team_leader", () => {
  it("POST /regularizations/batch passes team_leader in its isPrivileged role list", async () => {
    await request(app())
      .post("/api/wfm/regularizations/batch")
      .send({ employeeId: "emp-report-1", sessionDates: ["2026-08-01"] });

    // isPrivileged is the one hasAnyRole call in this file that includes
    // "assistant_manager" — every other call site checks a different, narrower role set
    // (e.g. canAccessEmployee's admin/hr/wfm/ceo bypass), so filtering on that role
    // isolates the exact call this fix touches.
    const isPrivilegedCall = hasAnyRole.mock.calls.find((c) => (c as unknown[]).includes("assistant_manager"));
    expect(isPrivilegedCall).toBeDefined();
    expect(isPrivilegedCall).toContain("team_leader");
    expect(isPrivilegedCall).toContain("tl");
  });
});
