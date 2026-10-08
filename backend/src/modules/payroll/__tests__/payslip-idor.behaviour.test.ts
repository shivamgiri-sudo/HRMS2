import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The per-employee payslip and salary routes must refuse an employee outside the
 * caller's branch/process scope.
 *
 * requireRole answers "may you call this" and never "about whom". These routes
 * checked role membership only, so a branch-scoped hr/finance/payroll user could
 * read any employee's salary org-wide by changing the id in the URL. The sibling
 * list endpoints (/runs, /records) had applied scope filtering for some time;
 * these were never brought in line.
 *
 * This exercises the routes rather than reading the source. The existing
 * payslip-employee-scope.contract.test.ts asserts that requireScopedRole appears
 * in the right places, which catches a revert but would not catch the middleware
 * being wired so it never rejects — and for a fix of this severity "the code looks
 * right" is the wrong standard of proof.
 *
 * requireScopedRole and hasScopedAccess are the units under test, so the real
 * middleware is used and only the scope *decision* is mocked. Everything below the
 * guard is mocked to fail loudly: if a handler is ever reached for an out-of-scope
 * employee, the assertions on the data mocks catch it.
 */

const SELF = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const AUTH_USER = "33333333-3333-3333-3333-333333333333";
const RUN_ID = "44444444-4444-4444-4444-444444444444";

const {
  execute, hasScopedAccess, buildScopeWhereClause, hasAnyRoleAsync, hasOrgWideScope,
  getEmployeeForUser, hasRole, getPayslip,
} = vi.hoisted(() => ({
  execute: vi.fn(),
  hasScopedAccess: vi.fn(),
  buildScopeWhereClause: vi.fn(),
  hasAnyRoleAsync: vi.fn(),
  hasOrgWideScope: vi.fn(),
  getEmployeeForUser: vi.fn(),
  hasRole: vi.fn(),
  getPayslip: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection: vi.fn() } }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  hasScopedAccess, buildScopeWhereClause, hasOrgWideScope, hasAnyRole: hasAnyRoleAsync,
}));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser, hasRole }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../payslip.service.js", () => ({ payslipService: { getPayslip, generatePayslip: vi.fn() } }));
vi.mock("../payroll.controller.js", () => ({
  payrollController: new Proxy({}, { get: () => vi.fn((_r: unknown, res: express.Response) => res.json({ reached: true })) }),
}));
vi.mock("../payrollCalculate.service.js", () => ({ calculatePayrollRun: vi.fn(), calculatePayrollRunScoped: vi.fn() }));
vi.mock("../payroll-governance.service.js", () => ({ payrollGovernanceService: { readiness: vi.fn() } }));
vi.mock("../payroll-attendance-control.service.js", () => ({ payrollAttendanceControlService: {} }));
vi.mock("../payroll-branch-readiness.service.js", () => ({ payrollBranchReadinessService: {} }));
vi.mock("../taxDeclaration.service.js", () => ({ taxDeclarationService: {} }));
vi.mock("../tds-certificate-part-a.service.js", () => ({ getPartAAvailability: vi.fn() }));
vi.mock("../payrollWindowGuard.js", () => ({ assertRunEditable: vi.fn() }));
vi.mock("../statutory-config.loader.js", () => ({ loadFlatStatutoryConfig: vi.fn() }));
vi.mock("../statutory-regime.js", () => ({ statutoryRegimeForFinancialYear: vi.fn(), missingTdsConfigKeys: vi.fn() }));
vi.mock("../holiday-debug.routes.js", () => ({ holidayDebugRouter: express.Router() }));
vi.mock("../../../middleware/rateLimiter.js", () => ({ payrollRunLimiter: (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../../middleware/requireWFMAccess.js", () => ({ requireWFMAccess: () => (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string; role: string } }).authUser = { id: AUTH_USER, role: "hr" };
    next();
  },
}));
// The role gate is not what is under test — these callers legitimately hold a
// payroll role. Whether they may see THIS employee is the question.
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_q: express.Request, _s: express.Response, n: express.NextFunction) => n(),
}));

import { payrollRouter } from "../payroll.routes.js";

