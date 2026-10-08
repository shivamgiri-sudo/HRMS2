import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /filter-options used to run three sequential SELECT DISTINCT ... JOIN employees JOIN
 * salary_prep_line queries (did not finish in 10s on production). It now probes existence per
 * master row, in parallel. Pinned here: the SQL shape (no join to salary_prep_line, scalar
 * subquery rather than a flattenable EXISTS), scope + branch params in their original order, and
 * the response shape.
 */
const AUTH_USER = "33333333-3333-3333-3333-333333333333";
const {
  execute, hasScopedAccess, buildScopeWhereClause, hasAnyRoleAsync, hasOrgWideScope, getEmployeeForUser, hasRole,
} = vi.hoisted(() => ({
  execute: vi.fn(), hasScopedAccess: vi.fn(), buildScopeWhereClause: vi.fn(), hasAnyRoleAsync: vi.fn(),
  hasOrgWideScope: vi.fn(), getEmployeeForUser: vi.fn(), hasRole: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection: vi.fn() } }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  hasScopedAccess, buildScopeWhereClause, hasOrgWideScope, hasAnyRole: hasAnyRoleAsync,
}));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser, hasRole }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../payslip.service.js", () => ({ payslipService: { getPayslip: vi.fn(), generatePayslip: vi.fn() } }));
vi.mock("../payroll.controller.js", () => ({ payrollController: new Proxy({}, { get: () => vi.fn() }) }));
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
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_q: express.Request, _s: express.Response, n: express.NextFunction) => n(),
}));

import { payrollRouter } from "../payroll.routes.js";

const app = express();
app.use("/api/payroll", payrollRouter);

beforeEach(() => {
  execute.mockReset();
  execute.mockImplementation(async (sql: string) => {
    if (/FROM branch_master/.test(sql)) return [[{ id: "b1", branch_name: "B" }], []];
    if (/FROM process_master/.test(sql)) return [[{ id: "p1", process_name: "P" }], []];
    return [[{ id: "d1", dept_name: "D" }], []];
  });
});

describe("GET /api/payroll/filter-options", () => {
  it("returns branches, processes and departments; existence probes, scope params kept in order", async () => {
    buildScopeWhereClause.mockResolvedValue({ sql: "(e.branch_id = ?)", params: ["scopeB"] });
    const res = await request(app).get("/api/payroll/filter-options?branchId=selB");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      branches: [{ id: "b1", branch_name: "B" }],
      processes: [{ id: "p1", process_name: "P" }],
      departments: [{ id: "d1", dept_name: "D" }],
    });
    expect(execute).toHaveBeenCalledTimes(3);
    const byTable = (t: string) => execute.mock.calls.find((c) => String(c[0]).includes(`FROM ${t}`))!;
    for (const t of ["branch_master", "process_master", "department_master"]) {
      const sql = String(byTable(t)[0]);
      expect(sql).not.toMatch(/JOIN salary_prep_line/);
      expect(sql).toMatch(/\(SELECT e\.id FROM employees e[\s\S]*LIMIT 1\) IS NOT NULL/);
      expect(sql).toMatch(/\(\(e\.branch_id = \?\)\)/);
    }
    expect(byTable("branch_master")[1]).toEqual(["scopeB"]);
    expect(byTable("process_master")[1]).toEqual(["scopeB", "selB"]);
    expect(byTable("department_master")[1]).toEqual(["scopeB", "selB"]);
  });

  it("adds no scope predicate for an unrestricted caller", async () => {
    buildScopeWhereClause.mockResolvedValue({ sql: "1=1", params: [] });
    await request(app).get("/api/payroll/filter-options");
    for (const c of execute.mock.calls) {
      expect(String(c[0])).not.toMatch(/1=1/);
      expect(c[1]).toEqual([]);
    }
  });
});
