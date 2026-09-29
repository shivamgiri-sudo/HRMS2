import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /payslip/my (every employee's payslip page) did one salary_prep_line_component query per
 * payslip line plus a sequential legacy read. Components are now fetched in one query and the
 * legacy read runs alongside. The per-line earnings/deductions/employer_costs split, their order,
 * and the absence of a line_id key on each component must not change.
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
  getEmployeeForUser.mockResolvedValue({ id: "emp-1" });
  execute.mockImplementation(async (sql: string) => {
    if (/FROM salary_prep_line spl/.test(sql))
      return [[
        { id: "L1", run_month: "2026-08", run_status: "finalized", basic: 0, hra: 5, special_allowance: 0, pan_number: null, pan_number_encrypted: null },
        { id: "L2", run_month: "2026-07", run_status: "finalized", basic: 9, hra: 9, special_allowance: 9, pan_number: null, pan_number_encrypted: null },
      ], []];
    if (/FROM salary_prep_line_component/.test(sql))
      return [[
        { line_id: "L1", component_code: "BASIC", component_name: "Basic", component_type: "earning", amount: "100", taxable: 1 },
        { line_id: "L1", component_code: "PF", component_name: "PF", component_type: "deduction", amount: "12", taxable: 0 },
        { line_id: "L2", component_code: "ER_PF", component_name: "ER PF", component_type: "employer_cost", amount: "12", taxable: 0 },
      ], []];
    if (/FROM legacy_payslip_snapshot/.test(sql))
      return [[{ legacy_id: "g1", run_month: "2026-07", source: "legacy" }, { legacy_id: "g2", run_month: "2026-01", source: "legacy" }], []];
    return [[], []];
  });
});

describe("GET /api/payroll/payslip/my", () => {
  it("fetches all components in one query and keeps the per-line split and shape", async () => {
    const year = String(new Date().getFullYear());
    const res = await request(app).get(`/api/payroll/payslip/my?year=${year}`);
    expect(res.status).toBe(200);
    const compQueries = execute.mock.calls.filter(([s]) => /FROM salary_prep_line_component/.test(String(s)));
    expect(compQueries).toHaveLength(1);
    expect(compQueries[0][1]).toEqual(["L1", "L2"]);
    const [a, b, legacyOnly] = res.body.data;
    expect(a.id).toBe("L1");
    expect(a.earnings).toEqual([{ component_code: "BASIC", component_name: "Basic", component_type: "earning", amount: "100", taxable: 1 }]);
    expect(a.deductions.map((c: any) => c.component_code)).toEqual(["PF"]);
    expect(a.employer_costs).toEqual([]);
    expect(a.basic).toBe(100);           // NULL/0 basic back-filled from the BASIC component
    expect(a.hra).toBe(5);
    expect(b.employer_costs.map((c: any) => c.component_code)).toEqual(["ER_PF"]);
    expect(b.basic).toBe(9);
    // legacy row for a month already covered by a run (2026-07) is dropped; 2026-01 is kept
    expect(res.body.data.map((r: any) => r.legacy_id ?? r.id)).toEqual(["L1", "L2", "g2"]);
    expect(legacyOnly.legacy_id).toBe("g2");
  });

  it("skips the component query when there are no lines", async () => {
    execute.mockImplementation(async () => [[], []]);
    const res = await request(app).get(`/api/payroll/payslip/my?year=${new Date().getFullYear()}`);
    expect(res.status).toBe(200);
    expect(execute.mock.calls.some(([s]) => /FROM salary_prep_line_component/.test(String(s)))).toBe(false);
  });
});

describe("GET /api/payroll/payslip/list/:employeeId", () => {
  it("returns page + total (queries issued together)", async () => {
    hasScopedAccess.mockResolvedValue(true);
    hasOrgWideScope.mockResolvedValue(true);
    hasAnyRoleAsync.mockResolvedValue(true);
    execute.mockImplementation(async (sql: string) =>
      /COUNT\(\*\) AS total/.test(sql) ? [[{ total: 3 }], []] : [[{ run_id: "r1" }], []]);
    const res = await request(app).get("/api/payroll/payslip/list/emp-9?page=1&limit=12");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [{ run_id: "r1" }], total: 3, page: 1, limit: 12 });
  });
});

describe("GET /api/payroll/analytics", () => {
  it("returns kpi + dimension rows for the picked run (both issued together)", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/COUNT\(\*\) OVER/.test(sql)) return [[{ id: "run-1", status: "finalized", siblings: 2 }], []];
      if (/AS headcount,\s+ROUND\(SUM\(spl\.net_salary\),2\)\s+AS total_net,\s+ROUND\(SUM\(spl\.net_salary\) \/ NULLIF/.test(sql)) return [[{ headcount: 5 }], []];
      if (/dimension_name/.test(sql)) return [[{ dimension_name: "Ops", headcount: 5 }], []];
      return [[], []];
    });
    const res = await request(app).get("/api/payroll/analytics?runMonth=2026-08&dimension=branch");
    expect(res.status).toBe(200);
    expect(res.body.kpi).toEqual({ headcount: 5 });
    expect(res.body.data).toEqual([{ dimension_name: "Ops", headcount: 5 }]);
    expect(res.body.meta).toMatchObject({ runId: "run-1", dimension: "branch", otherRunsInMonth: 1, isProvisional: false });
    const dimSql = String(execute.mock.calls.find(([s]) => /dimension_name/.test(String(s)))![0]);
    expect(dimSql).toMatch(/LEFT JOIN branch_master bm/);
  });
});
