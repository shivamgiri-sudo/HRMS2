import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Covers the three defects reported on the Attendance Regularization approval page,
 * 2026-08-27. Each block asserts the mechanism the fix actually changed, not a
 * restatement of the fix.
 *
 * 1. THE PAGE WAS UNUSABLY SLOW. GET /regularizations applied no status filter, no
 *    date window and no LIMIT, and the page called it with no query parameters at
 *    all, then filtered and paged in the browser at 20 rows a page. Live mas_hrms
 *    holds 131,353 rows, 131,336 of them already `approved` against 10 pending; the
 *    unfiltered query did not return within 120 seconds, while the same query with
 *    status='pending' returned in 292 ms.
 *
 * 2. A REPORTING MANAGER COULD NOT SEE PENDING REQUESTS. listScope() delegated to
 *    buildScopeWhereClause, which only emits its managerEmployeeId clause for a
 *    user_assignment_scope row of scope_type='team' — and there are ZERO such rows
 *    live. So all 161 distinct reporting managers fell through to the self-only
 *    fallback. regularizationReviewRole() meanwhile DID authorise them via
 *    resolveEffectiveApprover(), so they could approve a request they could not find.
 *
 * 3. BULK APPROVAL HAD NO RBAC. PATCH /regularizations/bulk-review carried no role
 *    gate and no branch check; it looped straight into _performReview per id. Owner
 *    ruling: Branch WFM and Branch Payroll HR over their own branch only, Payroll
 *    Head and Super Admin across all branches.
 */

const { hasAnyRole, buildScopeWhereClause, hasScopedAccess, getUserAssignmentScopes } = vi.hoisted(() => ({
  hasAnyRole: vi.fn(async () => false),
  buildScopeWhereClause: vi.fn(async () => ({ sql: "1=0", params: [] as unknown[] })),
  hasScopedAccess: vi.fn(async () => false),
  getUserAssignmentScopes: vi.fn(async () => [] as any[]),
}));
vi.mock("../../../shared/scopeAccess.js", () => ({
  hasAnyRole, buildScopeWhereClause, hasScopedAccess, getUserAssignmentScopes,
}));

/** Every SQL string the router sent, so the built WHERE/LIMIT can be asserted on. */
const executed: Array<{ sql: string; params: unknown[] }> = [];

/** id -> branch, used by the bulk route's one-shot branch resolution query. */
const BRANCH_OF: Record<string, string | null> = {
  "reg-own-branch": "branch-noida-2",
  "reg-other-branch": "branch-ahmedabad",
  "reg-no-branch": null,
};

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: dbExecute, query: dbExecute, getConnection: vi.fn() },
}));
vi.mock("../../../shared/accessGuard.js", () => ({
  getEmployeeForUser: vi.fn(async () => ({ id: "emp-caller" })),
  hasRole: vi.fn(async () => false),
}));
vi.mock("../wfm.service.js", () => ({
  wfmService: { listRegularizations: vi.fn(async () => []), listReasons: vi.fn(async () => []) },
}));
vi.mock("../../../shared/approvalEscalation.js", () => ({
  resolveEffectiveApprover: vi.fn(async () => ({ approverId: null, isEscalated: false, escalationReason: null })),
}));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn(async () => undefined) }));
vi.mock("../attendance.notifications.js", () => ({
  notifyRegularizationDecision: vi.fn(async () => undefined),
  notifyRegularizationStage2Pending: vi.fn(async () => undefined),
}));

let actor = { id: "u-caller", role: "employee", roles: ["employee"] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); } };
});

import { wfmRegularizationSecureRouter } from "../wfm.regularization.secure.routes.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/wfm", wfmRegularizationSecureRouter);
  return a;
}

/** The GET handler's row-fetch, i.e. the one carrying the seven LEFT JOINs. */
const listQuery = () => executed.find((q) => /FROM attendance_regularization ar/.test(q.sql) && /LEFT JOIN branch_master/.test(q.sql));
const countQuery = () => executed.find((q) => /SELECT COUNT\(\*\) AS total/.test(q.sql));

