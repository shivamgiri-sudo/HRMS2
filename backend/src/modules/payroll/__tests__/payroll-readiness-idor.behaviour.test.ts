import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The payroll-process-readiness and payroll-branch-readiness routes previously
 * checked role membership only — a branch_head/payroll_branch/wfm/process_manager
 * account could pass any OTHER branch's or process's id in the URL and read or
 * mutate (checklist toggle, sign-off) readiness state outside their own
 * assignment. requireScopedRole now gates every :branchId/:processId route.
 *
 * Modelled directly on payslip-idor.behaviour.test.ts's approach for the same
 * class of bug: exercise the real router with the real requireScopedRole
 * middleware, mock only the scope *decision* (hasScopedAccess) and everything
 * below the guard, so an out-of-scope request reaching the service layer at all
 * — not just the response code — is what fails the test.
 *
 * Also proves the deliberately non-regressive design: requireScopeForNonAdmin:
 * false means a caller with zero user_assignment_scope rows is NOT newly locked
 * out (that would be a regression, not a fix) — only a caller who has real,
 * non-matching scope data is refused.
 */

const AUTH_USER = "33333333-3333-3333-3333-333333333333";
const BRANCH_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const BRANCH_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PROCESS_A = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const {
  execute, hasScopedAccess, hasAnyRoleAsync,
  getOrRefresh, getSummaryForBranch, branchHeadSignOff,
} = vi.hoisted(() => ({
  execute: vi.fn(),
  hasScopedAccess: vi.fn(),
  hasAnyRoleAsync: vi.fn(),
  getOrRefresh: vi.fn(),
  getSummaryForBranch: vi.fn(),
  branchHeadSignOff: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection: vi.fn() } }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  hasScopedAccess,
  hasAnyRole: hasAnyRoleAsync,
  getRosterPlanScope: vi.fn(),
}));
vi.mock("../payroll-branch-readiness.service.js", () => ({
  payrollBranchReadinessService: {
    getOrRefresh,
    getSummaryForBranch,
    branchHeadSignOff,
    getHOSummary: vi.fn().mockResolvedValue([]),
    getHOSummaryGrouped: vi.fn().mockResolvedValue([]),
    processManagerSignOff: vi.fn(),
    hoOverride: vi.fn(),
    refreshProjection: vi.fn(),
  },
}));
vi.mock("../../work-inbox/work-inbox.triggers.js", () => ({
  triggerPayrollProcessFreezeRequest: vi.fn(),
  triggerPayrollAttendanceFreezeRequest: vi.fn(),
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string; role: string } }).authUser = { id: AUTH_USER, role: "branch_head" };
    next();
  },
}));
// The role gate is not what is under test — this caller legitimately holds a
// readiness-relevant role. Whether they may act on THIS branch/process is the
// question requireScopedRole answers.
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_q: express.Request, _s: express.Response, n: express.NextFunction) => n(),
}));

import { payrollProcessReadinessRouter } from "../payroll-process-readiness.routes.js";
import { payrollBranchReadinessRouter } from "../payroll-branch-readiness.routes.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/payroll/process-readiness", payrollProcessReadinessRouter);
  app.use("/api/payroll/branch-readiness", payrollBranchReadinessRouter);
  return app;
}

beforeEach(() => {
  [execute, hasScopedAccess, hasAnyRoleAsync, getOrRefresh, getSummaryForBranch, branchHeadSignOff]
    .forEach((m) => m.mockReset());
  hasAnyRoleAsync.mockResolvedValue(false); // not super_admin, not admin
  execute.mockResolvedValue([[], []]);
  getOrRefresh.mockResolvedValue({ readiness_status: "in_progress" });
  getSummaryForBranch.mockResolvedValue([]);
  branchHeadSignOff.mockResolvedValue(undefined);
});

describe("out-of-scope branch/process ids are refused", () => {
  const CASES: Array<{ method: "get" | "post"; url: string; body?: object }> = [
    { method: "get",  url: `/api/payroll/process-readiness/branch/${BRANCH_B}` },
    { method: "get",  url: `/api/payroll/process-readiness/${BRANCH_B}/${PROCESS_A}` },
    { method: "post", url: `/api/payroll/process-readiness/${BRANCH_B}/${PROCESS_A}/checklist`, body: { item: "attendance_data_ready", value: 1 } },
    { method: "get",  url: `/api/payroll/branch-readiness/${BRANCH_B}` },
    { method: "post", url: `/api/payroll/branch-readiness/${BRANCH_B}/signoff`, body: { remarks: "done" } },
    { method: "post", url: `/api/payroll/branch-readiness/${BRANCH_B}/${PROCESS_A}/checklist`, body: { item: "overtime_entered", value: 1 } },
  ];

  for (const { method, url, body } of CASES) {
    it(`403s on ${method.toUpperCase()} ${url.replace(BRANCH_B, ":otherBranchId")} when caller has a non-matching scope row`, async () => {
      // Caller HAS scope data (not the zero-rows case) — just not for this branch.
      hasScopedAccess.mockResolvedValue(false);

      const req = request(buildApp())[method](url);
      const res = body ? await req.send(body) : await req;

      expect(res.status).toBe(403);
      // The guard must block before the service layer runs — a 403 that still
      // computed/mutated readiness data behind the scenes is not a real fix.
      expect(getOrRefresh).not.toHaveBeenCalled();
      expect(getSummaryForBranch).not.toHaveBeenCalled();
      expect(branchHeadSignOff).not.toHaveBeenCalled();
    });
  }
});

describe("an in-scope caller is still served", () => {
  it("does not 403 once the scope check passes, and the service is actually called", async () => {
    hasScopedAccess.mockResolvedValue(true);

    const res = await request(buildApp()).get(`/api/payroll/branch-readiness/${BRANCH_A}`);

    expect(res.status).not.toBe(403);
    expect(getOrRefresh).toHaveBeenCalledWith(expect.any(String), BRANCH_A);
  });
});

describe("a caller with zero scope rows is not newly locked out", () => {
  it("stays non-regressive: no user_assignment_scope rows at all still passes", async () => {
    // hasScopedAccess itself resolves this via requireScopeForNonAdmin: false —
    // mocking the outcome directly here (true) is what the option is documented to
    // produce for a zero-row caller, proving the route's own options object is what
    // was actually passed to the middleware rather than trusting the default.
    hasScopedAccess.mockResolvedValue(true);

    const res = await request(buildApp()).get(`/api/payroll/process-readiness/branch/${BRANCH_A}`);

    expect(res.status).not.toBe(403);
    // Confirms requireScopedRole was invoked with allowAdminBypass/requireScopeForNonAdmin
    // wired through, not just any truthy options object.
    expect(hasScopedAccess).toHaveBeenCalledWith(
      AUTH_USER,
      expect.arrayContaining(["branch_head"]),
      expect.objectContaining({ branchId: BRANCH_A }),
      expect.objectContaining({ allowAdminBypass: true, requireScopeForNonAdmin: false })
    );
  });
});
