import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Career / PIP branch scoping: admin|hr pass the role gate, then only employees inside their branch / scope. */
const { canViewEmployee, svc } = vi.hoisted(() => ({
  canViewEmployee: vi.fn(),
  svc: {
    getCareerPath: vi.fn(async () => ({ id: "cp" })),
    upsertCareerPath: vi.fn(async () => ({ id: "cp" })),
    listAllCareerPaths: vi.fn(async () => []),
    listPips: vi.fn(async () => []),
    getPip: vi.fn(async () => ({ id: "pip-1", employee_id: "emp-b" })),
    getPipEmployeeId: vi.fn(async () => "emp-b"),
    createPip: vi.fn(async () => ({ id: "pip-1" })),
    updatePip: vi.fn(async () => ({ id: "pip-1" })),
    addCheckpoint: vi.fn(async () => ({ id: "cp-1" })),
    isManagerOf: vi.fn(async () => false),
  },
}));
vi.mock("../career.service.js", () => ({ careerService: svc }));
vi.mock("../../../shared/enterpriseScope.js", () => ({
  canViewEmployee,
  resolveUserBusinessScope: vi.fn(async () => ({})),
  buildEmployeeScopeCondition: vi.fn(() => ({ sql: "e.branch_id = ?", params: ["branch-a"] })),
}));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRole: vi.fn(async () => true), getEmployeeForUser: vi.fn(async () => ({ id: "emp-me" })) }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-hr" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));

async function app() {
  const { careerRouter } = await import("../career.routes.js");
  const a = express(); a.use(express.json()); a.use("/api/career", careerRouter); return a;
}
beforeEach(() => { vi.clearAllMocks(); canViewEmployee.mockResolvedValue(false); });

describe("career by-employee routes", () => {
  it("GET/POST /career/:employeeId refused outside the branch, allowed inside", async () => {
    const a = await app();
    expect((await request(a).get("/api/career/career/emp-b")).status).toBe(403);
    expect((await request(a).post("/api/career/career/emp-b").send({ readiness_pct: 10 })).status).toBe(403);
    expect(svc.upsertCareerPath).not.toHaveBeenCalled();
    canViewEmployee.mockResolvedValue(true);
    expect((await request(a).get("/api/career/career/emp-a")).status).toBe(200);
  });

  it("GET /succession and GET /pip list through the employee scope condition", async () => {
    const a = await app();
    await request(a).get("/api/career/succession");
    expect(svc.listAllCareerPaths).toHaveBeenCalledWith({ sql: "e.branch_id = ?", params: ["branch-a"] });
    await request(a).get("/api/career/pip");
    expect(svc.listPips).toHaveBeenCalledWith(expect.anything(), { sql: "e.branch_id = ?", params: ["branch-a"] });
    expect((await request(a).get("/api/career/pip?employee_id=emp-b")).status).toBe(403);
  });
});

describe("PIP writes and by-id reads", () => {
  it("create refused for an employee outside scope", async () => {
    const a = await app();
    const body = { employee_id: "emp-b", start_date: "2026-10-01", end_date: "2026-11-01", reason: "r" };
    expect((await request(a).post("/api/career/pip").send(body)).status).toBe(403);
    expect(svc.createPip).not.toHaveBeenCalled();
  });
  it("GET /pip/:id, PATCH /pip/:id and POST checkpoints look up the owning employee first", async () => {
    const a = await app();
    expect((await request(a).get("/api/career/pip/pip-1")).status).toBe(403);
    expect((await request(a).patch("/api/career/pip/pip-1").send({ status: "completed" })).status).toBe(403);
    expect((await request(a).post("/api/career/pip/pip-1/checkpoints").send({ checkpoint_date: "2026-10-02", rating: "on_track" })).status).toBe(403);
    expect(svc.updatePip).not.toHaveBeenCalled();
    expect(svc.addCheckpoint).not.toHaveBeenCalled();
    canViewEmployee.mockResolvedValue(true);
    expect((await request(a).patch("/api/career/pip/pip-1").send({ status: "completed" })).status).toBe(200);
  });
});
