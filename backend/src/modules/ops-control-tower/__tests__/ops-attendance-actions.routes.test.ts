import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  allowed: null as null | string[],
  fullTower: true,
  roles: ["hr"] as string[],
  close: vi.fn(),
  backfill: vi.fn(),
  health: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _r: any, next: any) => { req.authUser = { id: "u1" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (...allowed: string[]) => (_q: any, res: any, next: any) =>
    m.roles.some((r) => allowed.includes(r)) ? next() : res.status(403).json({ error: "role" }),
}));
vi.mock("../../../logger.js", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: (...a: unknown[]) => m.audit(...a) }));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRole: vi.fn(async () => m.fullTower) }));
vi.mock("../../../shared/dashboardScope.js", () => ({
  DashboardScopeConfigurationError: class extends Error {},
  resolveDashboardScopeForRequest: vi.fn(async () => (m.allowed === null ? { level: "ORG_ALL", branchIds: [] } : { level: "BRANCH_ALL", branchIds: m.allowed })),
}));
vi.mock("../ops-control-tower.service.js", () => ({
  getOpsControlTowerSummary: vi.fn(),
  getAttendanceMismatchDetail: vi.fn(), getFnfPendingDetail: vi.fn(), getNocPendingDetail: vi.fn(),
  getDigilockerPendingDetail: vi.fn(), getEsignPendingDetail: vi.fn(), getAppointmentLetterDetail: vi.fn(),
  getPennyDropMissingDetail: vi.fn(), getAccountDetailsMissingDetail: vi.fn(), getDocsPendingDetail: vi.fn(),
  getBgvPendingDetail: vi.fn(), getAddressReviewPendingDetail: vi.fn(), getItProvisioningPendingDetail: vi.fn(), getAdminProvisioningPendingDetail: vi.fn(),
  getWfmProvisioningPendingDetail: vi.fn(),
}));
vi.mock("../ops-nudge.service.js", () => ({
  employeeBranchId: vi.fn(), nudgeEmployee: vi.fn(), nudgeBranchPending: vi.fn(), enrichDetailRows: vi.fn(),
  whatsappConfigured: () => false, issueOnboardingLink: vi.fn(),
}));
vi.mock("../ops-attendance-actions.service.js", () => ({
  closeOldAttendanceIssues: (...a: unknown[]) => m.close(...a),
  runBackfill: (...a: unknown[]) => m.backfill(...a),
  getSyncHealth: (...a: unknown[]) => m.health(...a),
}));

import { opsControlTowerRouter } from "../ops-control-tower.routes.js";
const app = express();
app.use(express.json());
app.use("/api/ops-control-tower", opsControlTowerRouter);

const B1 = "22222222-2222-2222-2222-222222222222";
const B2 = "33333333-3333-3333-3333-333333333333";
const post = (path: string, body: unknown) => request(app).post(`/api/ops-control-tower${path}`).send(body as object);

beforeEach(() => {
  Object.values(m).forEach((f) => typeof f === "function" && (f as any).mockReset?.());
  m.allowed = null; m.fullTower = true; m.roles = ["hr"];
  m.close.mockResolvedValue({ ok: true, closed: 12, leftOpen: 3, closableMonths: ["2026-06", "2026-07"] });
  m.backfill.mockResolvedValue({ ok: true, data: { found: 5, processed: 5, failed: 0, payrollRunsInRange: [] } });
  m.health.mockResolvedValue({ generatedAt: "x", jobs: [], days: [], lowDays: 0, coverage: [
    { branchId: B1, branchName: "NOIDA", activeStaff: 10, days: [{ date: "d", records: 1, pct: 10, low: true }] },
    { branchId: B2, branchName: "JAIPUR", activeStaff: 10, days: [{ date: "d", records: 10, pct: 100, low: false }] },
  ] });
});

describe("GET /sync-health", () => {
  it("returns coverage for the caller's branches only and recounts low days for them", async () => {
    m.allowed = [B2];
    const r = await request(app).get("/api/ops-control-tower/sync-health");
    expect(r.status).toBe(200);
    expect(r.body.coverage.map((b: any) => b.branchName)).toEqual(["JAIPUR"]);
    expect(r.body.lowDays).toBe(0);
  });
  it("org-wide sees everything", async () => {
    const r = await request(app).get("/api/ops-control-tower/sync-health");
    expect(r.body.coverage).toHaveLength(2);
    expect(r.body.lowDays).toBe(1);
  });
  it("a payroll_hr-only user is refused", async () => {
    m.roles = ["payroll_hr"]; m.fullTower = false;
    expect((await request(app).get("/api/ops-control-tower/sync-health")).status).toBe(403);
  });
});

