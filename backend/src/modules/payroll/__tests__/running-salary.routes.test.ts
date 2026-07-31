import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The employee self-service route and the payroll/HR route must return the SAME
 * running-month figures for the same person and month. Three UI surfaces render
 * one shared RunningMonthCard against these two endpoints — Attendance Hub and
 * Running Payroll read `/running-summary/:employeeId`, the payslip page reads
 * `/running-summary/me` because employees are not authorized on the former.
 *
 * If the two ever drift, the same employee sees one number on their payslip page
 * and a different one when HR opens their record. These tests pin that shut.
 */

const EMPLOYEE_ID = "11111111-1111-1111-1111-111111111111";
const AUTH_USER_ID = "22222222-2222-2222-2222-222222222222";
const RUN_MONTH = "2026-07";

const { execute, computeRunningSalary, hasAnyRole, buildScopeWhereClause } = vi.hoisted(() => ({
  execute: vi.fn(),
  computeRunningSalary: vi.fn(),
  hasAnyRole: vi.fn(),
  buildScopeWhereClause: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../running-salary.service.js", () => ({ computeRunningSalary }));
vi.mock("../../../shared/scopeAccess.js", () => ({ hasAnyRole, buildScopeWhereClause }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string } }).authUser = { id: AUTH_USER_ID };
    next();
  },
}));

import { runningSalaryRouter } from "../running-salary.routes.js";

const LIVE_ESTIMATE = {
  earned_payable_days: 22,
  eligible_weekoff_till_date: 4,
  eligible_holiday_till_date: 1,
  lwp_till_date: 0.5,
  earned_salary_till_date: 18432.26,
  earned_net_till_date: 17180.26,
  projected_payable_days: 31,
  projected_salary: 25132,
  projected_net: 23315,
  pf_employee: 1800,
  esic_employee: 0,
  professional_tax: 200,
  esic_applicable: false,
  gross_monthly: 25132,
};

/** The employee falls inside the caller's assigned scope. */
const IN_SCOPE = [[{ 1: 1 }]];
/** Out of scope: the scope-probe SELECT matches no row. */
const OUT_OF_SCOPE = [[]];

/** No finalized run for the month — handlers fall through to the live estimate. */
function withNoFinalizedRun(scopeProbe: unknown = IN_SCOPE) {
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes("auth_user_id")) return [[{ id: EMPLOYEE_ID }]];
    if (sql.includes("FROM employees e WHERE e.id")) return scopeProbe;
    return [[]];
  });
}

/** A locked run exists — handlers must return the stored line instead. */
function withFinalizedRun(row: Record<string, unknown>) {
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes("auth_user_id")) return [[{ id: EMPLOYEE_ID }]];
    if (sql.includes("FROM employees e WHERE e.id")) return IN_SCOPE;
    if (sql.includes("salary_prep_line")) return [[row]];
    return [[]];
  });
}

function buildApp() {
  const app = express();
  app.use("/api/payroll", runningSalaryRouter);
  return app;
}

