import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Branch scoping for employees (owner ruling 2026-10-01): hr is limited to its own branch; the
 * mutating / auxiliary endpoints that used to trust the role alone now check the target employee.
 */
const { dbExecute, canViewEmployee, resolveScope, buildCond, isInSpan } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  canViewEmployee: vi.fn(),
  resolveScope: vi.fn(async () => ({ __scope: true })),
  buildCond: vi.fn((): { sql: string; params: unknown[] } => ({ sql: "e.branch_id = ?", params: ["branch-a"] })),
  isInSpan: vi.fn(async () => false),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute, query: dbExecute } }));
vi.mock("../../../shared/enterpriseScope.js", () => ({
  canViewEmployee, resolveUserBusinessScope: resolveScope, buildEmployeeScopeCondition: buildCond,
}));
vi.mock("../../../shared/reportingSpan.js", () => ({ isInReportingSpan: isInSpan }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-hr", role: "hr", roles: ["hr"] }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));

const { guardEmployeeScope } = await import("../employeeScopeGuard.js");

function app(opts: { span?: boolean } = {}) {
  const a = express();
  a.use((req: any, _res, next) => { req.authUser = { id: "u-hr" }; next(); });
  a.delete("/employees/:id", guardEmployeeScope("id"), (_q, res) => res.status(204).send());
  a.get("/employees/:id/journey", guardEmployeeScope("id", { allowReportingSpan: opts.span }), (_q, res) => res.json({ ok: true }));
  return a;
}

beforeEach(() => { canViewEmployee.mockReset(); isInSpan.mockReset(); isInSpan.mockResolvedValue(false); });

describe("guardEmployeeScope (DELETE /:id, journey, provision-account, bank-quality resubmission, docs)", () => {
  it("hr deleting an employee outside its branch is 403", async () => {
    canViewEmployee.mockResolvedValue(false);
    const res = await request(app()).delete("/employees/emp-b");
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/outside your branch/);
  });
  it("hr inside its branch / org-wide roles pass", async () => {
    canViewEmployee.mockResolvedValue(true);
    expect((await request(app()).delete("/employees/emp-a")).status).toBe(204);
  });
  it("a manager may open the journey of their own report, not of anyone else", async () => {
    canViewEmployee.mockResolvedValue(false);
    isInSpan.mockResolvedValueOnce(true);
    expect((await request(app({ span: true })).get("/employees/emp-r/journey")).status).toBe(200);
    expect((await request(app({ span: true })).get("/employees/emp-x/journey")).status).toBe(403);
  });
  it("without the span option a reporting relationship is not enough", async () => {
    canViewEmployee.mockResolvedValue(false);
    isInSpan.mockResolvedValue(true);
    expect((await request(app()).get("/employees/emp-r/journey")).status).toBe(403);
  });
});

describe("getOrgTree scope", () => {
  const run = async (roles: string[], self: any, args: any = {}) => {
    dbExecute.mockReset();
    dbExecute.mockImplementation(async (sql: string) => {
      if (/ORDER BY e\.date_of_joining/.test(sql)) return [[], []];
      if (/FROM user_roles/.test(sql)) return [roles.map((role_key) => ({ role_key })), []];
      if (/FROM employees WHERE user_id/.test(sql)) return [self ? [self] : [], []];
      return [[], []];
    });
    const { employeeService } = await import("../employee.service.js");
    await employeeService.getOrgTree({ userId: "u", ...args });
    return dbExecute.mock.calls.filter(([sql]) => /ORDER BY e\.date_of_joining/.test(sql));
  };

  it("hr is restricted to its own branch, and a foreign ?branch_id yields nothing", async () => {
    const calls = await run(["hr"], { id: "e1", branch_id: "b1", process_id: "p1" }, { branchId: "b2" });
    expect(calls.length).toBe(0);
    const calls2 = await run(["hr"], { id: "e1", branch_id: "b1", process_id: "p1" });
    expect(calls2[0][1]).toContain("b1");
  });
  it("hr with no branch sees nothing (fail closed)", async () => {
    expect((await run(["hr"], { id: "e1", branch_id: null, process_id: "p1" })).length).toBe(0);
  });
  it("admin is limited to own branch like hr", async () => {
    const calls = await run(["admin"], { id: "e1", branch_id: "b1", process_id: "p1" });
    expect(calls[0][1]).toContain("b1");
  });
  it("admin with no branch sees nothing (fail closed)", async () => {
    expect((await run(["admin"], { id: "e1", branch_id: null, process_id: "p1" })).length).toBe(0);
  });
  it("process manager is bound to own process AND own branch", async () => {
    const calls = await run(["process_manager"], { id: "e1", branch_id: "b1", process_id: "p1" });
    expect(calls[0][1]).toEqual(expect.arrayContaining(["p1", "b1"]));
  });
});
