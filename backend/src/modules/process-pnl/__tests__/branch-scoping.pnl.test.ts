import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Branch scoping (owner ruling 2026-10-01) for the process-pnl pages that admit branch_head / payroll_branch:
 *  - tax-amendment preflight / list by budgetId
 *  - cost-centre overrides list + options
 *  - billability (payroll_branch is the only non-org-wide role there)
 * The caller's own branch is b1. Org-wide roles are unaffected.
 */
const { execute, budgetGet } = vi.hoisted(() => ({ execute: vi.fn(), budgetGet: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists: vi.fn().mockResolvedValue(true) }));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../branch-budget.service.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../branch-budget.service.js")>();
  return {
    ...original,
    branchBudgetService: {
      ...original.branchBudgetService,
      get: budgetGet,
      getTaxAmendmentPreflight: vi.fn(async () => ({ canAmend: true })),
      listTaxAmendments: vi.fn(async () => []),
    },
  };
});

let actor: { id: string; role: string; roles: string[] } = { id: "u1", role: "branch_head", roles: ["branch_head"] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; req.userRoles = actor.roles; next(); } };
});

import { processPnlRouter } from "../process-pnl.routes.js";
import billabilityRouter from "../billability.routes.js";

function appAs(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.authUser = actor; req.userRoles = actor.roles; next(); });
  app.use("/api/finance/billability", billabilityRouter);
  app.use("/api/finance", processPnlRouter);
  return app;
}
const find = (re: RegExp) => execute.mock.calls.find((c) => re.test(String(c[0])));

beforeEach(() => {
  execute.mockReset();
  budgetGet.mockReset();
  budgetGet.mockImplementation(async (id: string) => ({ id, branch_id: id === "bud-own" ? "b1" : "b2" }));
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (/FROM user_assignment_scope/.test(q)) return [[], []];
    // resolveUserBusinessScope: role rows then employee row
    if (/SELECT role_key FROM user_roles/.test(q)) return [[{ role_key: actor.role }], []];
    if (/SELECT id, employee_code, branch_id/.test(q)) return [[{ id: "emp-me", branch_id: "b1" }], []];
    if (/SELECT branch_id\s+FROM employees/.test(q)) return [[{ branch_id: "b1" }], []];
    if (/AS active_employees/.test(q) || /AS cost_centres_with_staff/.test(q)) return [[{}], []];
    return [[], []];
  });
});

describe("tax amendment reads", () => {
  it("branch_head cannot read another branch's budget amendments or preflight", async () => {
    expect((await request(appAs("branch_head")).get("/api/finance/pnl/budget-tax-amendments?budgetId=bud-other")).status).toBe(403);
    expect((await request(appAs("branch_head")).get("/api/finance/pnl/budgets/bud-other/lines/l1/tax-amendment-preflight")).status).toBe(403);
  });
  it("branch_head can read its own; finance reads any", async () => {
    expect((await request(appAs("branch_head")).get("/api/finance/pnl/budget-tax-amendments?budgetId=bud-own")).status).toBe(200);
    expect((await request(appAs("finance")).get("/api/finance/pnl/budget-tax-amendments?budgetId=bud-other")).status).toBe(200);
  });
});

describe("cost-centre overrides", () => {
  it("list is limited to the caller's branch for branch_head, unfiltered for finance", async () => {
    await request(appAs("branch_head")).get("/api/finance/pnl/cost-centre-overrides");
    const c = find(/FROM pnl_employee_cost_centre_override ov/)!;
    expect(String(c[0])).toMatch(/e\.branch_id IN \(\?\) OR tccm\.branch_id IN \(\?\)/);
    expect(c[1]).toEqual(["b1", "b1"]);
    execute.mockClear();
    await request(appAs("finance")).get("/api/finance/pnl/cost-centre-overrides");
    expect(String(find(/FROM pnl_employee_cost_centre_override ov/)![0])).not.toMatch(/branch_id IN/);
  });
  it("cost-centre options: foreign ?branchId is 403, own narrows, default is pinned to the branch", async () => {
    expect((await request(appAs("branch_head")).get("/api/finance/pnl/cost-centre-overrides/cost-centres?branchId=b2")).status).toBe(403);
    expect((await request(appAs("branch_head")).get("/api/finance/pnl/cost-centre-overrides/cost-centres")).status).toBe(200);
    expect(String(find(/FROM cost_centre_master cc/)![0])).toMatch(/cc\.branch_id IN \(\?\)/);
  });
});

