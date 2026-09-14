import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bulk payroll exports were gated by requireRole alone — role membership, never
 * branch/process scope. A branch-scoped payroll user could download decrypted
 * bank account numbers for the entire organisation.
 *
 * The fix deliberately treats the two export kinds differently:
 *
 *  - Bank files (neft-summary, neft-export, and the neft-lines feed) DENY a
 *    scoped caller rather than row-filtering. A silently branch-filtered
 *    payment file is indistinguishable from a complete one once downloaded, so
 *    filtering would turn "pay everyone" into "pay my branch" — an underpayment
 *    that is worse than the leak being fixed.
 *  - The salary-sheet export is a report, so it row-filters to the caller's
 *    scope the way /runs and /records already do.
 *
 * Mounts the router directly (pf-creation.access.test.ts's pattern) rather than
 * importing app.ts.
 */

const RUN_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const AUTH_USER_ID = "33333333-3333-3333-3333-333333333333";

const { execute, hasOrgWideScope, hasAnyRole, getUserAssignmentScopes, buildScopeWhereClause, hasRole, getEmployeeForUser } = vi.hoisted(() => ({
  execute: vi.fn(),
  hasOrgWideScope: vi.fn(),
  // Fixed 2026-08-17 (Section M RBAC audit): the bank-file endpoints below no longer call
  // hasOrgWideScope (it trusts bare `admin` membership with no scope row — see
  // bank-export-gating.contract.test.ts) — they call a local hasExportScope() built from
  // these two primitives instead, matching bank-payment-readiness.routes.ts's reference
  // implementation. hasOrgWideScope is kept mocked here only because buildScopeWhereClause's
  // sibling salary-sheet-export tests import from the same module.
  hasAnyRole: vi.fn(),
  getUserAssignmentScopes: vi.fn(),
  buildScopeWhereClause: vi.fn(),
  hasRole: vi.fn(),
  getEmployeeForUser: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/scopeAccess.js", () => ({ hasOrgWideScope, hasAnyRole, getUserAssignmentScopes, buildScopeWhereClause }));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRole, getEmployeeForUser }));
vi.mock("../../../config/env.js", () => ({ env: { PAYROLL_BANK_KEY: "test-bank-key" } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string } }).authUser = { id: AUTH_USER_ID };
    next();
  },
}));
// requireRole is the "may you call this" gate; these tests are about "over whom",
// so it is allowed through and the scope rule is what gets asserted.
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import { payrollExtendedRouter } from "../payroll-extended.routes.js";

function buildApp() {
  const app = express();
  app.use("/api/payroll", payrollExtendedRouter);
  return app;
}

/** A settled run — isRunClosed is the real implementation, so this must be a real closed status. */
const RUN_ROW: [Array<Record<string, unknown>>] = [[{ id: RUN_ID, run_month: "2026-07", status: "FINALIZED" }]];

