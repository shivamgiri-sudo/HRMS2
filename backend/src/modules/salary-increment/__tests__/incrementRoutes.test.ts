import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Increment request routes: no Finance step, the Payroll Head approves and approving applies the increment.
 * The service is mocked; this proves the route-level rules (who may do what, the approve -> implement chain).
 */

const { transition, getById, create, list } = vi.hoisted(() => ({
  transition: vi.fn(), getById: vi.fn(), create: vi.fn(), list: vi.fn(),
}));
vi.mock("../salaryIncrement.service.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../salaryIncrement.service.js")>();
  return { ...original, salaryIncrementService: { transition, getById, create, list } };
});
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(), getConnection: vi.fn() } }));
vi.mock("../../payroll/payroll-branch-scope.js", () => ({
  guardEmployee: vi.fn(async () => true),
  employeeScopeFor: vi.fn(async () => ({ sql: "1=1", params: [] })),
}));

let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); } };
});
vi.mock("../../../shared/accessGuard.js", () => ({
  getEmployeeForUser: vi.fn(async () => null),
  hasRole: vi.fn(async (_id: string, ...roles: string[]) => actor.roles.some((r) => roles.includes(r))),
}));

import { salaryIncrementRouter } from "../salaryIncrement.routes.js";

function appFor(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use("/api/salary-increment", salaryIncrementRouter);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.status ?? 500).json({ success: false, error: String(err?.message ?? err) }));
  return app;
}

beforeEach(() => {
  transition.mockReset(); getById.mockReset(); create.mockReset(); list.mockReset();
  getById.mockResolvedValue({ id: "inc-1", employee_id: "emp-1", status: "submitted" });
});

describe("approval is the Payroll Head's, and it applies the increment", () => {
  it("HR cannot approve", async () => {
    const res = await request(appFor("hr")).post("/api/salary-increment/inc-1/action").send({ action: "approve" });
    expect(res.status).toBe(403);
    expect(transition).not.toHaveBeenCalled();
  });

  it("HR cannot apply an approved increment either", async () => {
    const res = await request(appFor("hr")).post("/api/salary-increment/inc-1/action").send({ action: "implement" });
    expect(res.status).toBe(403);
  });

  it("the Payroll Head's approve runs approve and then implement in one request", async () => {
    transition.mockResolvedValueOnce({ id: "inc-1", status: "approved" }).mockResolvedValueOnce({ id: "inc-1", status: "implemented" });
    const res = await request(appFor("payroll_head")).post("/api/salary-increment/inc-1/action").send({ action: "approve", remarks: "ok" });
    expect(res.status).toBe(200);
    expect(transition).toHaveBeenCalledTimes(2);
    expect(transition.mock.calls[0]![1]).toBe("approve");
    expect(transition.mock.calls[1]![1]).toBe("implement");
    expect(res.body.data.status).toBe("implemented");
  });

  it("if applying fails the request stays approved: the error surfaces and implement can be retried", async () => {
    transition.mockResolvedValueOnce({ id: "inc-1", status: "approved" }).mockRejectedValueOnce(Object.assign(new Error("db down"), { status: 500 }));
    const res = await request(appFor("super_admin")).post("/api/salary-increment/inc-1/action").send({ action: "approve" });
    expect(res.status).toBe(500);
    expect(transition).toHaveBeenCalledTimes(2);
    transition.mockReset();
    transition.mockResolvedValueOnce({ id: "inc-1", status: "implemented" });
    const retry = await request(appFor("payroll_head")).post("/api/salary-increment/inc-1/action").send({ action: "implement" });
    expect(retry.status).toBe(200);
    expect(transition).toHaveBeenCalledTimes(1);
  });

  it("a Finance validation request is rejected as an invalid action, even for the Payroll Head", async () => {
    const res = await request(appFor("payroll_head")).post("/api/salary-increment/inc-1/action").send({ action: "finance_validate" });
    expect(res.status).toBe(400);
    expect(transition).not.toHaveBeenCalled();
  });

  it("the finance role gets no access to raise-side or approval steps", async () => {
    for (const action of ["approve", "implement", "hr_validate", "reject"]) {
      const res = await request(appFor("finance")).post("/api/salary-increment/inc-1/action").send({ action });
      expect(res.status).toBe(403);
    }
  });
});

describe("raising a request", () => {
  it("HR and the Payroll Head can raise one; a plain employee cannot", async () => {
    create.mockResolvedValue({ id: "inc-2" });
    const body = { employee_id: "emp-1", proposed_ctc: 240000, effective_from: "2026-10-20" };
    for (const role of ["hr", "payroll_head"]) {
      const ok = await request(appFor(role)).post("/api/salary-increment").send(body);
      expect(ok.status).toBe(201);
    }
    const no = await request(appFor("employee")).post("/api/salary-increment").send(body);
    expect(no.status).toBe(403);
    expect(create.mock.calls[0]![0].requested_role).toBe("hr");
    expect(create.mock.calls[1]![0].requested_role).toBe("payroll_head");
  });

  it("HR still validates, rejects and cancels", async () => {
    transition.mockResolvedValue({ id: "inc-1", status: "x" });
    for (const action of ["hr_validate", "reject", "cancel"]) {
      const res = await request(appFor("hr")).post("/api/salary-increment/inc-1/action").send({ action });
      expect(res.status).toBe(200);
    }
    // none of those chained into an implement
    expect(transition.mock.calls.every((c) => c[1] !== "implement")).toBe(true);
  });
});

describe("listing requests", () => {
  it("passes paging, status and the typed search to the service and returns the total", async () => {
    list.mockResolvedValue({ rows: [{ id: "r1" }], total: 14467, page: 2, limit: 25 });
    const res = await request(appFor("payroll_head")).get("/api/salary-increment?status=pending&search=63694C&page=2&limit=25");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, total: 14467, page: 2, limit: 25 });
    expect(list.mock.calls[0]![0]).toMatchObject({ status: "pending", search: "63694C", page: 2, limit: 25 });
  });

  it("defaults to 25 per page when the client sends no paging", async () => {
    list.mockResolvedValue({ rows: [], total: 0, page: 1, limit: 25 });
    await request(appFor("hr")).get("/api/salary-increment");
    expect(list.mock.calls[0]![0]).toMatchObject({ page: 1, limit: 25 });
  });
});