describe("running-summary routes", () => {
  beforeEach(() => {
    execute.mockReset();
    computeRunningSalary.mockReset();
    hasAnyRole.mockReset();
    buildScopeWhereClause.mockReset();
    hasAnyRole.mockResolvedValue(true);
    // Default: an org-wide scope (scope_type='all' resolves to 1=1).
    buildScopeWhereClause.mockResolvedValue({ sql: "1=1", params: [] });
    computeRunningSalary.mockResolvedValue(LIVE_ESTIMATE);
  });

  it("returns identical live-estimate figures from /me and /:employeeId", async () => {
    withNoFinalizedRun();
    const app = buildApp();

    const self = await request(app).get(`/api/payroll/running-summary/me?month=${RUN_MONTH}`);
    const admin = await request(app).get(`/api/payroll/running-summary/${EMPLOYEE_ID}?month=${RUN_MONTH}`);

    expect(self.status).toBe(200);
    expect(admin.status).toBe(200);
    expect(self.body.data).toEqual(admin.body.data);
    expect(self.body.data.earned_salary_till_date).toBe(LIVE_ESTIMATE.earned_salary_till_date);
    expect(self.body.run_month).toBe(admin.body.run_month);

    // Both must ask the engine for the same employee and the same month.
    expect(computeRunningSalary).toHaveBeenCalledTimes(2);
    const [selfArgs, adminArgs] = computeRunningSalary.mock.calls;
    expect(selfArgs[0]).toBe(EMPLOYEE_ID);
    expect(adminArgs[0]).toBe(EMPLOYEE_ID);
    expect(selfArgs[1]).toBe(adminArgs[1]);
    expect(selfArgs[1]).toBe(`${RUN_MONTH}-01`);
  });

  it("returns identical stored figures from both routes once the run is locked", async () => {
    withFinalizedRun({
      gross_salary: 25132, total_deductions: 2000, net_salary: 23132,
      basic: 10000, hra: 5000, special_allowance: 10132,
      pf_employee: 1800, esic_employee: 0, professional_tax: 200, tds: 0,
      final_payable_days: 31, paid_working_days: 26,
      eligible_weekoff_days: 4, eligible_holiday_days: 1,
      active_calendar_days: 31, lwp_days: 0, present_days: 26,
      run_status: "locked", run_month: RUN_MONTH,
    });
    const app = buildApp();

    const self = await request(app).get(`/api/payroll/running-summary/me?month=${RUN_MONTH}`);
    const admin = await request(app).get(`/api/payroll/running-summary/${EMPLOYEE_ID}?month=${RUN_MONTH}`);

    expect(self.body.data).toEqual(admin.body.data);
    expect(self.body.data.is_finalized).toBe(true);
    // The card reads the earned_* aliases, so they must carry the stored amounts.
    expect(self.body.data.earned_salary_till_date).toBe(25132);
    expect(self.body.data.earned_net_till_date).toBe(23132);
    expect(self.body.data.earned_payable_days).toBe(31);
    // Live computation must be skipped entirely — the stored line is authoritative.
    expect(computeRunningSalary).not.toHaveBeenCalled();
  });

  it("keeps /me scoped to the caller's own employee record", async () => {
    withNoFinalizedRun();

    await request(buildApp()).get(`/api/payroll/running-summary/me?month=${RUN_MONTH}`);

    const lookup = execute.mock.calls.find(([sql]) => String(sql).includes("auth_user_id"));
    expect(lookup).toBeDefined();
    expect(lookup![1]).toEqual([AUTH_USER_ID]);
    expect(computeRunningSalary).toHaveBeenCalledWith(EMPLOYEE_ID, `${RUN_MONTH}-01`, undefined);
  });

  it("authorizes every role that can open a page rendering the card", async () => {
    withNoFinalizedRun();

    await request(buildApp()).get(`/api/payroll/running-summary/${EMPLOYEE_ID}?month=${RUN_MONTH}`);

    expect(hasAnyRole).toHaveBeenCalled();
    const [, ...allowedRoles] = hasAnyRole.mock.calls[0] as [string, ...string[]];
    // /payroll/running-breakdown grants wfm; /hr/attendance-lookup grants wfm and
    // payroll_admin. If this endpoint does not, those users reach the page and take
    // a 403 on the only figure it exists to show. hasAnyRole compares role_key
    // exactly, so there is no alias normalisation to rely on here.
    for (const role of [
      "super_admin", "admin", "payroll_head", "payroll_branch", "payroll",
      "payroll_admin", "hr", "hr_admin", "wfm", "branch_head", "management",
    ]) {
      expect(allowedRoles).toContain(role);
    }
  });

  it("denies an employee outside the caller's assigned scope", async () => {
    // Right role, wrong employee: the scope probe matches no row.
    withNoFinalizedRun(OUT_OF_SCOPE);
    buildScopeWhereClause.mockResolvedValue({ sql: "e.branch_id = ?", params: ["branch-A"] });

    const res = await request(buildApp()).get(`/api/payroll/running-summary/${EMPLOYEE_ID}?month=${RUN_MONTH}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/outside your assigned scope/i);
    // The salary must never be computed for someone the caller cannot see.
    expect(computeRunningSalary).not.toHaveBeenCalled();
  });

  it("scopes the per-employee lookup by the caller's scope clause", async () => {
    withNoFinalizedRun();
    buildScopeWhereClause.mockResolvedValue({ sql: "e.branch_id = ?", params: ["branch-A"] });

    await request(buildApp()).get(`/api/payroll/running-summary/${EMPLOYEE_ID}?month=${RUN_MONTH}`);

    const probe = execute.mock.calls.find(([sql]) => String(sql).includes("FROM employees e WHERE e.id"));
    expect(probe).toBeDefined();
    expect(String(probe![0])).toContain("e.branch_id = ?");
    // Employee id first, then the scope clause's own params.
    expect(probe![1]).toEqual([EMPLOYEE_ID, "branch-A"]);
    expect(computeRunningSalary).toHaveBeenCalled();
  });

  it("constrains the batch route to the caller's scope, not the requested branch", async () => {
    withNoFinalizedRun();
    buildScopeWhereClause.mockResolvedValue({ sql: "e.branch_id = ?", params: ["branch-A"] });

    // Caller asks for a branch that is not theirs.
    await request(buildApp())
      .get(`/api/payroll/running-summary-batch?month=${RUN_MONTH}&branch_id=branch-B`);

    const listQuery = execute.mock.calls.find(([sql]) => String(sql).includes("FROM employees e"));
    expect(listQuery).toBeDefined();
    // Both the requested filter AND the scope clause must be present: the requested
    // branch is a filter, the scope clause is the permission. Without the second,
    // branch_id=branch-B would return branch B's salaries to a branch A user.
    expect(String(listQuery![0])).toContain("e.branch_id = ?");
    expect(String(listQuery![0])).toContain("(e.branch_id = ?)");
    expect(listQuery![1]).toEqual(["branch-B", "branch-A"]);
  });

  it("denies the per-employee route to roles outside the payroll/HR set", async () => {
    withNoFinalizedRun();
    hasAnyRole.mockResolvedValue(false);

    const res = await request(buildApp()).get(`/api/payroll/running-summary/${EMPLOYEE_ID}?month=${RUN_MONTH}`);

    expect(res.status).toBe(403);
    expect(computeRunningSalary).not.toHaveBeenCalled();
  });
});