describe("bank-file exports deny a branch-scoped caller instead of emitting a partial file", () => {
  beforeEach(() => {
    execute.mockReset();
    hasOrgWideScope.mockReset();
    hasAnyRole.mockReset();
    getUserAssignmentScopes.mockReset();
    buildScopeWhereClause.mockReset();
  });

  /** hasExportScope: holds a payroll-export role but not super_admin, with only a branch-scope row. */
  function mockBranchScopedCaller() {
    hasAnyRole.mockImplementation(async (_userId, ...roles) => !roles.includes("super_admin"));
    getUserAssignmentScopes.mockResolvedValue([{ scope_type: "branch" }]);
  }

  /** hasExportScope: holds a payroll-export role with an explicit scope_type='all' row. */
  function mockOrgWideCaller() {
    hasAnyRole.mockImplementation(async (_userId, ...roles) => !roles.includes("super_admin"));
    getUserAssignmentScopes.mockResolvedValue([{ scope_type: "all" }]);
  }

  for (const path of ["neft-summary", "neft-export"]) {
    it(`GET /runs/:id/${path} returns 403 for a branch-scoped caller and touches no bank data`, async () => {
      mockBranchScopedCaller();

      const res = await request(buildApp()).get(`/api/payroll/runs/${RUN_ID}/${path}`);

      expect(res.status).toBe(403);
      // The guard runs before any query, so no account number is ever decrypted.
      expect(execute).not.toHaveBeenCalled();
    });
  }

  it("GET /runs/:id/neft-export still serves a full CSV for an org-wide caller", async () => {
    mockOrgWideCaller();
    execute
      .mockResolvedValueOnce(RUN_ROW)
      .mockResolvedValueOnce([[
        {
          employee_id: "e1", net_salary: 25000, employee_code: "MAS001", full_name: "Test One",
          bank_name: "HDFC", ifsc_code: "HDFC0001", account_number: Buffer.from("1234567890"),
        },
      ]]);

    const res = await request(buildApp()).get(`/api/payroll/runs/${RUN_ID}/neft-export`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text).toContain("MAS001");
  });

  it("GET /runs/:id/neft-export denies an admin-only caller with no scope_type='all' row (the actual production gap this fixed)", async () => {
    // The vulnerability this session found: hasOrgWideScope() trusted bare `admin` membership
    // with zero scope rows. hasExportScope must not repeat that — holding only `admin` (never
    // super_admin, and not one of PAYROLL_EXPORT_ROLES) must fail closed.
    hasAnyRole.mockResolvedValue(false); // holds neither super_admin nor a PAYROLL_EXPORT_ROLES role
    getUserAssignmentScopes.mockResolvedValue([]);

    const res = await request(buildApp()).get(`/api/payroll/runs/${RUN_ID}/neft-export`);

    expect(res.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("salary-sheet export row-filters to the caller's scope", () => {
  beforeEach(() => {
    execute.mockReset();
    hasOrgWideScope.mockReset();
    buildScopeWhereClause.mockReset();
  });

  it("appends the scope clause and its params to the export query for a branch-scoped caller", async () => {
    buildScopeWhereClause.mockResolvedValue({ sql: "e.branch_id = ?", params: ["branch-a"] });
    execute
      .mockResolvedValueOnce(RUN_ROW)
      .mockResolvedValueOnce([[]]);

    const res = await request(buildApp()).get(`/api/payroll/runs/${RUN_ID}/salary-sheet-export`);

    expect(res.status).toBe(200);
    const [sql, params] = execute.mock.calls[1];
    expect(sql).toContain("AND (e.branch_id = ?)");
    // What matters for scoping: runId binds before the scope params, and the scope
    // params come last because the clause is appended. Asserted positionally rather
    // than as a fixed array — the SELECT's own binds are an implementation detail
    // (they were an encryption key until the account column turned out to be
    // varbinary rather than encrypted), and pinning them made this test fail for a
    // reason unrelated to what it is checking.
    expect(params.at(-1)).toBe("branch-a");
    expect(params).toContain(RUN_ID);
    expect(params.indexOf(RUN_ID)).toBeLessThan(params.length - 1);
  });

  it("returns the whole run unfiltered for an org-wide caller", async () => {
    buildScopeWhereClause.mockResolvedValue({ sql: "1=1", params: [] });
    execute
      .mockResolvedValueOnce(RUN_ROW)
      .mockResolvedValueOnce([[]]);

    const res = await request(buildApp()).get(`/api/payroll/runs/${RUN_ID}/salary-sheet-export`);

    expect(res.status).toBe(200);
    const [sql, params] = execute.mock.calls[1];
    expect(sql).toContain("AND (1=1)");
    // An org-wide caller contributes no scope params, so runId is the final bind.
    expect(params.at(-1)).toBe(RUN_ID);
  });

  it("refuses a caller with no assigned scope rather than downloading an empty workbook", async () => {
    // buildScopeWhereClause yields 1=0 for a user with no scope row. Serving that
    // would produce a valid, empty .xlsx that reads as "this run has no payroll".
    buildScopeWhereClause.mockResolvedValue({ sql: "1=0", params: [] });
    execute.mockResolvedValueOnce(RUN_ROW);

    const res = await request(buildApp()).get(`/api/payroll/runs/${RUN_ID}/salary-sheet-export`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/no branch or process scope/i);
    // Only the run lookup ran; the salary register was never queried.
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