beforeEach(() => {
  executed.length = 0;
  actor = { id: "u-caller", role: "employee", roles: ["employee"] };
  hasAnyRole.mockClear().mockResolvedValue(false);
  buildScopeWhereClause.mockClear().mockResolvedValue({ sql: "1=0", params: [] });
  hasScopedAccess.mockClear().mockResolvedValue(false);
  getUserAssignmentScopes.mockClear().mockResolvedValue([]);
  dbExecute.mockReset().mockImplementation(async (sql: string, params: unknown[] = []) => {
    executed.push({ sql, params });
    if (/SELECT COUNT\(\*\) AS total/.test(sql)) return [[{ total: 4321 }], []];
    // The bulk route's single branch-resolution query.
    if (/COALESCE\(ar\.branch_id, e\.branch_id\) AS branch_id/.test(sql)) {
      return [(params as string[]).map((id) => ({ id, branch_id: BRANCH_OF[id] ?? null })), []];
    }
    // regularizationReviewRole()'s target lookup — it returns null before reaching
    // hasScopedAccess if this comes back empty.
    if (/FROM attendance_regularization ar\s+JOIN employees e/.test(sql)) {
      const id = String((params as unknown[])[0]);
      return [[{
        employee_id: "emp-target", status: "manager_approved",
        branch_id: BRANCH_OF[id] ?? null, process_id: "p-1", lob_id: null,
        department_id: null, reporting_manager_id: "emp-someone-else", manager_id: null,
      }], []];
    }
    return [[], []];
  });
});

// ── 1. The list endpoint is bounded ──────────────────────────────────────────
describe("GET /regularizations is always bounded", () => {
  it("applies a LIMIT even when the caller asks for no filters at all", async () => {
    const res = await request(app()).get("/api/wfm/regularizations");
    expect(res.status).toBe(200);
    // This is the exact regression: the request the page used to send, unfiltered.
    expect(listQuery()!.sql).toMatch(/LIMIT \d+ OFFSET \d+/);
  });

  it("clamps an over-large limit rather than honouring it", async () => {
    await request(app()).get("/api/wfm/regularizations?limit=100000");
    // 500 is REGULARIZATION_PAGE_LIMIT_MAX. Without the clamp a caller could ask for
    // the whole table again and reproduce the 120 s timeout.
    expect(listQuery()!.sql).toMatch(/LIMIT 500 OFFSET 0/);
  });

  it("accepts a comma-separated status list so the queue loads in one call", async () => {
    await request(app()).get("/api/wfm/regularizations?status=pending,manager_approved,payroll_pending");
    const q = listQuery()!;
    // A plain `=` matched zero rows for a multi-status filter — the same defect
    // already fixed in leave.secure.routes.ts.
    expect(q.sql).toMatch(/ar\.status IN \(\?,\?,\?\)/);
    expect(q.params).toEqual(expect.arrayContaining(["pending", "manager_approved", "payroll_pending"]));
  });

  it("reports the true total so a capped page does not read as the whole set", async () => {
    const res = await request(app()).get("/api/wfm/regularizations?limit=10");
    expect(countQuery()).toBeDefined();
    expect(res.body.total).toBe(4321);
    expect(res.body.limit).toBe(10);
  });

  it("pages with offset derived from page number", async () => {
    await request(app()).get("/api/wfm/regularizations?limit=25&page=3");
    expect(listQuery()!.sql).toMatch(/LIMIT 25 OFFSET 50/);
  });
});

