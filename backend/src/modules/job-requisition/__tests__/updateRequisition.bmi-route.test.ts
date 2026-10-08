import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  gate: { roles: [] as string[], userRole: "hr" },
  svc: { updateRequisition: vi.fn(async () => ({ id: "r1" })), isRequisitionVisible: vi.fn(async () => true) },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1", role: h.gate.userRole }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!h.gate.roles.length) h.gate.roles = roles;
    return roles.includes(req.authUser.role) ? next() : res.status(403).json({ success: false });
  },
}));
vi.mock("../job-requisition.service.js", () => ({ jobRequisitionService: h.svc }));
vi.mock("../../../shared/requestContext.js", () => ({ memoizeForRequest: (_k: string, fn: () => unknown) => fn() }));
vi.mock("../../../shared/demoAuth.js", () => ({ demoRoleForUserId: () => null }));

async function app() {
  const { jobRequisitionRouter } = await import("../job-requisition.routes.js");
  const a = express(); a.use(express.json()); a.use("/api/job-requisition", jobRequisitionRouter); return a;
}
beforeEach(() => { vi.clearAllMocks(); h.svc.isRequisitionVisible.mockResolvedValue(true); h.gate.userRole = "hr"; });

describe("PATCH /api/job-requisition/:id (assessment link edit)", () => {
  it("forwards the link edit to the service for an allowed role", async () => {
    const res = await request(await app()).patch("/api/job-requisition/r1").send({ bmi_assessment_url: "https://x.com/a" });
    expect(res.status).toBe(200);
    expect(h.svc.updateRequisition).toHaveBeenCalledWith("r1", { bmi_assessment_url: "https://x.com/a" }, "u1");
  });
  it("refuses a role outside the requisition editors", async () => {
    h.gate.userRole = "employee";
    const res = await request(await app()).patch("/api/job-requisition/r1").send({ bmi_assessment_url: "https://x.com/a" });
    expect(res.status).toBe(403);
    expect(h.svc.updateRequisition).not.toHaveBeenCalled();
  });
  it("404s a requisition outside the caller's branch scope", async () => {
    h.svc.isRequisitionVisible.mockResolvedValue(false);
    const res = await request(await app()).patch("/api/job-requisition/r1").send({ bmi_assessment_url: "https://x.com/a" });
    expect(res.status).toBe(404);
    expect(h.svc.updateRequisition).not.toHaveBeenCalled();
  });
});
