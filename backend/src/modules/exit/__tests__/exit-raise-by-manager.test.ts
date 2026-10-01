import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/exit — who may raise an exit for whom.
 *
 * A reporting manager (manager role OR simply someone with direct reports) may raise an exit
 * for an employee in their own span; anyone else naming another employee gets a 403 and no
 * exit is created. HR/admin are unrestricted; a plain employee only ever raises their own.
 */

const ME = "emp-me";
const TEAM_MEMBER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";

const m = vi.hoisted(() => ({
  hasRole: vi.fn(), hasDirectReports: vi.fn(), canViewEmployee: vi.fn(), isInReportingSpan: vi.fn(),
  createExitRequest: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn().mockResolvedValue([[], []]) } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../../../shared/accessGuard.js", () => ({
  getEmployeeForUser: vi.fn().mockResolvedValue({ id: ME }),
  hasRole: m.hasRole,
}));
vi.mock("../../../shared/enterpriseScope.js", () => ({ canViewEmployee: m.canViewEmployee }));
vi.mock("../../../shared/reportingSpan.js", () => ({
  hasDirectReports: m.hasDirectReports, isInReportingSpan: m.isInReportingSpan,
}));
vi.mock("../exit.controller.js", () => ({
  exitController: {
    getExitStats: vi.fn(), listExitRequests: vi.fn(), createExitRequest: m.createExitRequest,
    getExitRequest: vi.fn(), updateExitStatus: vi.fn(), deleteExitRequest: vi.fn(),
    getExitAnalytics: vi.fn(), listExitInterviews: vi.fn(),
  },
}));
vi.mock("../ff.service.js", async (orig) => {
  const actual = await orig<Record<string, unknown>>().catch(() => ({}));
  return { ...actual, ffService: { markFfPaid: vi.fn(), setProvisionalFalse: vi.fn(), createFF: vi.fn(), getFF: vi.fn(), approveFF: vi.fn() } };
});
vi.mock("../exit-intelligence.service.js", () => ({
  addRetentionAction: vi.fn(), createDefaultClearanceTasks: vi.fn(),
  createExitHealthSnapshot: vi.fn(), getExitCommandCenter: vi.fn(), saveExitInterview: vi.fn(),
}));
vi.mock("../resignation.routes.js", () => {
  const { Router } = require("express");
  return { resignationRouter: Router() };
});
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "user-1" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));

const { exitRouter } = await import("../exit.routes.js");

const app = () => {
  const a = express();
  a.use(express.json());
  a.use("/api/exit", exitRouter);
  return a;
};
const body = (employeeId: string) => ({ employeeId, exitType: "involuntary", exitSubType: "absconding", lastWorkingDayProposed: "2026-10-01" });
const roles = (...held: string[]) => m.hasRole.mockImplementation(async (_u: string, ...asked: string[]) => asked.some((r) => held.includes(r)));

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.createExitRequest.mockImplementation(async (_req: any, res: any) => res.status(201).json({ success: true }));
  m.canViewEmployee.mockResolvedValue(false);
  m.isInReportingSpan.mockResolvedValue(false);
  m.hasDirectReports.mockResolvedValue(false);
  roles();
});

describe("POST /api/exit — raising an exit for someone else", () => {
  it("lets a plain-employee team lead (has direct reports) raise it for their own team, as 'manager'", async () => {
    m.hasDirectReports.mockResolvedValue(true);
    m.isInReportingSpan.mockImplementation(async (_u: string, id: string) => id === TEAM_MEMBER);
    const res = await request(app()).post("/api/exit").send(body(TEAM_MEMBER));
    expect(res.status).toBe(201);
    expect(m.createExitRequest).toHaveBeenCalledOnce();
    expect((m.createExitRequest.mock.calls[0][0] as any).exitInitiatedBy).toBe("manager");
  });

  it("403s a team lead naming someone outside their team, and creates nothing", async () => {
    m.hasDirectReports.mockResolvedValue(true);
    m.isInReportingSpan.mockImplementation(async (_u: string, id: string) => id === TEAM_MEMBER);
    const res = await request(app()).post("/api/exit").send(body(STRANGER));
    expect(res.status).toBe(403);
    expect(m.createExitRequest).not.toHaveBeenCalled();
  });

  it("403s a manager-role user whose scope does not cover the target", async () => {
    roles("manager");
    const res = await request(app()).post("/api/exit").send(body(STRANGER));
    expect(res.status).toBe(403);
    expect(m.createExitRequest).not.toHaveBeenCalled();
  });

  it("403s someone with no reports and no manager role naming another employee", async () => {
    m.isInReportingSpan.mockResolvedValue(true);
    const res = await request(app()).post("/api/exit").send(body(TEAM_MEMBER));
    expect(res.status).toBe(403);
    expect(m.createExitRequest).not.toHaveBeenCalled();
  });

  it("HR / admin raising for an employee inside their branch scope is recorded as 'hr'", async () => {
    roles("hr", "admin");
    m.canViewEmployee.mockImplementation(async (_u: unknown, id: string) => id === STRANGER);
    const res = await request(app()).post("/api/exit").send(body(STRANGER));
    expect(res.status).toBe(201);
    expect((m.createExitRequest.mock.calls[0][0] as any).exitInitiatedBy).toBe("hr");
  });

  it("HR / admin are branch-scoped (owner ruling 2026-10-01): an employee outside their scope is refused, nothing created", async () => {
    roles("hr", "admin");
    m.canViewEmployee.mockResolvedValue(false);
    const res = await request(app()).post("/api/exit").send(body(STRANGER));
    expect(res.status).toBe(403);
    expect(m.createExitRequest).not.toHaveBeenCalled();
  });

  it("a plain employee naming a different employee is refused", async () => {
    const res = await request(app()).post("/api/exit").send(body("33333333-3333-4333-8333-333333333333"));
    expect(res.status).toBe(403);
    expect(m.createExitRequest).not.toHaveBeenCalled();
  });
});