// ── 2. Reporting managers can see their team's requests ──────────────────────
describe("listScope grants a reporting manager their team", () => {
  it("ORs a reporting-manager clause in even when the caller holds no scope row", async () => {
    // buildScopeWhereClause returns 1=0 — exactly the live situation, since zero
    // user_assignment_scope rows carry scope_type='team'.
    buildScopeWhereClause.mockResolvedValue({ sql: "1=0", params: [] });
    await request(app()).get("/api/wfm/regularizations");
    const q = listQuery()!;
    expect(q.sql).toMatch(/COALESCE\(e\.reporting_manager_id, e\.manager_id\) = \?/);
    // Their own requests remain visible alongside their team's.
    expect(q.sql).toMatch(/e\.id = \?/);
    expect(q.params.filter((p) => p === "emp-caller").length).toBeGreaterThanOrEqual(2);
  });

  it("covers the skip-level approver when the direct manager is on approved leave", async () => {
    // resolveEffectiveApprover escalates to the manager's manager while the direct
    // manager is on leave today. Without this leg the escalation target would inherit
    // the authority to approve and the same inability to find the row.
    await request(app()).get("/api/wfm/regularizations");
    const sql = listQuery()!.sql;
    expect(sql).toMatch(/FROM leave_request lr/);
    expect(sql).toMatch(/lr\.status IN \('approved', 'branch_head_approved'\)/);
    expect(sql).toMatch(/lr\.from_date <= CURDATE\(\)/);
  });

  it("keeps a scope row AND the reporting line — a branch scope no longer hides an out-of-branch report", async () => {
    buildScopeWhereClause.mockResolvedValue({ sql: "e.branch_id = ?", params: ["branch-noida-2"] });
    await request(app()).get("/api/wfm/regularizations");
    const q = listQuery()!;
    expect(q.sql).toMatch(/e\.branch_id = \?/);
    expect(q.sql).toMatch(/COALESCE\(e\.reporting_manager_id, e\.manager_id\) = \?/);
    expect(q.params).toEqual(expect.arrayContaining(["branch-noida-2", "emp-caller"]));
  });

  it("still returns nothing for a caller with neither a scope row nor an employee record", async () => {
    const { getEmployeeForUser } = await import("../../../shared/accessGuard.js");
    (getEmployeeForUser as any).mockResolvedValueOnce(null);
    buildScopeWhereClause.mockResolvedValue({ sql: "1=0", params: [] });
    await request(app()).get("/api/wfm/regularizations");
    expect(listQuery()!.sql).toMatch(/WHERE \(1=0\)/);
  });
});

