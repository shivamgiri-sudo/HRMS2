import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET/PATCH /api/exit/:id/clearance previously enforced role only
 * (admin/hr/manager/finance/payroll/wfm) and never row scope: manager/
 * finance/payroll/wfm could list or clear/waive any exit request's clearance
 * tasks in any branch/process just by supplying its :id/:taskId.
 * (delta-audit 2026-08-14, P1, Stage 5f)
 *
 * Fixed via the shared employee-scope mechanism (shared/enterpriseScope.ts)
 * — canViewEmployee — already used throughout this remediation. admin/hr
 * stay unrestricted (canViewEmployee's own bypass). This does not gate on
 * the task's own owner_role (cross-functional clearance) — that is a
 * business-policy question, out of scope here.
 */

const ACTOR_ID = "actor-1";
const EMPLOYEE_ID = "emp-in-scope";
const EXIT_ID = "exit-1";
const TASK_ID = "task-1";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

const { canViewEmployee } = vi.hoisted(() => ({ canViewEmployee: vi.fn() }));
vi.mock("../../../shared/enterpriseScope.js", () => ({ canViewEmployee }));

let authUser: { id: string; role: string; roles: string[] } = {
  id: ACTOR_ID,
  role: "wfm",
  roles: ["wfm"],
};

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: typeof authUser }).authUser = authUser;
    next();
  },
}));

// exit.routes.ts pulls in exitController, ffService, resignationRouter and friends for its
// other endpoints — none of which this test exercises. Stub them out so importing the
// router doesn't require a live DB connection or unrelated route wiring.
vi.mock("../exit.controller.js", () => ({
  exitController: {
    getExitStats: vi.fn(),
    listExitRequests: vi.fn(),
    createExitRequest: vi.fn(),
    getExitRequest: vi.fn(),
    updateExitStatus: vi.fn(),
  },
}));
vi.mock("../ff.service.js", () => ({ ffService: {} }));
vi.mock("../../../shared/accessGuard.js", () => ({
  getEmployeeForUser: vi.fn(),
  hasRole: vi.fn().mockResolvedValue(false),
}));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../exit-intelligence.service.js", () => ({
  addRetentionAction: vi.fn(),
  createDefaultClearanceTasks: vi.fn(),
  createExitHealthSnapshot: vi.fn(),
  getExitCommandCenter: vi.fn(),
  saveExitInterview: vi.fn(),
}));
vi.mock("../resignation.routes.js", () => {
  const { Router } = require("express");
  return { resignationRouter: Router() };
});

const { exitRouter } = await import("../exit.routes.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/exit", exitRouter);
  return a;
}

beforeEach(() => {
  dbExecute.mockReset();
  canViewEmployee.mockReset();
});

describe("GET /:id/clearance — scope", () => {
  it("404s when the exit request does not exist, without checking scope", async () => {
    dbExecute.mockResolvedValueOnce([[], []]);

    const res = await request(app()).get(`/api/exit/${EXIT_ID}/clearance`);

    expect(res.status).toBe(404);
    expect(canViewEmployee).not.toHaveBeenCalled();
  });

  it("403s a wfm caller whose scope does not cover the exit's employee", async () => {
    dbExecute.mockResolvedValueOnce([[{ employee_id: EMPLOYEE_ID }], []]);
    canViewEmployee.mockResolvedValue(false);

    const res = await request(app()).get(`/api/exit/${EXIT_ID}/clearance`);

    expect(res.status).toBe(403);
    expect(canViewEmployee).toHaveBeenCalledWith(ACTOR_ID, EMPLOYEE_ID);
    expect(dbExecute).toHaveBeenCalledTimes(1); // only the employee lookup, never the tasks query
  });

  it("allows a wfm caller whose scope covers the exit's employee", async () => {
    dbExecute
      .mockResolvedValueOnce([[{ employee_id: EMPLOYEE_ID }], []])
      .mockResolvedValueOnce([[{ id: TASK_ID, status: "pending" }], []]);
    canViewEmployee.mockResolvedValue(true);

    const res = await request(app()).get(`/api/exit/${EXIT_ID}/clearance`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("allows hr regardless of scope (canViewEmployee's own bypass)", async () => {
    authUser = { id: ACTOR_ID, role: "hr", roles: ["hr"] };
    dbExecute
      .mockResolvedValueOnce([[{ employee_id: EMPLOYEE_ID }], []])
      .mockResolvedValueOnce([[], []]);
    canViewEmployee.mockResolvedValue(true);

    const res = await request(app()).get(`/api/exit/${EXIT_ID}/clearance`);

    expect(res.status).toBe(200);
  });
});

describe("PATCH /:id/clearance/:taskId — scope", () => {
  beforeEach(() => {
    authUser = { id: ACTOR_ID, role: "wfm", roles: ["wfm"] };
  });

  it("404s when the task does not exist for this exit request, without checking scope", async () => {
    dbExecute.mockResolvedValueOnce([[], []]);

    const res = await request(app())
      .patch(`/api/exit/${EXIT_ID}/clearance/${TASK_ID}`)
      .send({ status: "cleared" });

    expect(res.status).toBe(404);
    expect(canViewEmployee).not.toHaveBeenCalled();
  });

  it("403s a wfm caller whose scope does not cover the task's employee, and never updates it", async () => {
    dbExecute.mockResolvedValueOnce([[{ employee_id: EMPLOYEE_ID }], []]);
    canViewEmployee.mockResolvedValue(false);

    const res = await request(app())
      .patch(`/api/exit/${EXIT_ID}/clearance/${TASK_ID}`)
      .send({ status: "cleared" });

    expect(res.status).toBe(403);
    expect(dbExecute).toHaveBeenCalledTimes(1); // only the SELECT, no UPDATE
  });

  it("allows a wfm caller whose scope covers the task's employee, then updates it", async () => {
    dbExecute
      .mockResolvedValueOnce([[{ employee_id: EMPLOYEE_ID }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    canViewEmployee.mockResolvedValue(true);

    const res = await request(app())
      .patch(`/api/exit/${EXIT_ID}/clearance/${TASK_ID}`)
      .send({ status: "cleared" });

    expect(res.status).toBe(200);
    expect(dbExecute).toHaveBeenCalledTimes(2);
    const [sql] = dbExecute.mock.calls[1];
    expect(String(sql)).toContain("UPDATE exit_clearance_task");
  });

  it("rejects an invalid status before any scope check", async () => {
    const res = await request(app())
      .patch(`/api/exit/${EXIT_ID}/clearance/${TASK_ID}`)
      .send({ status: "not-a-real-status" });

    expect(res.status).toBe(400);
    expect(dbExecute).not.toHaveBeenCalled();
    expect(canViewEmployee).not.toHaveBeenCalled();
  });
});
