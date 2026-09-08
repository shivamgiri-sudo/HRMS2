/**
 * PATCH /api/employees/:id — who may move an employee's branch / cost centre.
 *
 * Until 2026-09-08 this was super_admin or payroll_head only, and the branch Payroll HR —
 * the person who actually knows which cost centre a new hire belongs to — had to route every
 * correction through Payroll Head. payroll_hr is now admitted, but ONLY inside its own branch
 * scope, and the DESTINATION is what gets checked.
 *
 * That last point is the whole risk of the change. requireScopedRole proves the actor may
 * touch the employee where they are NOW; without a destination check a branch-scoped Payroll
 * HR could transfer someone into a branch they have no scope over — a one-way move out of
 * their own reach. The cost centre is checked the same way, because a cost centre carries its
 * own branch and picking a foreign one relocates the payroll cost without the branch field
 * ever changing.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const EMP_ID = "22222222-2222-2222-2222-222222222222";
const OWN_BRANCH = "branch-noida";
const OTHER_BRANCH = "branch-ahmedabad";
const CC_IN_BRANCH = "cc-noida-1045";
const CC_OTHER_BRANCH = "cc-ahmedabad-1041";
const CC_NO_BRANCH = "cc-unassigned";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

// roles carries "payroll", not "payroll_hr" — this is what a real payroll_hr user's
// req.authUser.roles actually contains (DASHBOARD_ROLE_ALIASES collapses payroll_hr -> payroll
// before authMiddleware ever sets this array; see payrollHrCostCentreTransfer.aliasCollapse.
// contract.test.ts, which proves that collapse against the real, unmocked resolver). requireRole
// and scopeMiddleware are mocked away below, so this file exists to test the destination-branch
// and destination-cost-centre logic in isolation — not role-name matching, which the alias-
// collapse companion test covers against the real code path.
let authUser: { id: string; role: string; roles: string[] } = {
  id: USER_ID, role: "payroll", roles: ["hr", "payroll"],
};
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: typeof authUser }).authUser = authUser;
    next();
  },
}));
// requireRole and requireScopedRole are exercised by their own tests; here they pass through
// so the assertions land on the transfer gate itself rather than on the layers above it.
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock("../../../middleware/scopeMiddleware.js", () => ({
  requireScopedRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

const { hasScopedAccess } = vi.hoisted(() => ({ hasScopedAccess: vi.fn() }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  hasScopedAccess,
  buildScopeWhereClause: vi.fn().mockResolvedValue({ clause: "", params: [] }),
}));

vi.mock("../../../shared/accessGuard.js", () => ({
  getEmployeeForUser: vi.fn().mockResolvedValue({ id: EMP_ID, employee_code: "MAS0001" }),
  hasRole: vi.fn().mockResolvedValue(true),
}));

// The controller is the far side of the gate: reaching it is the assertion for "allowed".
// employee.routes.ts imports the whole `employeeController` object, so the mock has to
// replace that object - stubbing a named export alone leaves the real handler in place, and
// its own zod validation then answers 400 where the test expects the gate's verdict.
const { updateEmployee } = vi.hoisted(() => ({ updateEmployee: vi.fn() }));
vi.mock("../employee.controller.js", async (importOriginal) => {
  const actual = await importOriginal<{ employeeController: Record<string, unknown> }>();
  return { employeeController: { ...actual.employeeController, updateEmployee } };
});

const { employeeRouter } = await import("../employee.routes.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/employees", employeeRouter);
  return a;
}

beforeEach(() => {
  dbExecute.mockReset();
  hasScopedAccess.mockReset();
  updateEmployee.mockReset();
  updateEmployee.mockImplementation(async (_req: express.Request, res: express.Response) => {
    res.json({ success: true });
  });
  authUser = { id: USER_ID, role: "payroll", roles: ["hr", "payroll"] };

  // The employee sits in the Payroll HR's own branch; the actor's scope covers that branch
  // and nothing else.
  hasScopedAccess.mockImplementation(async (_u: string, _r: string[], target: { branchId?: string }) =>
    target?.branchId === OWN_BRANCH);

  dbExecute.mockImplementation(async (sql: unknown, params: unknown[]) => {
    const text = String(sql);
    if (/SELECT branch_id FROM employees WHERE id = \?/i.test(text)) {
      return [[{ branch_id: OWN_BRANCH }], []];
    }
    if (/FROM cost_centre_master WHERE id = \?/i.test(text)) {
      const id = (params as string[])[0];
      if (id === CC_IN_BRANCH) return [[{ branch_id: OWN_BRANCH }], []];
      if (id === CC_OTHER_BRANCH) return [[{ branch_id: OTHER_BRANCH }], []];
      if (id === CC_NO_BRANCH) return [[{ branch_id: null }], []];
      return [[], []];
    }
    return [[], []];
  });
});

const patch = (body: Record<string, unknown>) =>
  request(app()).patch(`/api/employees/${EMP_ID}`).send(body);

describe("branch Payroll HR may change a cost centre inside their own branch", () => {
  it("allows a cost centre that belongs to their branch", async () => {
    const res = await patch({ costCentreId: CC_IN_BRANCH, transferEffectiveMonth: "2026-09" });
    expect(res.status).toBe(200);
    expect(updateEmployee).toHaveBeenCalled();
  });

  it("allows a cost centre with no branch of its own", async () => {
    // 3 of 937 cost centres carry no branch_id. Blocking those would make a legitimate
    // assignment impossible for reasons the user cannot see or fix.
    const res = await patch({ costCentreId: CC_NO_BRANCH });
    expect(res.status).toBe(200);
  });

  it("refuses a cost centre that belongs to another branch", async () => {
    const res = await patch({ costCentreId: CC_OTHER_BRANCH });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/another branch/i);
    expect(updateEmployee).not.toHaveBeenCalled();
  });

  it("refuses a branch transfer to a branch outside their scope", async () => {
    const res = await patch({ branchId: OTHER_BRANCH });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/outside your assigned scope/i);
    expect(updateEmployee).not.toHaveBeenCalled();
  });

  it("allows a branch transfer within their own scope", async () => {
    const res = await patch({ branchId: OWN_BRANCH, costCentreId: CC_IN_BRANCH });
    expect(res.status).toBe(200);
  });

  it("rejects an unknown cost centre rather than letting it through", async () => {
    const res = await patch({ costCentreId: "cc-does-not-exist" });
    expect(res.status).toBe(400);
  });
});

describe("the gate leaves the other roles where they were", () => {
  it("still lets payroll_head transfer anywhere, with no scope lookup", async () => {
    authUser = { id: USER_ID, role: "payroll_head", roles: ["payroll_head"] };
    const res = await patch({ branchId: OTHER_BRANCH, costCentreId: CC_OTHER_BRANCH });
    expect(res.status).toBe(200);
    expect(hasScopedAccess).not.toHaveBeenCalled();
  });

  it("still refuses plain hr", async () => {
    authUser = { id: USER_ID, role: "hr", roles: ["hr"] };
    const res = await patch({ costCentreId: CC_IN_BRANCH });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Payroll Head or the branch Payroll HR/i);
  });

  it("leaves an edit that touches neither field alone", async () => {
    authUser = { id: USER_ID, role: "hr", roles: ["hr"] };
    const res = await patch({ city: "Noida" });
    expect(res.status).toBe(200);
    expect(hasScopedAccess).not.toHaveBeenCalled();
  });
});
