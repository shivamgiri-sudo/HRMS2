import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * employee-reactivation.routes.ts previously enforced ROLE only (or, on
 * GET /:id, nothing at all) and never row scope:
 *
 *   - GET /reactivation/:id had no requireRole at all — any authenticated user
 *     of any role could read any reactivation request's full detail.
 *   - GET /reactivation/pending's own comment admitted branch heads "see all
 *     for now" — no branch filter existed despite the code structure implying
 *     one was intended.
 *   - POST /reactivation/:id/branch-action trusted :id directly with no check
 *     that the branch_head caller's own branch matched the request's employee.
 *
 * (delta-audit 2026-08-14, P0 missing-auth + P1 missing-scope, Stage 5f)
 *
 * Fixed via the shared employee-scope mechanism (shared/enterpriseScope.ts) —
 * canViewEmployee / resolveUserBusinessScope / buildEmployeeScopeCondition —
 * already used throughout this remediation. hr/admin/super_admin stay
 * unrestricted; only branch_head is actually scoped.
 */

const ACTOR_ID = "actor-1";
const EMPLOYEE_ID = "emp-in-scope";
const REQUEST_ID = "reactivation-1";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

const { canViewEmployee, resolveUserBusinessScope, buildEmployeeScopeCondition } = vi.hoisted(() => ({
  canViewEmployee: vi.fn(),
  resolveUserBusinessScope: vi.fn(),
  buildEmployeeScopeCondition: vi.fn(),
}));
vi.mock("../../../shared/enterpriseScope.js", () => ({
  canViewEmployee,
  resolveUserBusinessScope,
  buildEmployeeScopeCondition,
}));

let authUser: { id: string; role: string; roles: string[] } = {
  id: ACTOR_ID,
  role: "branch_head",
  roles: ["branch_head"],
};

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: typeof authUser }).authUser = authUser;
    next();
  },
}));

const { employeeReactivationRouter } = await import("../employee-reactivation.routes.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/employees", employeeReactivationRouter);
  return a;
}

const REQUEST_ROW = {
  id: REQUEST_ID,
  employee_id: EMPLOYEE_ID,
  status: "pending",
  employee_code: "MAS001",
  employee_name: "Test Employee",
};

beforeEach(() => {
  dbExecute.mockReset();
  canViewEmployee.mockReset();
  resolveUserBusinessScope.mockReset();
  buildEmployeeScopeCondition.mockReset();
});

