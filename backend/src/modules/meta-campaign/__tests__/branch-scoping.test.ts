import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Branch scoping (owner policy 2026-10-01): only org-wide roles see every branch; hr / manager and everyone
 * else is limited to their own branch; a browser ?branchName= may only narrow; unresolved branch => nothing.
 */
const { dbExecute, svc, caller } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  svc: {
    getOverview: vi.fn(async () => ({ campaigns: 1 })),
    getFilterOptions: vi.fn(async () => ({ branches: [], processes: [], requisitions: [] })),
    listCampaigns: vi.fn(async () => []),
    getCampaign: vi.fn(async () => ({ id: "c1" })),
    getCampaignFunnel: vi.fn(async () => ({ campaignId: "c1" })),
    listLeads: vi.fn(async () => []),
    listAllLeads: vi.fn(async () => ({ rows: [], total: 0 })),
    rescreenLead: vi.fn(async () => ({ id: "l1" })),
    createCandidateFromLead: vi.fn(async () => "cand"),
    createCampaign: vi.fn(async () => ({ id: "c-new" })),
    updateCampaign: vi.fn(async () => ({ id: "c1" })),
  },
  caller: { roles: ["hr"] as string[] },
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1", role: caller.roles[0] }; req.userRoles = caller.roles; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../meta-campaign.service.js", () => ({ metaCampaignService: svc }));
vi.mock("../lead-outreach.service.js", () => ({
  notifyQualifiedLead: vi.fn(async () => ({ sent: true })), buildNotifyPreview: vi.fn(async () => ({})),
  recordVoiceCallback: vi.fn(), recordWalkInConfirmation: vi.fn(),
}));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog: vi.fn() }));
vi.mock("../../../shared/requestContext.js", () => ({ memoizeForRequest: (_k: string, fn: () => unknown) => fn() }));
vi.mock("../../../shared/demoAuth.js", () => ({ demoRoleForUserId: () => null }));

/** Caller's branch ("Noida") resolves through employees/branch_master; leads/campaigns of "Noida" only. */
function dbFor(opts: { branch: string | null }) {
  dbExecute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/FROM employees e\s+JOIN branch_master/.test(sql)) return [opts.branch ? [{ branch_name: opts.branch }] : [], []];
    if (/FROM meta_lead_raw ml\s+JOIN job_requisition jr/.test(sql)) return [params[1] === "Noida" && params[0] === "lead-noida" ? [{ 1: 1 }] : [], []];
    if (/FROM meta_campaign mc\s+JOIN job_requisition jr/.test(sql)) return [params[1] === "Noida" && params[0] === "camp-noida" ? [{ 1: 1 }] : [], []];
    if (/FROM job_requisition WHERE id = \? AND branch_name/.test(sql)) return [params[1] === "Noida" && params[0] === "req-noida" ? [{ 1: 1 }] : [], []];
    return [[], []];
  });
}

async function app() {
  const { metaCampaignRouter } = await import("../meta-campaign.routes.js");
  const a = express();
  a.use(express.json());
  a.use("/api/meta", metaCampaignRouter);
  return a;
}

beforeEach(() => { vi.clearAllMocks(); caller.roles = ["hr"]; });

describe("meta-access", () => {
  it("hr, manager and management and admin are no longer all-branch; the org-wide exempt roles are", async () => {
    const { hasAllBranchAccess } = await import("../meta-access.js");
    for (const r of ["hr", "manager", "management", "branch_head", "recruiter", "admin"]) expect(hasAllBranchAccess([r])).toBe(false);
    for (const r of ["super_admin", "ceo", "coo", "cfo", "payroll_head", "finance_head", "accounts_head", "finance"]) {
      expect(hasAllBranchAccess([r])).toBe(true);
    }
  });
  it("effectiveBranchFilter: a requested branch only narrows; unresolved branch or foreign branch => deny", async () => {
    const { effectiveBranchFilter } = await import("../meta-access.js");
    expect(effectiveBranchFilter({ all: true }, "Delhi")).toEqual({ deny: false, branchName: "Delhi" });
    expect(effectiveBranchFilter({ all: true }, undefined)).toEqual({ deny: false, branchName: undefined });
    expect(effectiveBranchFilter({ all: false, branchName: "Noida" }, undefined)).toEqual({ deny: false, branchName: "Noida" });
    expect(effectiveBranchFilter({ all: false, branchName: "Noida" }, "noida")).toEqual({ deny: false, branchName: "Noida" });
    expect(effectiveBranchFilter({ all: false, branchName: "Noida" }, "Delhi").deny).toBe(true);
    expect(effectiveBranchFilter({ all: false, branchName: null }, "Noida").deny).toBe(true);
    expect(effectiveBranchFilter({ all: false, branchName: null }).deny).toBe(true);
  });
});

