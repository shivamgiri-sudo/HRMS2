import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { svc, roleGuard } = vi.hoisted(() => ({
  svc: {
    addMapping: vi.fn(), bulkAssignLob: vi.fn(), createLob: vi.fn(), getEmployeeLobOptions: vi.fn(),
    getMappingDetail: vi.fn(), getProcessLobOptions: vi.fn(), listActiveLobs: vi.fn(),
    listEmployeesWithoutLob: vi.fn(), listManageableProcesses: vi.fn(), listMappings: vi.fn(),
    setEmployeeLob: vi.fn(), setMappingActive: vi.fn(), summarizeEmployeesWithoutLob: vi.fn(),
  },
  roleGuard: vi.fn(),
}));

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-1", role: "wfm" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (...roles: string[]) => { roleGuard(...roles); return (_req: any, _res: any, next: any) => next(); },
}));
vi.mock("../process-lob-map.service.js", async () => {
  class LobServiceError extends Error {
    constructor(public statusCode: number, message: string, public code = "LOB_ERROR") { super(message); }
  }
  return {
    ...svc,
    LobServiceError,
    BULK_LOB_MAX: 2000,
    WFM_LOB_ROLES: ["wfm", "wfm_spoc", "branch_wfm", "ho_wfm", "admin", "hr", "super_admin"],
  };
});

import { processLobMapRouter } from "../process-lob-map.routes.js";
import { LobServiceError } from "../process-lob-map.service.js";

const app = express();
app.use(express.json());
app.use("/api/wfm/process-lobs", processLobMapRouter);
const base = "/api/wfm/process-lobs";

beforeEach(() => Object.values(svc).forEach((f) => f.mockReset()));

describe("process-lob-map routes", () => {
  it("guards the whole router with the WFM role list", () => {
    expect(roleGuard).toHaveBeenCalledWith("wfm", "wfm_spoc", "branch_wfm", "ho_wfm", "admin", "hr", "super_admin");
  });

  it("POST / validates the body before touching the service", async () => {
    const res = await request(app).post(base).send({ process_id: "" });
    expect(res.status).toBe(400);
    expect(svc.addMapping).not.toHaveBeenCalled();
  });

  it("POST / creates a mapping with 201 and passes the actor", async () => {
    svc.addMapping.mockResolvedValue({ id: "m1", reactivated: false });
    const res = await request(app).post(base).send({ process_id: "p1", lob_id: "l1" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: { id: "m1", reactivated: false } });
    expect(svc.addMapping).toHaveBeenCalledWith(expect.objectContaining({ id: "u-1" }), { process_id: "p1", lob_id: "l1" });
  });

  it("maps service errors to their status code", async () => {
    svc.addMapping.mockRejectedValue(new (LobServiceError as any)(409, "already mapped", "DUPLICATE_MAPPING"));
    const res = await request(app).post(base).send({ process_id: "p1", lob_id: "l1" });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ success: false, code: "DUPLICATE_MAPPING", message: "already mapped" });
    expect(res.body.error).toBeUndefined();
  });

  it("POST /lobs is routed to createLob, not captured by /:id", async () => {
    svc.createLob.mockResolvedValue({ id: "l9", lob_code: "SOCIAL", lob_name: "Social" });
    const res = await request(app).post(`${base}/lobs`).send({ lob_name: "Social" });
    expect(res.status).toBe(201);
    expect(svc.createLob).toHaveBeenCalled();
  });

  it("GET /processes and GET /employees-without-lob are not captured by /:id", async () => {
    svc.listManageableProcesses.mockResolvedValue({ items: [], total: 0 });
    svc.listEmployeesWithoutLob.mockResolvedValue({ items: [], total: 0 });
    expect((await request(app).get(`${base}/processes`)).status).toBe(200);
    expect((await request(app).get(`${base}/employees-without-lob`)).status).toBe(200);
    expect(svc.getMappingDetail).not.toHaveBeenCalled();
  });

  it("PUT /employees/:id/lob accepts null to clear and rejects a missing key", async () => {
    svc.setEmployeeLob.mockResolvedValue({ employee_id: "e1", lob_id: null, changed: true });
    expect((await request(app).put(`${base}/employees/e1/lob`).send({ lob_id: null })).status).toBe(200);
    expect(svc.setEmployeeLob).toHaveBeenCalledWith(expect.anything(), "e1", null);
    expect((await request(app).put(`${base}/employees/e1/lob`).send({})).status).toBe(400);
  });

  it("POST /employees/bulk-lob validates and forwards", async () => {
    svc.bulkAssignLob.mockResolvedValue({ updated: 2 });
    expect((await request(app).post(`${base}/employees/bulk-lob`).send({ process_id: "p1" })).status).toBe(400);
    const ok = await request(app).post(`${base}/employees/bulk-lob`).send({ process_id: "p1", lob_id: "l1", employee_ids: ["e1"] });
    expect(ok.status).toBe(200);
  });

  it("PUT /:id toggles active_status", async () => {
    svc.setMappingActive.mockResolvedValue({ id: "m1", changed: true });
    const res = await request(app).put(`${base}/m1`).send({ active_status: 0 });
    expect(res.status).toBe(200);
    expect(svc.setMappingActive).toHaveBeenCalledWith(expect.anything(), "m1", false);
    expect((await request(app).put(`${base}/m1`).send({ active_status: "maybe" })).status).toBe(400);
  });

  it("hides unexpected errors behind a 500", async () => {
    svc.listMappings.mockRejectedValue(new Error("boom: secret sql"));
    const res = await request(app).get(base);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("secret sql");
  });
});