function buildApp() {
  const app = express();
  app.use("/api/payroll", payrollRouter);
  return app;
}

/** Routes that take an employee id and must respect scope. */
const SCOPED_ROUTES = [
  `/api/payroll/salary-assignments/${OTHER}`,
  `/api/payroll/salary-assignments/${OTHER}/history`,
  `/api/payroll/payslip/list/${OTHER}`,
  `/api/payroll/payslip/history/${OTHER}`,
  `/api/payroll/payslip/legacy/${OTHER}`,
];

beforeEach(() => {
  [execute, hasScopedAccess, buildScopeWhereClause, hasAnyRoleAsync, hasOrgWideScope,
   getEmployeeForUser, hasRole, getPayslip].forEach((m) => m.mockReset());
  // The caller holds a payroll role but is scoped to a different branch.
  hasRole.mockResolvedValue(true);
  hasAnyRoleAsync.mockResolvedValue(true);
  getEmployeeForUser.mockResolvedValue({ id: SELF, employee_code: "SELF001" });
  hasScopedAccess.mockResolvedValue(false);
  buildScopeWhereClause.mockResolvedValue({ sql: "1=1", params: [] });
  // Any query reaching the database would mean the guard was bypassed.
  execute.mockResolvedValue([[], []]);
  getPayslip.mockResolvedValue({ run_month: "2026-07", net_salary: 99999 });
});

describe("out-of-scope employee ids are refused", () => {
  for (const url of SCOPED_ROUTES) {
    it(`403s on GET ${url.replace(OTHER, ":otherEmployeeId")}`, async () => {
      const res = await request(buildApp()).get(url);

      expect(res.status).toBe(403);

      // Deciding scope legitimately requires one lookup of the *target's* branch and
      // process — that query carries no pay data. What must never run is a read of
      // the salary tables themselves: withholding figures from the response body
      // while still fetching them is not the same as refusing access.
      const sql = execute.mock.calls.map((c) => String(c[0]));
      for (const table of ["salary_prep_line", "employee_salary_assignment", "legacy_payslip_snapshot", "salary_payslip"]) {
        expect(sql.join(" | "), `${table} was queried for an out-of-scope employee`).not.toContain(table);
      }
      expect(JSON.stringify(res.body)).not.toContain("99999");
    });
  }

  it("403s on GET /payslip/:runId/:employeeId and never calls the payslip service", async () => {
    const res = await request(buildApp()).get(`/api/payroll/payslip/${RUN_ID}/${OTHER}`);

    expect(res.status).toBe(403);
    expect(getPayslip).not.toHaveBeenCalled();
  });

  it("403s on GET /form16-data/:runId/:employeeId", async () => {
    const res = await request(buildApp()).get(`/api/payroll/form16-data/${RUN_ID}/${OTHER}`);
    expect(res.status).toBe(403);
  });
});

describe("an in-scope caller is still served", () => {
  it("does not 403 once the scope check passes", async () => {
    // Guards against the opposite failure: a fix that simply denies everyone would
    // pass every assertion above while breaking payroll for legitimate users.
    hasScopedAccess.mockResolvedValue(true);
    getPayslip.mockResolvedValue({ run_month: "2026-07", net_salary: 25000 });

    const res = await request(buildApp()).get(`/api/payroll/payslip/${RUN_ID}/${OTHER}`);

    expect(res.status).not.toBe(403);
    expect(getPayslip).toHaveBeenCalled();
  });
});

describe("self-service is unaffected by scope", () => {
  it("an employee reading their own payslip is not scope-checked", async () => {
    // Employees hold no payroll role and no assignment scope; requiring one would
    // lock every employee out of their own payslip.
    hasRole.mockResolvedValue(false);
    hasScopedAccess.mockResolvedValue(false);
    getPayslip.mockResolvedValue({ run_month: "2026-07", net_salary: 25000 });

    const res = await request(buildApp()).get(`/api/payroll/payslip/${RUN_ID}/${SELF}`);

    expect(res.status).not.toBe(403);
    expect(hasScopedAccess).not.toHaveBeenCalled();
  });
});
