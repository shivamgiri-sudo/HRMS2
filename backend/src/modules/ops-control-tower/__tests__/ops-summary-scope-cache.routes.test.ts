import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ allowed: null as null | string[], load: vi.fn() }));

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _r: any, next: any) => { req.authUser = { id: "u1" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _r: any, next: any) => next() }));
vi.mock("../../../logger.js", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRole: vi.fn(async () => true) }));
vi.mock("../../../shared/dashboardScope.js", () => ({
  DashboardScopeConfigurationError: class extends Error {},
  resolveDashboardScopeForRequest: vi.fn(async () =>
    m.allowed === null ? { level: "ORG_ALL", branchIds: [] } : { level: "BRANCH_ALL", branchIds: m.allowed }),
}));
vi.mock("../ops-control-tower.service.js", () => ({
  getOpsControlTowerSummary: (...a: unknown[]) => m.load(...a),
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

import { opsControlTowerRouter } from "../ops-control-tower.routes.js";
import { clearSummaryCache } from "../ops-summary-cache.js";

const app = express();
app.use("/api/ops-control-tower", opsControlTowerRouter);

const B1 = "b1";
const B2 = "b2";
const org = () => ({
  nowMs: 1,
  fnfPending: { branches: [{ branchId: B1, branchName: "NOIDA", count: 4 }, { branchId: B2, branchName: "JAIPUR", count: 6 }], grandTotal: 10 },
});

beforeEach(() => { clearSummaryCache(); m.load.mockReset().mockImplementation(async () => org()); m.allowed = null; });

describe("summary cache never leaks one caller's scope to another", () => {
  it("an org-wide call, then a branch-scoped call, then another branch: each sees only its own data, from one load", async () => {
    const all = await request(app).get("/api/ops-control-tower?date=2026-10-03");
    expect(all.body.fnfPending.grandTotal).toBe(10);
    expect(all.body.fnfPending.branches).toHaveLength(2);

    m.allowed = [B1];
    const one = await request(app).get("/api/ops-control-tower?date=2026-10-03");
    expect(one.body.fnfPending.branches.map((b: any) => b.branchId)).toEqual([B1]);
    expect(one.body.fnfPending.grandTotal).toBe(4);

    m.allowed = [B2];
    const two = await request(app).get("/api/ops-control-tower?date=2026-10-03");
    expect(two.body.fnfPending.branches.map((b: any) => b.branchId)).toEqual([B2]);
    expect(two.body.fnfPending.grandTotal).toBe(6);

    expect(m.load).toHaveBeenCalledTimes(1);
  });

  it("scoping the cached copy does not mutate it (the org-wide view is still whole afterwards)", async () => {
    m.allowed = [B1];
    await request(app).get("/api/ops-control-tower?date=2026-10-03");
    m.allowed = null;
    const all = await request(app).get("/api/ops-control-tower?date=2026-10-03");
    expect(all.body.fnfPending.grandTotal).toBe(10);
    expect(all.body.fnfPending.branches).toHaveLength(2);
  });

  it("a caller with an empty scope gets nothing, even though the cache holds data", async () => {
    await request(app).get("/api/ops-control-tower?date=2026-10-03");
    m.allowed = [];
    const none = await request(app).get("/api/ops-control-tower?date=2026-10-03");
    expect(none.body.fnfPending.branches).toEqual([]);
    expect(none.body.fnfPending.grandTotal).toBe(0);
  });

  it("different dates are cached separately", async () => {
    await request(app).get("/api/ops-control-tower?date=2026-10-03");
    await request(app).get("/api/ops-control-tower?date=2026-10-02");
    expect(m.load).toHaveBeenCalledTimes(2);
  });
});
