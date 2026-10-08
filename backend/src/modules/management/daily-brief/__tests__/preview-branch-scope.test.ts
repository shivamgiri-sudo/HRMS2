import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /preview?employeeId=: "previewing someone else's brief" is an admin capability, but admin is branch-scoped like hr
 * (owner ruling 2026-10-01): only employees inside the admin's branch / scope. canViewEmployee is true for org-wide roles.
 */
const h = vi.hoisted(() => ({
  hasRole: vi.fn(), canViewEmployee: vi.fn(), getEmployeeForUser: vi.fn(), build: vi.fn(),
}));
vi.mock("../../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1" }; next(); },
}));
vi.mock("../../../../db/mysql.js", () => ({ db: { execute: vi.fn(async () => [[], []]) } }));
vi.mock("../../../../shared/accessGuard.js", () => ({ hasRole: h.hasRole, getEmployeeForUser: h.getEmployeeForUser }));
vi.mock("../../../../shared/enterpriseScope.js", () => ({ canViewEmployee: h.canViewEmployee }));
vi.mock("../daily-brief-dispatch.service.js", () => ({
  buildDailyBriefForEmployee: h.build, dailyBriefEventCode: (d: string) => `E_${d}`,
}));
vi.mock("../daily-brief.cron.js", () => ({ WORKER_NAME: "w" }));

import { dailyBriefRouter } from "../daily-brief.routes.js";
const app = () => { const a = express(); a.use("/api/management/daily-brief", dailyBriefRouter); return a; };

beforeEach(() => {
  vi.clearAllMocks();
  h.getEmployeeForUser.mockResolvedValue({ id: "emp-self" });
  h.build.mockResolvedValue({ ok: true, brief: {}, html: "", text: "", subject: "s" });
});

describe("daily brief preview of another employee", () => {
  it("admin may preview an employee inside their scope", async () => {
    h.hasRole.mockResolvedValue(true); h.canViewEmployee.mockResolvedValue(true);
    const res = await request(app()).get("/api/management/daily-brief/preview?employeeId=emp-a&date=2026-09-01");
    expect(res.status).toBe(200);
    expect(h.build).toHaveBeenCalledWith("emp-a", "2026-09-01");
  });
  it("admin is refused for an employee of another branch and nothing is built", async () => {
    h.hasRole.mockResolvedValue(true); h.canViewEmployee.mockResolvedValue(false);
    const res = await request(app()).get("/api/management/daily-brief/preview?employeeId=emp-b&date=2026-09-01");
    expect(res.status).toBe(403);
    expect(h.build).not.toHaveBeenCalled();
  });
  it("a non-admin still previews only their own brief", async () => {
    h.hasRole.mockResolvedValue(false);
    expect((await request(app()).get("/api/management/daily-brief/preview?employeeId=emp-b")).status).toBe(403);
    expect((await request(app()).get("/api/management/daily-brief/preview?employeeId=emp-self")).status).toBe(200);
  });
});
