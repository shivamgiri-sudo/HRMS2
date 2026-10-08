import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Org masters (owner ruling 2026-10-01): hr sees / changes only its own branch(es). */
const { dbExecute, state, branchSvc, ccSvc } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  state: { orgWide: false, branchIds: ["b1"] as string[] },
  branchSvc: { list: vi.fn(), getById: vi.fn(), updateCallCentreCode: vi.fn(async () => undefined), setStatus: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  ccSvc: { list: vi.fn(async () => []), getById: vi.fn(), create: vi.fn(async (b: any) => b), update: vi.fn(async () => ({})), setStatus: vi.fn(), migrate: vi.fn(), delete: vi.fn(), countOrphanedRecords: vi.fn() },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-hr", role: "hr", roles: ["hr"] }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../branchScope.js", () => ({
  resolveCallerBranchScope: async () => ({ orgWide: state.orgWide, branchIds: state.branchIds }),
  branchAllowed: (s: any, b: any) => s.orgWide || (b && s.branchIds.includes(String(b))),
}));
vi.mock("../../finance/finance-access-scope.js", () => ({
  resolveFinanceBranchScopeSet: async () => ({ mode: "branches", branchIds: state.branchIds }),
}));
vi.mock("../org.service.js", () => {
  const stub = () => ({ list: vi.fn(async () => []), getById: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), setStatus: vi.fn() });
  return { branchService: branchSvc, costCentreService: ccSvc, departmentService: stub(), lobService: stub(), designationService: stub(), campaignService: stub(), gradeBandService: stub(), locationService: stub(), policyService: stub(), processService: stub() };
});

const { default: router } = await import("../org.routes.js").then((m: any) => ({ default: m.default ?? m.orgRouter ?? Object.values(m).find((v: any) => typeof v === "function" && v.stack) }));
const app = () => { const a = express(); a.use(express.json()); a.use("/api/org", router as any); return a; };

beforeEach(() => {
  state.orgWide = false; state.branchIds = ["b1"]; dbExecute.mockReset(); dbExecute.mockResolvedValue([[], []]);
  branchSvc.list.mockResolvedValue([{ id: "b1" }, { id: "b2" }]); branchSvc.updateCallCentreCode.mockClear();
  ccSvc.getById.mockResolvedValue({ id: "cc1", branch_id: "b2" }); ccSvc.update.mockClear(); ccSvc.create.mockClear();
});

describe("org scoping", () => {
  it("branch catalog for hr only lists its own branch; admin sees all", async () => {
    let res = await request(app()).get("/api/org/branches");
    expect(res.body.data).toEqual([{ id: "b1" }]);
    state.orgWide = true;
    res = await request(app()).get("/api/org/branches");
    expect(res.body.data).toHaveLength(2);
  });
  it("call-centre-code PATCH on another branch is 403", async () => {
    expect((await request(app()).patch("/api/org/branches/b2/call-centre-code").send({ ccCode: "x" })).status).toBe(403);
    expect(branchSvc.updateCallCentreCode).not.toHaveBeenCalled();
    expect((await request(app()).patch("/api/org/branches/b1/call-centre-code").send({ ccCode: "x" })).status).toBe(200);
  });
  it("cost-centre writes outside the caller's branches are 403; creation needs an own branch", async () => {
    expect((await request(app()).put("/api/org/cost-centres/cc1").send({ name: "x" })).status).toBe(403);
    expect((await request(app()).post("/api/org/cost-centres").send({ branch_id: "b2" })).status).toBe(403);
    expect((await request(app()).post("/api/org/cost-centres").send({ branch_id: "b1" })).status).toBe(201);
  });
  it("billing-summary is branch-filtered (and empty with no branch scope)", async () => {
    await request(app()).get("/api/org/cost-centres/billing-summary");
    const [sql, params] = dbExecute.mock.calls[0];
    expect(sql).toMatch(/cc\.branch_id IN \(\?\)/);
    expect(params).toEqual(["May-25", "Jun-25", "Jul-25", "b1"]);
    state.branchIds = []; dbExecute.mockClear();
    const res = await request(app()).get("/api/org/cost-centres/billing-summary");
    expect(res.body.data).toEqual({});
    expect(dbExecute).not.toHaveBeenCalled();
  });
});