describe("meta-campaign reads", () => {
  it("overview/leads/filter-options are pinned to the hr user's branch", async () => {
    dbFor({ branch: "Noida" });
    const a = await app();
    expect((await request(a).get("/api/meta/overview")).status).toBe(200);
    expect(svc.getOverview).toHaveBeenCalledWith("Noida");
    await request(a).get("/api/meta/leads");
    expect(svc.listLeads).toHaveBeenCalledWith(expect.objectContaining({ branchName: "Noida" }));
    await request(a).get("/api/meta/filter-options");
    expect(svc.getFilterOptions).toHaveBeenCalledWith("Noida");
  });

  it("overview refuses a foreign ?branchName= (403) and campaigns returns nothing for it", async () => {
    dbFor({ branch: "Noida" });
    const a = await app();
    expect((await request(a).get("/api/meta/overview?branchName=Delhi")).status).toBe(403);
    const res = await request(a).get("/api/meta/campaigns?branchName=Delhi");
    expect(res.body.data).toEqual([]);
    expect(svc.listCampaigns).not.toHaveBeenCalled();
  });

  it("a branch-scoped user with NO resolvable branch sees nothing (was: client branchName fell through)", async () => {
    dbFor({ branch: null });
    const a = await app();
    const res = await request(a).get("/api/meta/campaigns?branchName=Delhi");
    expect(res.body.data).toEqual([]);
    expect((await request(a).get("/api/meta/leads-all?branchName=Delhi")).body.total).toBe(0);
    expect((await request(a).get("/api/meta/overview")).status).toBe(403);
    expect(svc.listCampaigns).not.toHaveBeenCalled();
    expect(svc.listAllLeads).not.toHaveBeenCalled();
  });

  it("an org-wide role keeps the unrestricted view and may pass any branch filter", async () => {
    caller.roles = ["ceo"];
    dbFor({ branch: null });
    const a = await app();
    expect((await request(a).get("/api/meta/overview")).status).toBe(200);
    expect(svc.getOverview).toHaveBeenCalledWith(undefined);
    await request(a).get("/api/meta/campaigns?branchName=Delhi");
    expect(svc.listCampaigns).toHaveBeenCalledWith(expect.objectContaining({ branchName: "Delhi" }));
  });

  it("campaign detail / funnel are 403 for another branch's campaign and open for own", async () => {
    dbFor({ branch: "Noida" });
    const a = await app();
    expect((await request(a).get("/api/meta/campaigns/camp-delhi")).status).toBe(403);
    expect((await request(a).get("/api/meta/campaigns/camp-delhi/funnel")).status).toBe(403);
    expect((await request(a).get("/api/meta/campaigns/camp-noida")).status).toBe(200);
    expect((await request(a).get("/api/meta/campaigns/camp-noida/funnel")).status).toBe(200);
  });
});

describe("meta-campaign lead / campaign writes", () => {
  it("rescreen, notify and create-candidate are refused for a lead outside the branch", async () => {
    dbFor({ branch: "Noida" });
    const a = await app();
    expect((await request(a).post("/api/meta/leads/lead-delhi/rescreen")).status).toBe(403);
    expect((await request(a).post("/api/meta/leads/lead-delhi/notify").send({})).status).toBe(403);
    expect((await request(a).post("/api/meta/leads/lead-delhi/create-candidate")).status).toBe(403);
    expect(svc.rescreenLead).not.toHaveBeenCalled();
    expect(svc.createCandidateFromLead).not.toHaveBeenCalled();
    expect((await request(a).post("/api/meta/leads/lead-noida/rescreen")).status).toBe(200);
  });

  it("create / patch campaign are limited to the caller's branch", async () => {
    dbFor({ branch: "Noida" });
    const a = await app();
    const body = { campaignName: "x", requisitionId: "req-delhi" };
    expect((await request(a).post("/api/meta/campaigns").send(body)).status).toBe(403);
    expect((await request(a).post("/api/meta/campaigns").send({ ...body, requisitionId: "req-noida" })).status).toBe(201);
    expect((await request(a).patch("/api/meta/campaigns/camp-delhi").send({})).status).toBe(403);
    expect((await request(a).patch("/api/meta/campaigns/camp-noida").send({})).status).toBe(200);
  });
});
