import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Admin is BRANCH-SCOPED like hr (owner ruling 2026-10-01). payable-days overrides, the UAN endpoints and the
 * loan write endpoints used to trust a role list only: admin (and payroll_admin) could read / change another
 * branch's employee. They now go through payroll-branch-scope (canViewEmployee under the hood); org-wide roles
 * get "1=1" / pass the guard and are unaffected.
 */
const m = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  hasAnyRole: vi.fn(),
  hasRole: vi.fn(),
  scope: vi.fn(),
  guard: vi.fn(),
  visible: new Set<string>(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: m.dbExecute, query: m.dbExecute } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1", role: "admin" }; next(); },
  requireWriteAccess: (_q: any, _s: any, next: any) => next(),
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../../../shared/scopeAccess.js", async (orig) => ({ ...(await orig<any>()), hasAnyRole: m.hasAnyRole }));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRole: m.hasRole, getEmployeeForUser: vi.fn(async () => ({ id: "emp-self", employee_code: "E1" })) }));
vi.mock("../payroll-branch-scope.js", () => ({
  employeeScopeFor: m.scope,
  guardEmployee: m.guard,
}));

const { payableDaysOverrideRouter } = await import("../payable-days-override.routes.js");
const { payrollExtendedRouter } = await import("../payroll-extended.routes.js");
const { loansRouter } = await import("../loans.routes.js");

const app = () => {
  const a = express();
  a.use(express.json());
  a.use("/pd", payableDaysOverrideRouter);
  a.use("/ext", payrollExtendedRouter);
  a.use("/loans", loansRouter);
  return a;
};

beforeEach(() => {
  Object.values(m).forEach((f: any) => typeof f?.mockReset === "function" && f.mockReset());
  m.visible = new Set(["emp-own"]);
  m.hasAnyRole.mockResolvedValue(true);
  m.hasRole.mockResolvedValue(true);
  m.scope.mockResolvedValue({ sql: "e.branch_id = ?", params: ["branch-a"] });
  m.guard.mockImplementation(async (_req: any, res: any, id: string) => {
    if (m.visible.has(String(id))) return true;
    res.status(403).json({ success: false, message: "outside your branch" });
    return false;
  });
  m.dbExecute.mockResolvedValue([[], []]);
});

describe("payable-days overrides: admin is own-branch", () => {
  it("list carries the caller's branch predicate", async () => {
    const res = await request(app()).get("/pd");
    expect(res.status).toBe(200);
    const [sql, params] = m.dbExecute.mock.calls[0];
    expect(sql).toMatch(/\(e\.branch_id = \?\)/);
    expect(params).toContain("branch-a");
  });
  it("list for an org-wide caller stays unfiltered", async () => {
    m.scope.mockResolvedValue({ sql: "1=1", params: [] });
    await request(app()).get("/pd");
    expect(String(m.dbExecute.mock.calls[0][0])).not.toMatch(/1=1|branch_id = \?/);
  });
  it("POST for an employee of another branch is 403 and writes nothing", async () => {
    const res = await request(app()).post("/pd").send({ employee_id: "emp-other", run_month: "2026-09", payable_days: 20, reason: "long enough reason" });
    expect(res.status).toBe(403);
    expect(m.dbExecute).not.toHaveBeenCalled();
  });
  it("GET /current and GET /:id and DELETE /:id refuse another branch's employee", async () => {
    expect((await request(app()).get("/pd/current?employeeId=emp-other&runMonth=2026-09")).status).toBe(403);
    m.dbExecute.mockResolvedValue([[{ id: "o1", employee_id: "emp-other", run_month: "2026-09", active_status: 1 }], []]);
    expect((await request(app()).get("/pd/o1")).status).toBe(403);
    const del = await request(app()).delete("/pd/o1").send({ reason: "withdrawn for a good reason" });
    expect(del.status).toBe(403);
    expect(m.dbExecute.mock.calls.some(([q]) => /UPDATE payroll_payable_days_override/.test(String(q)))).toBe(false);
  });
  it("GET /current for an own-branch employee proceeds", async () => {
    const res = await request(app()).get("/pd/current?employeeId=emp-own&runMonth=2026-09");
    expect(res.status).toBe(200);
  });
});

describe("UAN endpoints: admin is own-branch", () => {
  it("GET another branch's UAN is 403 for a privileged non-self caller", async () => {
    const res = await request(app()).get("/ext/uan/emp-other");
    expect(res.status).toBe(403);
    expect(m.dbExecute).not.toHaveBeenCalled();
  });
  it("GET an own-branch UAN works; own record never needs the guard", async () => {
    expect((await request(app()).get("/ext/uan/emp-own")).status).toBe(200);
    m.guard.mockClear();
    expect((await request(app()).get("/ext/uan/emp-self")).status).toBe(200);
    expect(m.guard).not.toHaveBeenCalled();
  });
  it("POST another branch's UAN is 403 and nothing is written", async () => {
    const res = await request(app()).post("/ext/uan/emp-other").send({ uan: "100200300400" });
    expect(res.status).toBe(403);
    expect(m.dbExecute).not.toHaveBeenCalled();
  });
});

describe("loans: admin is own-branch", () => {
  it("creating a loan for another branch's employee is 403 before any lookup", async () => {
    const res = await request(app()).post("/loans").send({
      employee_id: "emp-other", loan_type: "salary_advance", amount: 1000, start_date: "2026-10-01", installments: 2, deduction_per_month: 500,
    });
    expect(res.status).toBe(403);
    expect(m.dbExecute).not.toHaveBeenCalled();
  });
  it.each([
    ["post", "/loans/l1/approve", {}],
    ["post", "/loans/l1/reject", { reason: "no" }],
    ["patch", "/loans/l1", { reason: "x" }],
    ["post", "/loans/l1/record-payment", { amount_paid: 10 }],
  ] as const)("%s %s refuses another branch's loan and does not write", async (verb, url, body) => {
    m.dbExecute.mockResolvedValue([[{ id: "l1", employee_id: "emp-other", created_by: "someone", status: "active" }], []]);
    const res = await (request(app()) as any)[verb](url).send(body);
    expect(res.status).toBe(403);
    expect(m.dbExecute.mock.calls.every(([q]) => /^\s*SELECT/i.test(String(q)))).toBe(true);
  });
});
