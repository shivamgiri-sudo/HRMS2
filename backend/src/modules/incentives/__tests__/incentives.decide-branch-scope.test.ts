import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owner policy 2026-10-01: batch approve / reject (single-step and chain) obey the same branch predicate as the
 * Approval Center popup - org-wide role, or batch.branch_id == caller's OWN employees.branch_id - and nobody decides a
 * batch they uploaded themself.
 */
const { execute, approveBatch, rejectBatch, listBatches, policy } = vi.hoisted(() => ({
  execute: vi.fn(), approveBatch: vi.fn(), rejectBatch: vi.fn(), listBatches: vi.fn(),
  policy: { orgWide: false, ownBranchId: "br-A" as string | null },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../incentives.service.js", () => ({ approveBatch, rejectBatch, listBatches }));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog: vi.fn() }));
vi.mock("../../payroll/payroll-branch-scope.js", () => ({
  employeeScopeFor: vi.fn(), filterVisibleEmployeeIds: vi.fn(), guardEmployee: vi.fn(), canSeeRun: vi.fn(),
  visibleBranchIdsFor: vi.fn(async () => null), // legacy (wider) visibility: sees everything, so only the new guard can refuse
  OUT_OF_SCOPE_BODY: {},
}));
vi.mock("../../../shared/branchDecisionScope.js", () => ({
  loadBranchPolicy: async () => ({
    ...policy,
    allows: (b: unknown) => policy.orgWide || (!!policy.ownBranchId && !!b && String(b) === policy.ownBranchId),
  }),
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-me", role: "admin" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));

const { incentivesRouter } = await import("../incentives.routes.js");
const app = () => { const a = express(); a.use(express.json()); a.use("/api/incentives", incentivesRouter); return a; };

const batch = (branch_id: string | null, uploaded_by = "u-wfm") => ({ branch_id, uploaded_by });
const batchLookup = (row: unknown) =>
  execute.mockImplementation(async (sql: string) => {
    if (/FROM incentive_upload_batch WHERE id = \? LIMIT 1/.test(sql)) return [row ? [row] : [], []];
    if (/FROM incentive_approval_step/.test(sql)) return [[{ id: "s1", step_number: 1, required_role: "branch_head", status: "pending" }], []];
    if (/FROM user_roles/.test(sql)) return [[{ role_key: "admin" }], []];
    return [[], []];
  });

beforeEach(() => {
  execute.mockReset(); approveBatch.mockReset(); rejectBatch.mockReset(); listBatches.mockReset();
  approveBatch.mockResolvedValue({ id: "b1" }); rejectBatch.mockResolvedValue({ id: "b1" });
  policy.orgWide = false; policy.ownBranchId = "br-A";
});

const endpoints: Array<[string, string, Record<string, unknown>, () => ReturnType<typeof vi.fn> | null]> = [
  ["approve", "/api/incentives/batches/b1/approve", {}, () => approveBatch],
  ["reject", "/api/incentives/batches/b1/reject", {}, () => rejectBatch],
  ["step-approve", "/api/incentives/batches/b1/step-approve", {}, () => null],
  ["step-reject", "/api/incentives/batches/b1/step-reject", { reason: "no" }, () => null],
];

describe.each(endpoints)("POST %s", (_name, url, body, svc) => {
  const stepWritten = () => execute.mock.calls.some(([sql]) => /UPDATE incentive_approval_step/.test(String(sql)));
  const acted = () => (svc() ? svc()!.mock.calls.length > 0 : stepWritten());

  it("admin of another branch gets 403 and nothing is written", async () => {
    batchLookup(batch("br-B"));
    const res = await request(app()).post(url).send(body);
    expect(res.status).toBe(403);
    expect(acted()).toBe(false);
  });
  it("admin of the same branch is allowed", async () => {
    batchLookup(batch("br-A"));
    const res = await request(app()).post(url).send(body);
    expect(res.status).toBe(200);
    expect(acted()).toBe(true);
  });
  it("batch without a branch fails closed for a branch-scoped caller", async () => {
    batchLookup(batch(null));
    expect((await request(app()).post(url).send(body)).status).toBe(403);
  });
  it("org-wide role is allowed whatever the branch", async () => {
    policy.orgWide = true; policy.ownBranchId = null;
    batchLookup(batch("br-B"));
    expect((await request(app()).post(url).send(body)).status).toBe(200);
    expect(acted()).toBe(true);
  });
  it("the uploader cannot decide their own batch (org-wide included)", async () => {
    policy.orgWide = true;
    batchLookup(batch("br-A", "u-me"));
    const res = await request(app()).post(url).send(body);
    expect(res.status).toBe(403);
    expect(acted()).toBe(false);
  });
  it("unknown batch is a 404, not a silent no-op", async () => {
    batchLookup(null);
    expect((await request(app()).post(url).send(body)).status).toBe(404);
  });
});

describe("GET /batches clamp", () => {
  const rows = [
    { id: "x1", branch_id: "br-A", uploaded_by: "u-wfm" },
    { id: "x2", branch_id: "br-B", uploaded_by: "u-wfm" },
    { id: "x3", branch_id: "br-B", uploaded_by: "u-me" },
  ];
  it("branch-scoped caller sees own-branch batches and ones they uploaded", async () => {
    listBatches.mockResolvedValue(rows);
    const res = await request(app()).get("/api/incentives/batches");
    expect(res.body.data.map((b: any) => b.id)).toEqual(["x1", "x3"]);
  });
  it("org-wide caller sees everything", async () => {
    policy.orgWide = true;
    listBatches.mockResolvedValue(rows);
    const res = await request(app()).get("/api/incentives/batches");
    expect(res.body.data).toHaveLength(3);
  });
});
