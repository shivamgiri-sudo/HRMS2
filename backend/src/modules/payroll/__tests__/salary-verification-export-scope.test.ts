import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /salary-verification/export accepted branchId/processId as optional,
 * client-supplied query params with no server-side enforcement. Any caller
 * holding wfm, process_manager or branch_head — roles that should only ever
 * see their own branch/process — could omit both and receive up to 10,000
 * employees' salary register org-wide (working days, gross, deductions, net
 * pay, and any open discrepancy-flag notes).
 *
 * Fix: non-org-wide callers (wfm, process_manager, branch_head) now have
 * their own branchId/processId resolved from their employee record and
 * enforced, regardless of what the client sends. Org-wide callers
 * (super_admin, payroll_head) are unaffected — they may still request an
 * unfiltered, org-wide export exactly as before.
 *
 * Mounts the router directly (pf-creation.access.test.ts's pattern) rather
 * than importing app.ts. Uses format=csv throughout to avoid needing to
 * stand up the xlsx workbook path — the scoping fix is identical for both
 * formats since both build the same empRows query.
 */

const AUTH_USER_ID = "33333333-3333-3333-3333-333333333333";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

let authUser: { id: string; roleKeys: string[] } = { id: AUTH_USER_ID, roleKeys: [] };
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: typeof authUser }).authUser = authUser;
    next();
  },
}));

import { salaryVerificationRouter } from "../salary-verification.routes.js";

function buildApp() {
  const app = express();
  app.use("/api/payroll/salary-verification", salaryVerificationRouter);
  return app;
}

/** getRunForMonth finds no run for the month — keeps the per-employee loop untouched. */
const NO_RUN: [Array<Record<string, unknown>>] = [[]];

describe("GET /salary-verification/export branch/process scope", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("enforces the branch_head caller's own branch even when branchId/processId are omitted", async () => {
    authUser = { id: AUTH_USER_ID, roleKeys: ["branch_head"] };
    execute
      .mockResolvedValueOnce([[{ branch_id: "branch-A", process_id: "proc-A" }], []]) // resolveActorOwnScope
      .mockResolvedValueOnce(NO_RUN) // getRunForMonth
      .mockResolvedValueOnce([[], []]); // empRows

    const res = await request(buildApp()).get("/api/payroll/salary-verification/export?format=csv");

    expect(res.status).toBe(200);
    const [empSql, empParams] = execute.mock.calls[2];
    expect(empSql).toContain("e.branch_id = ?");
    expect(empSql).not.toContain("e.process_id = ?");
    expect(empParams).toEqual(["branch-A"]);
  });

  it("enforces the process_manager caller's own process even when branchId/processId are omitted", async () => {
    authUser = { id: AUTH_USER_ID, roleKeys: ["process_manager"] };
    execute
      .mockResolvedValueOnce([[{ branch_id: "branch-B", process_id: "proc-B" }], []]) // resolveActorOwnScope
      .mockResolvedValueOnce(NO_RUN)
      .mockResolvedValueOnce([[], []]);

    const res = await request(buildApp()).get("/api/payroll/salary-verification/export?format=csv");

    expect(res.status).toBe(200);
    const [empSql, empParams] = execute.mock.calls[2];
    expect(empSql).toContain("e.process_id = ?");
    expect(empSql).not.toContain("e.branch_id = ?");
    expect(empParams).toEqual(["proc-B"]);
  });

  it("a wfm caller's own process is enforced regardless of a client-supplied processId, even alongside an extra branchId filter", async () => {
    // Regression guard: the whole point of the fix is that a scoped caller cannot
    // widen the query by supplying (or omitting) params — their own process always
    // wins over the client-supplied processId. A client-supplied branchId is left
    // in place as an additional AND'd filter (it can only narrow further, since the
    // enforced process_id already confines results to the actor's own process), so
    // it is not itself a widening vector and this test asserts it stays that way.
    authUser = { id: AUTH_USER_ID, roleKeys: ["wfm"] };
    execute
      .mockResolvedValueOnce([[{ branch_id: "branch-C", process_id: "proc-C" }], []])
      .mockResolvedValueOnce(NO_RUN)
      .mockResolvedValueOnce([[], []]);

    const res = await request(buildApp()).get(
      "/api/payroll/salary-verification/export?format=csv&branchId=someone-elses-branch&processId=someone-elses-process"
    );

    expect(res.status).toBe(200);
    const [empSql, empParams] = execute.mock.calls[2];
    expect(empSql).toContain("e.process_id = ?");
    // The enforced own-process value, never the client-supplied "someone-elses-process".
    expect(empParams).toContain("proc-C");
    expect(empParams).not.toContain("someone-elses-process");
  });

  it("denies a branch-scoped caller with no resolvable employee record, rather than falling through unrestricted", async () => {
    authUser = { id: AUTH_USER_ID, roleKeys: ["branch_head"] };
    execute.mockResolvedValueOnce([[], []]); // resolveActorOwnScope finds nothing

    const res = await request(buildApp()).get("/api/payroll/salary-verification/export?format=csv");

    expect(res.status).toBe(403);
    // Only the scope-resolution query ran — the salary register was never queried.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("still serves an unfiltered, org-wide export for payroll_head (unchanged behaviour)", async () => {
    authUser = { id: AUTH_USER_ID, roleKeys: ["payroll_head"] };
    execute
      .mockResolvedValueOnce(NO_RUN) // getRunForMonth — no scope-resolution query for an org-wide caller
      .mockResolvedValueOnce([[], []]); // empRows

    const res = await request(buildApp()).get("/api/payroll/salary-verification/export?format=csv");

    expect(res.status).toBe(200);
    // Two queries total: no resolveActorOwnScope call was made for an org-wide caller.
    expect(execute).toHaveBeenCalledTimes(2);
    const [empSql, empParams] = execute.mock.calls[1];
    expect(empSql).not.toContain("e.branch_id = ?");
    expect(empSql).not.toContain("e.process_id = ?");
    expect(empParams).toEqual([]);
  });

  it("still honours an explicit branchId query param for an org-wide super_admin caller (unchanged behaviour)", async () => {
    authUser = { id: AUTH_USER_ID, roleKeys: ["super_admin"] };
    execute
      .mockResolvedValueOnce(NO_RUN)
      .mockResolvedValueOnce([[], []]);

    const res = await request(buildApp()).get(
      "/api/payroll/salary-verification/export?format=csv&branchId=chosen-branch"
    );

    expect(res.status).toBe(200);
    const [empSql, empParams] = execute.mock.calls[1];
    expect(empSql).toContain("e.branch_id = ?");
    expect(empParams).toEqual(["chosen-branch"]);
  });
});
