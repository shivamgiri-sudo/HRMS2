import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/exit/resignation - the My Resignation page sends only {reason, last_working_day}.
 * Employees got their own employee filled in; managers/HR/admins did not and received
 * "Validation failed", so a manager could not resign. Raising an exit for SOMEONE ELSE must
 * still work and must still be recorded as manager/hr-initiated.
 */
const { createExitRequest, hasRole, getEmployeeForUser } = vi.hoisted(() => ({
  createExitRequest: vi.fn(async (_req: any, res: any) => res.status(201).json({ success: true })),
  hasRole: vi.fn(),
  getEmployeeForUser: vi.fn(async () => ({ id: "emp-self" })),
}));

const { canTouch } = vi.hoisted(() => ({ canTouch: vi.fn(async () => true) }));
vi.mock("../exitScope.js", () => ({
  canTouchExitEmployee: canTouch,
  employeeScopeSql: vi.fn(async () => ({ sql: "1=1", params: [] })),
  guardExitEmployee: () => (_q: any, _s: any, next: any) => next(),
}));
vi.mock("../exit.controller.js", () => ({ exitController: { createExitRequest } }));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRole, getEmployeeForUser, canViewEmployee: vi.fn(async () => true) }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(async () => [[], []]) } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1", role: "manager" }; next(); },
}));

const { resignationRouter } = await import("../resignation.routes.js");
const app = () => { const a = express(); a.use(express.json()); a.use("/api/exit/resignation", resignationRouter); return a; };

beforeEach(() => { canTouch.mockReset().mockResolvedValue(true); createExitRequest.mockClear(); hasRole.mockReset(); getEmployeeForUser.mockClear(); });

const post = (body: Record<string, unknown>) => request(app()).post("/api/exit/resignation").send(body);
const sent = () => createExitRequest.mock.calls[0][0] as any;

describe("POST /resignation", () => {
  it("an employee: own employee filled in, recorded as employee-initiated", async () => {
    hasRole.mockResolvedValue(false);
    await post({ reason: "r", last_working_day: "2026-11-30" });
    expect(sent().body.employeeId).toBe("emp-self");
    expect(sent().exitInitiatedBy).toBe("employee");
  });

  it("a manager who names no employee resigns THEMSELVES (was: Validation failed)", async () => {
    hasRole.mockImplementation(async (_u: string, ...roles: string[]) => roles.includes("manager"));
    await post({ reason: "r", last_working_day: "2026-11-30" });
    expect(sent().body.employeeId).toBe("emp-self");
    expect(sent().exitInitiatedBy).toBe("employee");
  });

  it("a manager naming another employee still raises it on their behalf, recorded as manager-initiated", async () => {
    // privileged check (admin,hr,manager) -> true; the "is HR/admin?" check (admin,hr) -> false
    hasRole.mockImplementation(async (_u: string, ...roles: string[]) => roles.includes("manager"));
    await post({ employeeId: "11111111-1111-4111-8111-111111111111", reason: "r", last_working_day: "2026-11-30" });
    expect(sent().body.employeeId).toBe("11111111-1111-4111-8111-111111111111");
    expect(sent().exitInitiatedBy).toBe("manager");
    expect(getEmployeeForUser).not.toHaveBeenCalled();
  });

  it("a privileged caller naming an employee outside their branch / scope is refused (admin / hr are branch-scoped, 2026-10-01)", async () => {
    hasRole.mockImplementation(async (_u: string, ...roles: string[]) => roles.includes("admin"));
    canTouch.mockResolvedValue(false);
    const res = await post({ employeeId: "22222222-2222-4222-8222-222222222222", reason: "r", last_working_day: "2026-11-30" });
    expect(res.status).toBe(403);
    expect(createExitRequest).not.toHaveBeenCalled();
  });
});
