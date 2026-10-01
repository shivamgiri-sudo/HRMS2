import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Tasks (owner ruling 2026-10-01): employee / department / overdue tasks limited to the caller's scope. */
const { dbExecute, canViewEmployee, svc } = vi.hoisted(() => ({
  dbExecute: vi.fn(), canViewEmployee: vi.fn(),
  svc: {
    getEmployeeTasks: vi.fn(async () => []), getOnboardingProgress: vi.fn(async () => ({})), getDepartmentTasks: vi.fn(async () => []),
    getOverdueTasks: vi.fn(async () => []), startTask: vi.fn(async () => ({})), getTaskComments: vi.fn(async () => []),
    createTasksFromTemplate: vi.fn(async () => []), getMyTasks: vi.fn(async () => []), completeTask: vi.fn(), updateTask: vi.fn(), addComment: vi.fn(),
  },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../shared/enterpriseScope.js", () => ({
  canViewEmployee, resolveUserBusinessScope: async () => ({}), buildEmployeeScopeCondition: () => ({ sql: "e.branch_id = ?", params: ["b1"] }),
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../task.service.js", () => ({ taskService: svc }));

const { default: router } = await import("../task.routes.js");
const app = () => { const a = express(); a.use(express.json()); a.use("/api/tasks", router); return a; };

beforeEach(() => {
  canViewEmployee.mockReset(); dbExecute.mockReset(); Object.values(svc).forEach((f: any) => f.mockClear());
  dbExecute.mockResolvedValue([[{ employee_id: "emp-b", assigned_to_user_id: "someone-else" }], []]);
});

describe("tasks scoping", () => {
  it("another branch's employee tasks / progress are 403", async () => {
    canViewEmployee.mockResolvedValue(false);
    expect((await request(app()).get("/api/tasks/employee/emp-b")).status).toBe(403);
    expect((await request(app()).get("/api/tasks/employee/emp-b/progress")).status).toBe(403);
    expect(svc.getEmployeeTasks).not.toHaveBeenCalled();
  });
  it("in-scope reads pass", async () => {
    canViewEmployee.mockResolvedValue(true);
    expect((await request(app()).get("/api/tasks/employee/emp-a")).status).toBe(200);
  });
  it("department and overdue lists receive the caller's row scope", async () => {
    await request(app()).get("/api/tasks/department/IT");
    expect((svc.getDepartmentTasks.mock.calls[0] as any)[2].sql).toBe("e.branch_id = ?");
    await request(app()).get("/api/tasks/overdue");
    expect((svc.getOverdueTasks.mock.calls[0] as any)[0].params).toEqual(["b1"]);
  });
  it("acting on a task of an out-of-scope employee is 403 unless the caller is the assignee", async () => {
    canViewEmployee.mockResolvedValue(false);
    expect((await request(app()).put("/api/tasks/t1/start")).status).toBe(403);
    dbExecute.mockResolvedValue([[{ employee_id: "emp-b", assigned_to_user_id: "u1" }], []]);
    expect((await request(app()).put("/api/tasks/t1/start")).status).toBe(200);
  });
});
