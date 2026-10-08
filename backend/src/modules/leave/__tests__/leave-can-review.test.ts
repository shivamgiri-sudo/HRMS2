import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * can_review: the list tells the page which requests THIS caller may act on, using the same
 * rules as the review route. Before this, the page guessed from role names, so team leaders got
 * no buttons while HR/WFM got buttons the server answered with 403.
 */
const m = vi.hoisted(() => ({
  roles: new Set<string>(),
  callerEmpId: "emp-caller" as string | null,
  inScope: false,
  approverId: "emp-manager" as string | null,
  exceptionRole: "branch_head",
  resolveApprover: vi.fn(),
  exceptionLookup: vi.fn(),
}));

const dbExecute = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => [[], []] as any));
const scopeBuilder = vi.hoisted(() => vi.fn(async () => ({ sql: "1=1", params: [] })));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({ requireAuth: (_q: any, _s: any, n: any) => n() }));
vi.mock("../../../shared/reportingSpan.js", () => ({ reportingSpanClause: vi.fn(async () => null) }));
vi.mock("../../../shared/accessGuard.js", () => ({
  getEmployeeForUser: vi.fn(async () => (m.callerEmpId ? { id: m.callerEmpId } : null)),
}));
vi.mock("../../../shared/scopeAccess.js", () => ({
  buildScopeWhereClause: scopeBuilder,
  isOrgWideUser: vi.fn(async () => false),
  hasAnyRole: vi.fn(async (_u: string, ...roles: string[]) => roles.some((r) => m.roles.has(r))),
}));
vi.mock("../../../shared/enterpriseScope.js", () => ({ resolveUserBusinessScope: vi.fn(async () => ({})) }));
vi.mock("../../wfm/branch-scope.js", () => ({
  rowInScope: vi.fn(() => m.inScope),
  getScope: vi.fn(), canAccessEmployee: vi.fn(), OUT_OF_SCOPE_MSG: "out",
}));
vi.mock("../leave.service.js", () => ({ leaveService: {} }));
vi.mock("../../../shared/approvalEscalation.js", () => ({
  resolveEffectiveApprover: (...a: unknown[]) => { m.resolveApprover(...a); return Promise.resolve({ approverId: m.approverId }); },
}));
vi.mock("../leave-policy.service.js", () => ({
  leavePolicyService: { getExceptionApproverRole: (...a: unknown[]) => { m.exceptionLookup(...a); return Promise.resolve(m.exceptionRole); } },
}));

import express from "express";
import request from "supertest";
import { annotateCanReview, leaveSecureRouter, makeLeaveReviewChecker } from "../leave.secure.routes.js";

const req = (over: Record<string, unknown> = {}) => ({
  employee_id: "emp-a", status: "pending", leave_type_id: "lt-1", branch_id: "b1", process_id: "p1", reporting_manager_id: "emp-manager", ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.roles = new Set();
  m.callerEmpId = "emp-caller";
  m.inScope = false;
  m.approverId = "emp-manager";
  m.exceptionRole = "branch_head";
});

describe("makeLeaveReviewChecker", () => {
  it("never lets anyone review their own request, even super_admin", async () => {
    m.roles = new Set(["super_admin"]);
    const check = await makeLeaveReviewChecker("u1");
    expect(await check(req({ employee_id: "emp-caller" }))).toBe(false);
  });

  it("lets super_admin review anyone else's", async () => {
    m.roles = new Set(["super_admin"]);
    expect(await (await makeLeaveReviewChecker("u1"))(req())).toBe(true);
  });

  it("admin/hr review only inside their scope, else fall through to the approver rule", async () => {
    m.roles = new Set(["hr"]);
    m.inScope = true;
    expect(await (await makeLeaveReviewChecker("u1"))(req())).toBe(true);

    m.inScope = false;
    expect(await (await makeLeaveReviewChecker("u1"))(req())).toBe(false);
  });

  it("an ordinary request is reviewable only by the effective approver", async () => {
    m.callerEmpId = "emp-manager";
    expect(await (await makeLeaveReviewChecker("u1"))(req())).toBe(true);
    m.callerEmpId = "emp-someone-else";
    expect(await (await makeLeaveReviewChecker("u1"))(req())).toBe(false);
  });

  it("a team leader who is the effective approver can review (no role-name guess)", async () => {
    m.roles = new Set(["team_leader"]);
    m.callerEmpId = "emp-manager";
    expect(await (await makeLeaveReviewChecker("u1"))(req())).toBe(true);
  });

  it("an escalated request needs the exception-approver role, not just being the manager", async () => {
    m.callerEmpId = "emp-manager";
    const escalated = req({ status: "pending_branch_head" });
    expect(await (await makeLeaveReviewChecker("u1"))(escalated)).toBe(false);
    m.roles = new Set(["branch_head"]);
    expect(await (await makeLeaveReviewChecker("u1"))(escalated)).toBe(true);
  });

  it("looks the approver and the exception role up once per employee / leave type", async () => {
    m.callerEmpId = "emp-manager";
    const check = await makeLeaveReviewChecker("u1");
    await check(req());
    await check(req());
    await check(req({ status: "pending_branch_head" }));
    await check(req({ status: "pending_branch_head" }));
    expect(m.resolveApprover).toHaveBeenCalledTimes(1);
    expect(m.exceptionLookup).toHaveBeenCalledTimes(1);
  });
});

describe("annotateCanReview", () => {
  it("flags only open requests and defaults everything else to false", async () => {
    m.callerEmpId = "emp-manager";
    const rows: any[] = [
      { id: 1, status: "pending", employee_id: "emp-a", leave_type_id: "lt-1" },
      { id: 2, status: "approved", employee_id: "emp-a", leave_type_id: "lt-1" },
      { id: 3, status: "cancelled", employee_id: "emp-a", leave_type_id: "lt-1" },
      { id: 4, status: "pending", employee_id: "emp-manager", leave_type_id: "lt-1" },
    ];
    await annotateCanReview("u1", rows);
    expect(rows.map((r) => r.can_review)).toEqual([true, false, false, false]);
  });

  it("does no caller lookups when there is nothing open to review", async () => {
    const rows: any[] = [{ id: 1, status: "approved", employee_id: "emp-a" }];
    await annotateCanReview("u1", rows);
    expect(rows[0].can_review).toBe(false);
    expect(m.resolveApprover).not.toHaveBeenCalled();
  });
});

describe("GET /requests?mine=1", () => {
  const app = () => {
    const a = express();
    a.use((req: any, _res, next) => { req.authUser = { id: "u1" }; next(); });
    a.use("/", leaveSecureRouter);
    return a;
  };

  it("pins the scope to the caller's own employee row instead of the role's scope", async () => {
    m.callerEmpId = "emp-caller";
    const res = await request(app()).get("/requests?mine=1&limit=50");
    expect(res.status).toBe(200);
    expect(scopeBuilder).not.toHaveBeenCalled();
    const listCall = dbExecute.mock.calls.find((c) => String(c[0]).includes("FROM leave_request lr"))!;
    expect(String(listCall[0])).toContain("e.id = ?");
    expect(listCall[1]).toContain("emp-caller");
  });

  it("returns nothing for a login with no employee record", async () => {
    m.callerEmpId = null;
    await request(app()).get("/requests?mine=1");
    const listCall = dbExecute.mock.calls.find((c) => String(c[0]).includes("FROM leave_request lr"))!;
    expect(String(listCall[0])).toContain("1=0");
  });
});
