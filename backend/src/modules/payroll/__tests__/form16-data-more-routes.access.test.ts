import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /form16-data/:runId/:employeeId in payroll-more.routes.ts — a second,
 * independent implementation of the same route also defined in
 * payroll.routes.ts (see payroll-employee-scope architecture findings on the
 * duplication). A role check alone let any hr/finance/payroll user pull any
 * employee's Form 16 income/TDS data org-wide by supplying a different
 * :employeeId. Fixed by resolving the target employee's branch/process and
 * requiring hasScopedAccess to agree — the same rule /runs, /records and the
 * sibling payslip routes already enforce.
 *
 * Mounts the router directly (pf-creation.access.test.ts's pattern) rather
 * than importing app.ts.
 */

const RUN_ID = "aaaaaaaa-0000-0000-0000-000000000000";
const SELF_EMPLOYEE_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_EMPLOYEE_ID = "22222222-2222-2222-2222-222222222222";
const AUTH_USER_ID = "33333333-3333-3333-3333-333333333333";

const {
  execute,
  hasRole,
  getEmployeeForUser,
  hasScopedAccess,
  computeForm16Data,
} = vi.hoisted(() => ({
  execute: vi.fn(),
  hasRole: vi.fn(),
  getEmployeeForUser: vi.fn(),
  hasScopedAccess: vi.fn(),
  computeForm16Data: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/accessGuard.js", () => ({
  hasRole,
  getEmployeeForUser,
}));
vi.mock("../../../shared/scopeAccess.js", () => ({ hasScopedAccess }));
// The route now delegates its Part B computation to the shared service (both
// the canonical route in payroll.routes.ts and this shadowed duplicate call
// the same computeForm16Data). Mock it so this suite stays focused on the
// access-control invariant rather than the service's internal query sequence,
// which is exercised by form16-data.service's own tests.
vi.mock("../form16-data.service.js", () => ({ computeForm16Data }));
vi.mock("../payroll-targeted-recalculation.service.js", () => ({
  recalculateOpenPayrollForEmployee: vi.fn(),
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    (req as express.Request & { authUser: { id: string } }).authUser = {
      id: AUTH_USER_ID,
    };
    next();
  },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole:
    () =>
    (
      _req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) =>
      next(),
}));

import { payrollMoreRouter } from "../payroll-more.routes.js";

function buildApp() {
  const app = express();
  app.use("/api/payroll", payrollMoreRouter);
  return app;
}

const TARGET_IN_SCOPE_ROW: [
  Array<{ branch_id: string; process_id: string; department_id: null }>,
] = [[{ branch_id: "branch-a", process_id: "process-a", department_id: null }]];

describe("GET /api/payroll/form16-data/:runId/:employeeId (payroll-more.routes.ts)", () => {
  beforeEach(() => {
    execute.mockReset();
    hasRole.mockReset();
    getEmployeeForUser.mockReset();
    hasScopedAccess.mockReset();
    computeForm16Data.mockReset();
  });

  it("denies a payroll-role user reading another employee's Form 16 data when out of the caller's assigned scope", async () => {
    getEmployeeForUser.mockResolvedValue({
      id: SELF_EMPLOYEE_ID,
      employee_code: "E001",
    });
    hasRole.mockResolvedValue(true); // holds hr/finance/payroll
    execute.mockResolvedValueOnce(TARGET_IN_SCOPE_ROW); // target employee's branch/process resolved
    hasScopedAccess.mockResolvedValue(false); // but outside the caller's own scope

    const res = await request(buildApp()).get(
      `/api/payroll/form16-data/${RUN_ID}/${OTHER_EMPLOYEE_ID}`,
    );

    expect(res.status).toBe(403);
    // Nothing beyond the scope-resolution query should have run — no income/TDS data touched.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("allows an in-scope payroll-role user to read another employee's Form 16 data, as before", async () => {
    getEmployeeForUser.mockResolvedValue({
      id: SELF_EMPLOYEE_ID,
      employee_code: "E001",
    });
    hasRole.mockResolvedValue(true);
    execute.mockResolvedValueOnce(TARGET_IN_SCOPE_ROW); // target employee's branch/process resolved
    hasScopedAccess.mockResolvedValue(true);
    computeForm16Data.mockResolvedValue({
      ok: true,
      data: { gross_salary: 50000 },
    });

    const res = await request(buildApp()).get(
      `/api/payroll/form16-data/${RUN_ID}/${OTHER_EMPLOYEE_ID}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.gross_salary).toBe(50000);
    expect(computeForm16Data).toHaveBeenCalledWith(RUN_ID, OTHER_EMPLOYEE_ID);
  });

  it("allows self access without any role or scope lookup", async () => {
    getEmployeeForUser.mockResolvedValue({
      id: SELF_EMPLOYEE_ID,
      employee_code: "E001",
    });
    computeForm16Data.mockResolvedValue({
      ok: true,
      data: { gross_salary: 50000 },
    });

    const res = await request(buildApp()).get(
      `/api/payroll/form16-data/${RUN_ID}/${SELF_EMPLOYEE_ID}`,
    );

    expect(res.status).toBe(200);
    expect(hasRole).not.toHaveBeenCalled();
    expect(hasScopedAccess).not.toHaveBeenCalled();
    // Self path skips the access lookups and goes straight to the shared service.
    expect(computeForm16Data).toHaveBeenCalledWith(RUN_ID, SELF_EMPLOYEE_ID);
  });

  it("denies a caller with no payroll role who is also not the subject employee", async () => {
    getEmployeeForUser.mockResolvedValue({
      id: SELF_EMPLOYEE_ID,
      employee_code: "E001",
    });
    hasRole.mockResolvedValue(false);

    const res = await request(buildApp()).get(
      `/api/payroll/form16-data/${RUN_ID}/${OTHER_EMPLOYEE_ID}`,
    );

    expect(res.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
    expect(hasScopedAccess).not.toHaveBeenCalled();
  });
});