// ── 3. Bulk approval is role- and branch-gated ───────────────────────────────
describe("PATCH /regularizations/bulk-review enforces the branch RBAC ruling", () => {
  const bulk = (ids: string[]) =>
    request(app()).patch("/api/wfm/regularizations/bulk-review").send({ ids, status: "approved" });

  it("refuses a caller holding none of the bulk approval roles", async () => {
    hasAnyRole.mockResolvedValue(false);
    const res = await bulk(["reg-own-branch"]);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Branch WFM, Branch Payroll HR, Payroll Head and Super Admin/);
    // Nothing was attempted — the gate is before the loop, not inside it.
    expect(executed.some((q) => /UPDATE attendance_regularization/.test(q.sql))).toBe(false);
  });

  it("refuses a manager: approving one request is not authority to sweep a queue", async () => {
    // The role list is the whole point — a reporting manager can still use
    // PATCH /regularizations/:id/review, which this ruling does not touch.
    actor = { id: "u-mgr", role: "manager", roles: ["manager"] };
    hasAnyRole.mockImplementation(async (_u: string, ...roles: string[]) =>
      roles.includes("manager") && roles.length > 4);
    const res = await bulk(["reg-own-branch"]);
    expect(res.status).toBe(403);
  });

  it("refuses a branch-role holder who has no scope row at all (fail-closed)", async () => {
    hasAnyRole.mockImplementation(async (_u: string, ...roles: string[]) => roles.includes("wfm"));
    getUserAssignmentScopes.mockResolvedValue([]);
    const res = await bulk(["reg-own-branch"]);
    expect(res.status).toBe(403);
  });

  it("lets Branch WFM sweep its own branch and refuses another branch in the same request", async () => {
    hasAnyRole.mockImplementation(async (_u: string, ...roles: string[]) => roles.includes("wfm"));
    getUserAssignmentScopes.mockResolvedValue([
      { id: "s1", role_key: "wfm", scope_type: "branch", branch_id: "branch-noida-2" },
    ]);
    const res = await bulk(["reg-own-branch", "reg-other-branch"]);

    const byId = Object.fromEntries((res.body.data as any[]).map((r) => [r.id, r]));
    // The cross-branch id is refused by the branch guard specifically...
    expect(byId["reg-other-branch"].httpStatus).toBe(403);
    expect(byId["reg-other-branch"].message).toMatch(/another branch/);
    // ...while the in-branch id was allowed past the guard and into review.
    expect(byId["reg-own-branch"].message).not.toMatch(/another branch/);
  });

  it("refuses a row whose branch cannot be resolved rather than waving it through", async () => {
    // attendance_regularization.branch_id is NULL on 131,301 of 131,353 live rows, so
    // an unresolvable branch is the common case, not an exotic one.
    hasAnyRole.mockImplementation(async (_u: string, ...roles: string[]) => roles.includes("wfm"));
    getUserAssignmentScopes.mockResolvedValue([
      { id: "s1", role_key: "wfm", scope_type: "branch", branch_id: "branch-noida-2" },
    ]);
    const res = await bulk(["reg-no-branch"]);
    expect((res.body.data as any[])[0].httpStatus).toBe(403);
  });

  it("does not run the branch-resolution query for an all-branch role", async () => {
    // Payroll Head and Super Admin are org-wide BY ROLE per the ruling.
    hasAnyRole.mockImplementation(async (_u: string, ...roles: string[]) => roles.includes("payroll_head"));
    await bulk(["reg-other-branch"]);
    expect(executed.some((q) => /COALESCE\(ar\.branch_id, e\.branch_id\) AS branch_id/.test(q.sql))).toBe(false);
  });

  it("widens stage-2 approval to the branch bulk roles for the bulk path only", async () => {
    hasAnyRole.mockImplementation(async (_u: string, ...roles: string[]) => roles.includes("wfm"));
    getUserAssignmentScopes.mockResolvedValue([
      { id: "s1", role_key: "wfm", scope_type: "branch", branch_id: "branch-noida-2" },
    ]);
    await bulk(["reg-own-branch"]);
    // hasScopedAccess is reached through _performReview -> regularizationReviewRole.
    const rolesArg = hasScopedAccess.mock.calls.at(-1)?.[1] as string[] | undefined;
    expect(rolesArg).toBeDefined();
    // "payroll" included: the live branch payroll HR users file their branch scope
    // rows under that key, not under payroll_hr.
    expect(rolesArg).toEqual(expect.arrayContaining(["wfm", "payroll_hr", "payroll"]));
  });

  it("admits a branch payroll HR whose branch scope row is filed under `payroll`", async () => {
    // The live shape, verified 2026-08-27: Sheelu Verma and Sandeep Patel hold BOTH
    // payroll_hr and payroll, and only the `payroll` grant carries a branch row.
    // Resolving scopes against payroll_hr alone returned an empty set and 403'd them.
    hasAnyRole.mockImplementation(async (_u: string, ...roles: string[]) => roles.includes("payroll_hr"));
    getUserAssignmentScopes.mockImplementation(async (_u: string, roles: string[]) =>
      roles.includes("payroll")
        ? [{ id: "s2", role_key: "payroll", scope_type: "branch", branch_id: "branch-noida-2" }]
        : []);
    const res = await bulk(["reg-own-branch"]);
    // Asserted on the BRANCH guard specifically. The row then continues into the
    // ordinary review checks, which this test leaves unmocked — so the assertion is
    // "the branch check let it through", not "the approval completed".
    expect((res.body.data as any[])[0].message).not.toMatch(/another branch/);
    // And prove the scope lookup was actually asked about the `payroll` key.
    const rolesAsked = getUserAssignmentScopes.mock.calls.at(-1)?.[1] as string[];
    expect(rolesAsked).toContain("payroll");
  });

  it("leaves the per-row review path on the narrow WFM-only role set", async () => {
    // The single-row path must NOT inherit the bulk widening — that is why the role
    // list is a parameter rather than a change to the shared constant.
    hasAnyRole.mockResolvedValue(false);
    await request(app())
      .patch("/api/wfm/regularizations/reg-own-branch/review")
      .send({ status: "approved" });
    const rolesArg = hasScopedAccess.mock.calls.at(-1)?.[1] as string[] | undefined;
    if (rolesArg) expect(rolesArg).not.toContain("payroll_hr");
  });
});
