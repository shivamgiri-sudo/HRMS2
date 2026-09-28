import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { svc, roleGuard } = vi.hoisted(() => ({
  svc: {
    createPolicy: vi.fn(), getPolicyDetail: vi.fn(), listBranchOptions: vi.fn(), listPolicies: vi.fn(),
    resolvePolicyForEmployee: vi.fn(), setPolicyActive: vi.fn(), updatePolicy: vi.fn(),
  },
  roleGuard: vi.fn(),
}));

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-1", role: "wfm" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (...roles: string[]) => { roleGuard(...roles); return (_req: any, _res: any, next: any) => next(); },
}));
vi.mock("../roster-offday-policy.service.js", () => svc);
vi.mock("../process-lob-map.service.js", () => {
  class LobServiceError extends Error {
    constructor(public statusCode: number, message: string, public code = "LOB_ERROR") { super(message); }
  }
  return { LobServiceError, WFM_LOB_ROLES: ["wfm", "wfm_spoc", "branch_wfm", "ho_wfm", "admin", "hr", "super_admin"] };
});

import { rosterOffdayPolicyRouter } from "../roster-offday-policy.routes.js";
import { LobServiceError } from "../process-lob-map.service.js";

const app = express();
app.use(express.json());
app.use("/api/wfm/roster-offday-policies", rosterOffdayPolicyRouter);
const base = "/api/wfm/roster-offday-policies";
const valid = { process_id: "p1", lob_id: "l1", off_type: "FIXED_DAY", fixed_weekdays: [0], effective_from: "2026-09-01" };

beforeEach(() => Object.values(svc).forEach((f) => f.mockReset()));

describe("roster-offday-policy routes", () => {
  it("guards the whole router with the WFM role list (a non-WFM role is refused by requireRole)", () => {
    expect(roleGuard).toHaveBeenCalledWith("wfm", "wfm_spoc", "branch_wfm", "ho_wfm", "admin", "hr", "super_admin");
  });
  it("POST / validates the body before touching the service", async () => {
    for (const body of [{}, { ...valid, off_type: "WEEKLY" }, { ...valid, effective_from: "01/09/2026" }, { ...valid, fixed_weekdays: [9] }]) {
      expect((await request(app).post(base).send(body)).status).toBe(400);
    }
    expect(svc.createPolicy).not.toHaveBeenCalled();
  });
  it("POST / creates with 201 and passes the actor", async () => {
    svc.createPolicy.mockResolvedValue({ id: "n1" });
    const res = await request(app).post(base).send(valid);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: { id: "n1" } });
    expect(svc.createPolicy).toHaveBeenCalledWith(expect.objectContaining({ id: "u-1" }), valid);
  });
  it("maps service errors to their status (409 overlap, 403 scope) and never 500", async () => {
    svc.createPolicy.mockRejectedValueOnce(new (LobServiceError as any)(409, "overlaps", "POLICY_OVERLAP"));
    expect((await request(app).post(base).send(valid)).status).toBe(409);
    svc.createPolicy.mockRejectedValueOnce(new (LobServiceError as any)(403, "outside", "PROCESS_OUT_OF_SCOPE"));
    const res = await request(app).post(base).send(valid);
    expect(res.status).toBe(403);
    expect(res.body.error).toBeUndefined();
  });
  it("unexpected errors are 500 without leaking the message", async () => {
    svc.listPolicies.mockRejectedValue(new Error("secret sql"));
    const res = await request(app).get(base);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("secret sql");
  });
  it("/resolve and /branches are routed before /:id", async () => {
    svc.resolvePolicyForEmployee.mockResolvedValue({ source: "none" });
    svc.listBranchOptions.mockResolvedValue([]);
    expect((await request(app).get(`${base}/resolve?employee_id=e1&date=2026-09-06`)).status).toBe(200);
    expect(svc.resolvePolicyForEmployee).toHaveBeenCalledWith(expect.anything(), "e1", "2026-09-06");
    expect((await request(app).get(`${base}/resolve?employee_id=e1`)).status).toBe(400);
    expect((await request(app).get(`${base}/branches`)).status).toBe(200);
    expect(svc.getPolicyDetail).not.toHaveBeenCalled();
  });
  it("GET /:id, PUT /:id and PATCH /:id/active reach the service", async () => {
    svc.getPolicyDetail.mockResolvedValue({ policy: {}, audit: [] });
    svc.updatePolicy.mockResolvedValue({ id: "x" });
    svc.setPolicyActive.mockResolvedValue({ id: "x", changed: true });
    expect((await request(app).get(`${base}/x`)).status).toBe(200);
    expect((await request(app).put(`${base}/x`).send({ off_type: "FLOATING", floating_offs_per_week: 2, effective_from: "2026-09-01" })).status).toBe(200);
    expect((await request(app).put(`${base}/x`).send({ off_type: "FLOATING" })).status).toBe(400);
    expect((await request(app).patch(`${base}/x/active`).send({ active_status: 0 })).status).toBe(200);
    expect(svc.setPolicyActive).toHaveBeenCalledWith(expect.anything(), "x", false);
  });
});