describe("POST /attendance/close", () => {
  it("HR closes old items in an in-scope branch, and it is audited with the reason", async () => {
    m.allowed = [B1];
    const r = await post("/attendance/close", { branchId: B1, reason: "Payroll closed for July" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ closed: 12, leftOpen: 3, closableMonths: ["2026-06", "2026-07"] });
    expect(m.close).toHaveBeenCalledWith({ branchId: B1, reason: "Payroll closed for July", actorId: "u1", issueTypes: undefined });
    expect(m.audit.mock.calls[0][0]).toMatchObject({ action_type: "ATTENDANCE_MISMATCH_CLOSED_AS_REVIEWED", entity_id: B1 });
    expect(m.audit.mock.calls[0][0].change_summary).toMatchObject({ closed: 12, left_open: 3, months: ["2026-06", "2026-07"] });
  });
  it("refuses another branch, bad input, and roles that may not close", async () => {
    m.allowed = [B2];
    expect((await post("/attendance/close", { branchId: B1, reason: "Payroll closed for July" })).status).toBe(403);
    m.allowed = null;
    expect((await post("/attendance/close", { branchId: "x", reason: "Payroll closed for July" })).status).toBe(400);
    expect((await post("/attendance/close", { branchId: B1, reason: "Payroll closed for July", issueTypes: "all" })).status).toBe(400);
    m.roles = ["employee"];
    expect((await post("/attendance/close", { branchId: B1, reason: "Payroll closed for July" })).status).toBe(403);
    expect(m.close).not.toHaveBeenCalled();
  });
  it("passes the service's refusal (e.g. recent items) through with its status", async () => {
    m.close.mockResolvedValue({ ok: false, status: 400, message: "Give a reason of at least 5 characters" });
    const r = await post("/attendance/close", { branchId: B1, reason: "no" });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("reason");
    expect(m.audit).not.toHaveBeenCalled();
  });
});

describe("POST /attendance/backfill", () => {
  const body = { branchId: B1, from: "2026-07-20", to: "2026-07-31" };
  it("HR may NOT backfill: only admin / super_admin / payroll_head", async () => {
    m.roles = ["hr"];
    expect((await post("/attendance/backfill", { ...body, mode: "preview" })).status).toBe(403);
    m.roles = ["hr_admin"];
    expect((await post("/attendance/backfill", { ...body, mode: "preview" })).status).toBe(403);
    expect(m.backfill).not.toHaveBeenCalled();
  });
  it("payroll head previews without an audit entry and commits with one", async () => {
    m.roles = ["payroll_head"];
    expect((await post("/attendance/backfill", { ...body, mode: "preview" })).status).toBe(200);
    expect(m.audit).not.toHaveBeenCalled();
    const r = await post("/attendance/backfill", { ...body, mode: "commit", confirm: "BACKFILL" });
    expect(r.status).toBe(200);
    expect(m.backfill).toHaveBeenLastCalledWith({ branchId: B1, from: "2026-07-20", to: "2026-07-31", mode: "commit", confirm: "BACKFILL", actorId: "u1" });
    expect(m.audit.mock.calls[0][0]).toMatchObject({ action_type: "ATTENDANCE_BACKFILL", entity_id: B1 });
  });
  it("validates mode and branch, honours branch scope, and relays a missing-confirmation 409", async () => {
    m.roles = ["admin"];
    expect((await post("/attendance/backfill", { ...body, mode: "delete" })).status).toBe(400);
    expect((await post("/attendance/backfill", { ...body, branchId: "x", mode: "preview" })).status).toBe(400);
    m.allowed = [B2];
    expect((await post("/attendance/backfill", { ...body, mode: "preview" })).status).toBe(403);
    m.allowed = null;
    m.backfill.mockResolvedValue({ ok: false, status: 409, message: 'Send confirm: "BACKFILL"' });
    const r = await post("/attendance/backfill", { ...body, mode: "commit" });
    expect(r.status).toBe(409);
    expect(m.audit).not.toHaveBeenCalled();
  });
});