describe("GET /reactivation/:id — role gate + scope", () => {
  it("401/403s a role with no access at all (the role gate that never existed before this fix)", async () => {
    authUser = { id: ACTOR_ID, role: "employee", roles: ["employee"] };

    const res = await request(app()).get(`/api/employees/reactivation/${REQUEST_ID}`);

    expect(res.status).toBe(403);
    expect(dbExecute).not.toHaveBeenCalled();
  });

  it("403s a branch_head whose scope does not cover the request's employee", async () => {
    authUser = { id: ACTOR_ID, role: "branch_head", roles: ["branch_head"] };
    dbExecute.mockResolvedValue([[REQUEST_ROW], []]);
    canViewEmployee.mockResolvedValue(false);

    const res = await request(app()).get(`/api/employees/reactivation/${REQUEST_ID}`);

    expect(res.status).toBe(403);
    expect(canViewEmployee).toHaveBeenCalledWith(ACTOR_ID, EMPLOYEE_ID);
  });

  it("allows a branch_head whose scope covers the request's employee", async () => {
    authUser = { id: ACTOR_ID, role: "branch_head", roles: ["branch_head"] };
    dbExecute.mockResolvedValue([[REQUEST_ROW], []]);
    canViewEmployee.mockResolvedValue(true);

    const res = await request(app()).get(`/api/employees/reactivation/${REQUEST_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(REQUEST_ID);
  });

  it("allows hr regardless of scope (canViewEmployee's own bypass)", async () => {
    authUser = { id: ACTOR_ID, role: "hr", roles: ["hr"] };
    dbExecute.mockResolvedValue([[REQUEST_ROW], []]);
    canViewEmployee.mockResolvedValue(true); // simulates enterpriseScope's internal hr bypass

    const res = await request(app()).get(`/api/employees/reactivation/${REQUEST_ID}`);

    expect(res.status).toBe(200);
  });

  it("404s before any scope check when the request does not exist", async () => {
    authUser = { id: ACTOR_ID, role: "hr", roles: ["hr"] };
    dbExecute.mockResolvedValue([[], []]);

    const res = await request(app()).get(`/api/employees/reactivation/${REQUEST_ID}`);

    expect(res.status).toBe(404);
    expect(canViewEmployee).not.toHaveBeenCalled();
  });
});

describe("GET /reactivation/pending — branch_head scope", () => {
  it("stays unrestricted for hr (no scope condition applied)", async () => {
    authUser = { id: ACTOR_ID, role: "hr", roles: ["hr"] };
    dbExecute.mockResolvedValue([[REQUEST_ROW], []]);

    const res = await request(app()).get("/api/employees/reactivation/pending");

    expect(res.status).toBe(200);
    expect(resolveUserBusinessScope).not.toHaveBeenCalled();
    const [sql, params] = dbExecute.mock.calls[0];
    expect(String(sql)).toContain("(1=1)");
    expect(params).toEqual([]);
  });

  it("applies the branch_head's employee-scope condition instead of returning everything", async () => {
    authUser = { id: ACTOR_ID, role: "branch_head", roles: ["branch_head"] };
    resolveUserBusinessScope.mockResolvedValue({ userId: ACTOR_ID } as never);
    buildEmployeeScopeCondition.mockReturnValue({ sql: "e.branch_id = ?", params: ["branch-A"] });
    dbExecute.mockResolvedValue([[REQUEST_ROW], []]);

    const res = await request(app()).get("/api/employees/reactivation/pending");

    expect(res.status).toBe(200);
    expect(buildEmployeeScopeCondition).toHaveBeenCalledWith(
      { userId: ACTOR_ID },
      expect.objectContaining({ employeeId: "e.id", branchId: "e.branch_id" }),
    );
    const [sql, params] = dbExecute.mock.calls[0];
    expect(String(sql)).toContain("e.branch_id = ?");
    expect(params).toEqual(["branch-A"]);
  });
});

describe("POST /reactivation/:id/branch-action — scope", () => {
  it("refuses a branch_head whose scope does not cover the request's employee", async () => {
    authUser = { id: ACTOR_ID, role: "branch_head", roles: ["branch_head"] };
    dbExecute.mockResolvedValue([[REQUEST_ROW], []]);
    canViewEmployee.mockResolvedValue(false);

    const res = await request(app())
      .post(`/api/employees/reactivation/${REQUEST_ID}/branch-action`)
      .send({ action: "approved", remarks: "looks fine to me" });

    expect(res.status).toBe(403);
    expect(dbExecute).toHaveBeenCalledTimes(1); // only the SELECT, no UPDATE
  });

  it("allows a branch_head whose scope covers the request's employee", async () => {
    authUser = { id: ACTOR_ID, role: "branch_head", roles: ["branch_head"] };
    dbExecute.mockResolvedValue([[REQUEST_ROW], []]);
    canViewEmployee.mockResolvedValue(true);

    const res = await request(app())
      .post(`/api/employees/reactivation/${REQUEST_ID}/branch-action`)
      .send({ action: "approved", remarks: "looks fine to me" });

    expect(res.status).toBe(200);
    expect(dbExecute).toHaveBeenCalledTimes(2); // SELECT then UPDATE
  });

  it("allows admin regardless of scope (canViewEmployee's own bypass)", async () => {
    authUser = { id: ACTOR_ID, role: "admin", roles: ["admin"] };
    dbExecute.mockResolvedValue([[REQUEST_ROW], []]);
    canViewEmployee.mockResolvedValue(true);

    const res = await request(app())
      .post(`/api/employees/reactivation/${REQUEST_ID}/branch-action`)
      .send({ action: "approved", remarks: "looks fine to me" });

    expect(res.status).toBe(200);
  });
});
