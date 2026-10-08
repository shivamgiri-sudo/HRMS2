import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Owner policy 2026-10-01: cost-centre approve-l1 / approve-l2 / reject and the approval queue are branch-scoped for admin; finance_head / accounts_head / super_admin are org-wide. */
const { svc, policy, branchOf } = vi.hoisted(() => ({
  svc: { approveL1: vi.fn(), approveL2: vi.fn(), reject: vi.fn(), getApprovalQueue: vi.fn() },
  policy: { orgWide: false, ownBranchId: "br-A" as string | null },
  branchOf: vi.fn(),
}));
vi.mock("../cost-centre-management.service.js", () => ({ costCentreManagementService: svc }));
vi.mock("../finance-access-scope.js", () => ({ assertFinanceRecordBranch: vi.fn(), resolveFinanceBranchScope: vi.fn() }));
vi.mock("../../../shared/branchDecisionScope.js", () => ({
  costCentreBranchId: branchOf,
  loadBranchPolicy: async () => ({
    ...policy,
    allows: (b: unknown) => policy.orgWide || (!!policy.ownBranchId && !!b && String(b) === policy.ownBranchId),
  }),
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-me", role: "admin" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));

const { costCentreManagementRouter } = await import("../cost-centre-management.routes.js");
const app = () => { const a = express(); a.use(express.json()); a.use("/api/finance/cost-centres", costCentreManagementRouter); return a; };

beforeEach(() => {
  Object.values(svc).forEach((f) => f.mockReset());
  svc.approveL1.mockResolvedValue({ id: "cc1" }); svc.approveL2.mockResolvedValue({ id: "cc1" }); svc.reject.mockResolvedValue({ id: "cc1" });
  branchOf.mockReset(); policy.orgWide = false; policy.ownBranchId = "br-A";
});

const cases: Array<[string, string, Record<string, unknown>, keyof typeof svc]> = [
  ["approve-l1", "/api/finance/cost-centres/cc1/approve-l1", {}, "approveL1"],
  ["approve-l2", "/api/finance/cost-centres/cc1/approve-l2", {}, "approveL2"],
  ["reject", "/api/finance/cost-centres/cc1/reject", { reason: "no" }, "reject"],
];

describe.each(cases)("POST %s", (_n, url, body, fn) => {
  it("admin of another branch gets 403", async () => {
    branchOf.mockResolvedValue("br-B");
    const res = await request(app()).post(url).send(body);
    expect(res.status).toBe(403);
    expect(svc[fn]).not.toHaveBeenCalled();
  });
  it("admin of the same branch is allowed", async () => {
    branchOf.mockResolvedValue("br-A");
    expect((await request(app()).post(url).send(body)).status).toBe(200);
    expect(svc[fn]).toHaveBeenCalledTimes(1);
  });
  it("cost centre without a branch fails closed", async () => {
    branchOf.mockResolvedValue(null);
    expect((await request(app()).post(url).send(body)).status).toBe(403);
  });
  it("org-wide (finance_head / accounts_head / super_admin) is allowed with no branch lookup", async () => {
    policy.orgWide = true; policy.ownBranchId = null;
    expect((await request(app()).post(url).send(body)).status).toBe(200);
    expect(branchOf).not.toHaveBeenCalled();
  });
});

describe("GET /approval-queue", () => {
  const queue = [{ id: "a", branch_id: "br-A" }, { id: "b", branch_id: "br-B" }, { id: "c", branch_id: null }];
  it("admin sees only own-branch cost centres", async () => {
    svc.getApprovalQueue.mockResolvedValue(queue);
    const res = await request(app()).get("/api/finance/cost-centres/approval-queue");
    expect(res.body.data.map((q: any) => q.id)).toEqual(["a"]);
  });
  it("org-wide sees the whole queue", async () => {
    policy.orgWide = true;
    svc.getApprovalQueue.mockResolvedValue(queue);
    expect((await request(app()).get("/api/finance/cost-centres/approval-queue")).body.data).toHaveLength(3);
  });
});
