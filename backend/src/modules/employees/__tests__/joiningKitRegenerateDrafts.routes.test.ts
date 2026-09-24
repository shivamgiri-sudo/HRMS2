/**
 * POST /:employeeId/joining-kit/regenerate-drafts — role gate and wiring.
 * requireAuth is replaced by a header-driven stub; requireRole is the real one,
 * so the role gate under test is the production gate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import path from "path";

const regenerateMissingKitDrafts = vi.fn();

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(async () => [[]]) } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    const role = req.header("x-test-role");
    if (role) req.authUser = { id: "user-1", roles: [role] };
    next();
  },
}));
vi.mock("../joiningKitDraftRepair.service.js", () => ({ regenerateMissingKitDrafts }));
vi.mock("../joiningKitPublic.service.js", () => ({
  getPublicKitSession: vi.fn(), getPublicKitFile: vi.fn(), startKitEsign: vi.fn(),
}));
vi.mock("../joiningKitDispatch.service.js", () => ({
  queueJoiningKit: vi.fn(), dispatchJoiningKit: vi.fn(), resendKitEsignLink: vi.fn(),
  redispatchDeadKit: vi.fn(), kitEsignSessionIsAlive: vi.fn(),
}));
vi.mock("../joiningKitSync.service.js", () => ({ syncKitEsignStatus: vi.fn() }));
vi.mock("../joiningKitAssembly.service.js", () => ({ kitEligibleDocuments: vi.fn(async () => []) }));

const { joiningKitRouter } = await import("../joiningKit.routes.js");

const app = express();
app.use(express.json());
app.use("/api/employees", joiningKitRouter);

const RESULT = { attempted: 3, generated: 2, failed: [{ code: "ZERO_TOLERANCE_ACK", reason: "boom" }] };

beforeEach(() => {
  vi.clearAllMocks();
  regenerateMissingKitDrafts.mockResolvedValue(RESULT);
});

describe("POST /api/employees/:employeeId/joining-kit/regenerate-drafts", () => {
  it("rejects an unauthenticated caller", async () => {
    const res = await request(app).post("/api/employees/emp-1/joining-kit/regenerate-drafts");
    expect(res.status).toBe(401);
    expect(regenerateMissingKitDrafts).not.toHaveBeenCalled();
  });

  it.each(["employee", "manager", "recruiter"])("rejects the %s role", async (role) => {
    const res = await request(app)
      .post("/api/employees/emp-1/joining-kit/regenerate-drafts")
      .set("x-test-role", role);
    expect(res.status).toBe(403);
    expect(regenerateMissingKitDrafts).not.toHaveBeenCalled();
  });

  it.each(["super_admin", "admin", "hr", "hr_manager", "payroll_hr"])("admits the %s role", async (role) => {
    const res = await request(app)
      .post("/api/employees/emp-9/joining-kit/regenerate-drafts")
      .set("x-test-role", role);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: RESULT });
    // The acting user id is what the service records in the audit log.
    expect(regenerateMissingKitDrafts).toHaveBeenCalledWith("emp-9", "user-1");
  });

  it("the service, which the route delegates all writes to, records the audit entry", () => {
    const service = fs.readFileSync(path.resolve(__dirname, "../joiningKitDraftRepair.service.ts"), "utf8");
    expect(service).toMatch(/KIT_DRAFTS_REGENERATED/);
    expect(service).toMatch(/employee_joining_document_audit_log/);
  });
});