describe("billability (payroll_branch)", () => {
  it("employee lookup, matrix, split candidates and exceptions are filtered to the caller's branch", async () => {
    for (const p of ["employee-lookup?q=abc", "matrix", "split-candidates", "exceptions"]) {
      execute.mockClear();
      const res = await request(appAs("payroll_branch")).get(`/api/finance/billability/${p}`);
      expect(res.status, p).toBe(200);
      const scoped = execute.mock.calls.filter((c) => /FROM employees/.test(String(c[0])) && /AND \(e\.id = \?|e\.branch_id = \?|1=0/.test(String(c[0])));
      expect(scoped.length, `${p} must carry the employee scope predicate`).toBeGreaterThan(0);
    }
  });
  it("payroll_head / finance / super_admin are not filtered", async () => {
    for (const role of ["payroll_head", "finance", "super_admin"]) {
      execute.mockClear();
      await request(appAs(role)).get("/api/finance/billability/split-candidates");
      expect(String(find(/FROM employees e/)![0]), role).not.toMatch(/e\.branch_id = \?/);
    }
  });
  it("seat rates / cost-centre lists are limited to the branch's cost centres", async () => {
    await request(appAs("payroll_branch")).get("/api/finance/billability/seat-rates");
    expect(String(find(/FROM cost_centre_seat_rate r/)![0])).toMatch(/cc\.branch_id IN \(\?\)/);
  });
  it("per-employee allocations of an out-of-branch employee are refused", async () => {
    // caller scope: own employee e-me, branch b1; target employee in b2
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (/SELECT role_key FROM user_roles/.test(q)) return [[{ role_key: "payroll_branch" }], []];
      if (/FROM user_assignment_scope/.test(q) && /role_key, scope_type/.test(q)) return [[{ role_key: "payroll_branch", scope_type: "branch", branch_id: "b1" }], []];
      if (/FROM user_assignment_scope/.test(q)) return [[], []];
      if (/SELECT id, employee_code, branch_id/.test(q)) return [[{ id: "emp-me", branch_id: "b1" }], []];
      if (/FROM employees\s+WHERE id = \?/.test(q)) return [[{ id: "emp-b", branch_id: "b2" }], []];
      if (/SELECT branch_id\s+FROM employees/.test(q)) return [[{ branch_id: "b1" }], []];
      return [[], []];
    });
    expect((await request(appAs("payroll_branch")).get("/api/finance/billability/allocations/emp-b")).status).toBe(403);
    expect((await request(appAs("payroll_branch")).post("/api/finance/billability/allocations/emp-b")
      .send({ effectiveFrom: "2026-10-01", allocations: [], changeReason: "x" })).status).toBe(403);
  });
  it("seat-rate write for another branch's cost centre is refused", async () => {
    // allowed cost centres of b1 = [cc-own]; cc-other is not among them
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (/FROM user_assignment_scope/.test(q)) return [[], []];
      if (/SELECT branch_id\s+FROM employees/.test(q)) return [[{ branch_id: "b1" }], []];
      if (/SELECT cc\.id, cc\.cost_centre_code FROM cost_centre_master cc/.test(q)) return [[{ id: "cc-own", cost_centre_code: "X/1" }], []];
      return [[], []];
    });
    const res = await request(appAs("payroll_branch")).post("/api/finance/billability/seat-rates")
      .send({ costCentreId: "cc-other", seatRateMonthly: 100, effectiveFrom: "2026-10-01", changeReason: "r" });
    expect(res.status).toBe(403);
  });
});

describe("P&L drilldown by process", () => {
  it("branch_head cannot drill into another branch's process", async () => {
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (/FROM user_assignment_scope/.test(q)) return [[], []];
      if (/SELECT role_key FROM user_roles/.test(q)) return [[{ role_key: actor.role }], []];
      if (/SELECT id, employee_code, branch_id/.test(q)) return [[{ id: "emp-me", branch_id: "b1" }], []];
      if (/SELECT branch_id\s+FROM employees/.test(q)) return [[{ branch_id: "b1" }], []];
      if (/SELECT branch_id FROM process_master WHERE id = \?/.test(q)) return [[{ branch_id: "b2" }], []];
      return [[], []];
    });
const res = await request(appAs("branch_head")).get("/api/finance/pnl/drilldown?period=2026-09&processId=p-other&metric=revenue");
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    const ok = await request(appAs("finance_head")).get("/api/finance/pnl/drilldown?period=2026-09&processId=p-other&metric=revenue");
    expect(ok.status).not.toBe(403);
  });
});
