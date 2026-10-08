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
 * Also pins the zero-scope-row rule. That rule was inverted on 2026-09-04: it was
 * requireScopeForNonAdmin: false while scope rows were still being populated, and is now true, so
 * a caller with no scope row is refused instead of admitted everywhere. See the describe block at
 * the foot of this file for why, and for what was verified before flipping it.
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

describe("a caller with zero scope rows gets no branches, not every branch", () => {
  /*
   * THIS RULE WAS DELIBERATELY REVERSED on 2026-09-04, and the reversal is the point of the test.
   *
   * Scoping was introduced here non-regressively: requireScopeForNonAdmin was false, so a caller
   * with zero user_assignment_scope rows kept unrestricted access. That was correct at the time —
   * the scope rows did not exist yet, and locking people out while backfilling them would have been
   * a regression rather than a fix. It was a migration step.
   *
   * The migration finished. Checked against production on 2026-09-04: every holder of branch_head,
   * payroll_branch, payroll_hr, wfm, payroll_head or payroll has at least one active scope row filed
   * under one of those role keys, so closing the bypass locked nobody out. Left open, it meant the
   * next Branch Head created without a scope row would silently receive every branch in the company
   * — missing configuration granting more access than complete configuration, which is the wrong
   * way round for a guard whose entire job is to confine a branch user to one branch.
   *
   * If someone is refused here later, the fix is to give them a scope row, not to reopen this.
   */
  it("passes requireScopeForNonAdmin: true, so a zero-row caller fails closed", async () => {
    // hasScopedAccess is mocked, so what this proves is the options object the ROUTE hands the
    // middleware — which is the thing that decides the zero-row outcome. The decision itself lives
    // in hasScopedAccess and is covered by its own tests.
    hasScopedAccess.mockResolvedValue(true);

    const res = await request(buildApp()).get(`/api/payroll/process-readiness/branch/${BRANCH_A}`);

    expect(res.status).not.toBe(403);
    expect(hasScopedAccess).toHaveBeenCalledWith(
      AUTH_USER,
      expect.arrayContaining(["branch_head"]),
      expect.objectContaining({ branchId: BRANCH_A }),
      expect.objectContaining({ allowAdminBypass: true, requireScopeForNonAdmin: true })
    );
  });

  it("scopes Branch Payroll HR rather than admitting and then refusing it", async () => {
    /*
     * payroll_hr was admitted by requireRole on this route family and named in none of the scope
     * lists. hasScopedAccess refuses a caller holding none of the roles IT was given, before it ever
     * reads a scope row — so the role that actually does this work got a 403 whose message blamed
     * branch scope. Asserted on the call the route makes, so the two lists cannot drift apart again.
     */
    hasScopedAccess.mockResolvedValue(true);
    await request(buildApp()).get(`/api/payroll/process-readiness/branch/${BRANCH_A}`);

    const [, roles] = hasScopedAccess.mock.calls.at(-1)!;
    expect(roles).toContain("payroll_hr");
  });
});
