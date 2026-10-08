import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  caller: { roles: ["hr"] as string[], branch: "NOIDA-2" as string | null },
  campBranch: { "11111111-1111-4111-8111-111111111111": "NOIDA-2", "22222222-2222-4222-8222-222222222222": "AHMEDABAD" } as Record<string, string>,
  reqBranch: { "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa": "NOIDA-2", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb": "AHMEDABAD" } as Record<string, string>,
  svc: { add: vi.fn(async () => ({ isPrimary: false, warnings: [], offerCopy: false, templateApplied: false })), remove: vi.fn(async () => ({ newPrimary: null })), primary: vi.fn(async () => undefined), list: vi.fn(async () => []) },
  relink: { preview: vi.fn(async () => ({ campaignId: "c", previewHash: "h".repeat(64), moveIds: ["secret"], move: { total: 1 } })), apply: vi.fn(async () => ({ moved: 1, kept: 0, relinkId: "x" })) },
  audit: vi.fn(async () => undefined),
  routing: { override: vi.fn(async () => undefined), held: vi.fn(async () => ({ counts: { hold: 1 }, held: [{ id: "l1", name: "Rig", maskedMobile: "99xxxxxx22" }] })) },
  leadBranch: { "cccccccc-cccc-4ccc-8ccc-cccccccccccc": "NOIDA-2", "dddddddd-dddd-4ddd-8ddd-dddddddddddd": "AHMEDABAD" } as Record<string, string>,
  rescreen: vi.fn(async () => null),
  arrival: vi.fn(async () => ({ path: "unified", status: "enqueued" })),
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1", role: h.caller.roles[0] }; req.userRoles = h.caller.roles; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (...allowed: string[]) => (req: any, res: any, next: any) => (req.userRoles.some((r: string) => allowed.includes(r)) ? next() : res.status(403).json({ success: false })),
}));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog: h.audit }));
vi.mock("../meta-access.js", () => ({
  resolveBranchScope: async (_u: string, roles: string[]) => (roles.includes("super_admin") || roles.includes("ceo") ? { all: true } : { all: false, branchName: h.caller.branch }),
  canAccessCampaign: async (id: string, s: any) => s.all || h.campBranch[id] === s.branchName,
  canAccessRequisition: async (id: string, s: any) => s.all || h.reqBranch[id] === s.branchName,
  canAccessLead: async (id: string, s: any) => s.all || h.leadBranch[id] === s.branchName,
}));
vi.mock("../campaign-requisition.service.js", () => ({
  addCampaignRequisition: h.svc.add, removeCampaignRequisition: h.svc.remove, setPrimaryRequisition: h.svc.primary, listCampaignRequisitions: h.svc.list,
}));
vi.mock("../lead-routing.service.js", () => ({ overrideLeadRequisition: h.routing.override, campaignRoutingSummary: h.routing.held }));
vi.mock("../meta-campaign.service.js", () => ({ metaCampaignService: { rescreenLead: h.rescreen } }));
vi.mock("../../selection/meta-arrival.service.js", () => ({ enrolMetaArrival: h.arrival }));
vi.mock("../campaign-relink.service.js", () => ({ previewRelink: h.relink.preview, applyRelink: h.relink.apply }));

import { campaignRequisitionRouter } from "../campaign-requisition.routes.js";

const app = () => { const a = express(); a.use(express.json()); a.use("/api/meta", campaignRequisitionRouter); return a; };
const C1 = "11111111-1111-4111-8111-111111111111", C2 = "22222222-2222-4222-8222-222222222222";
const R1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", R2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => { vi.clearAllMocks(); h.caller.roles = ["hr"]; h.caller.branch = "NOIDA-2"; });

describe("campaign requisition routes", () => {
  it("lists for a campaign in scope; 403 for another branch's campaign; 400 for a bad id", async () => {
    expect((await request(app()).get(`/api/meta/campaigns/${C1}/requisitions`)).status).toBe(200);
    expect((await request(app()).get(`/api/meta/campaigns/${C2}/requisitions`)).status).toBe(403);
    expect((await request(app()).get(`/api/meta/campaigns/x/requisitions`)).status).toBe(400);
  });

  it("adds a requisition in scope (audited); 403 for a requisition of another branch; 400 without one", async () => {
    const ok = await request(app()).post(`/api/meta/campaigns/${C1}/requisitions`).send({ requisitionId: R1, templateId: "night_shift_bpo" });
    expect(ok.status).toBe(201);
    expect(h.svc.add).toHaveBeenCalledWith(expect.objectContaining({ campaignId: C1, requisitionId: R1, templateId: "night_shift_bpo", actor: { id: "u1", role: "hr" } }));
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action_type: "META_CAMPAIGN_REQUISITION_ADD", entity_id: C1 }));
    expect((await request(app()).post(`/api/meta/campaigns/${C1}/requisitions`).send({ requisitionId: R2 })).status).toBe(403);
    expect((await request(app()).post(`/api/meta/campaigns/${C1}/requisitions`).send({})).status).toBe(400);
  });

  it("service errors keep their status (unknown requisition 400, not linked 409)", async () => {
    h.svc.primary.mockRejectedValueOnce(Object.assign(new Error("Link the requisition to this campaign first"), { statusCode: 409 }));
    const r = await request(app()).put(`/api/meta/campaigns/${C1}/requisitions/${R1}/primary`);
    expect(r.status).toBe(409);
    expect(r.body.message).toContain("Link the requisition");
  });

  it("view-only roles cannot write; the CEO can read every branch", async () => {
    h.caller.roles = ["ceo"];
    expect((await request(app()).get(`/api/meta/campaigns/${C2}/requisitions`)).status).toBe(200);
    expect((await request(app()).post(`/api/meta/campaigns/${C2}/requisitions`).send({ requisitionId: R2 })).status).toBe(403);
    expect((await request(app()).delete(`/api/meta/campaigns/${C2}/requisitions/${R2}`)).status).toBe(403);
  });

  it("relink preview never returns lead ids; apply needs confirm + the preview hash", async () => {
    const p = await request(app()).get(`/api/meta/campaigns/${C1}/relink-preview?to=${R1}`);
    expect(p.status).toBe(200);
    expect(JSON.stringify(p.body)).not.toContain("secret");
    expect((await request(app()).post(`/api/meta/campaigns/${C1}/relink`).send({ toRequisitionId: R1, previewHash: "h".repeat(64) })).status).toBe(400);
    const a = await request(app()).post(`/api/meta/campaigns/${C1}/relink`).send({ toRequisitionId: R1, previewHash: "h".repeat(64), confirm: true, reason: "K7BK closed" });
    expect(a.status).toBe(200);
    expect(h.relink.apply).toHaveBeenCalledWith(expect.objectContaining({ campaignId: C1, toRequisitionId: R1, reason: "K7BK closed" }));
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action_type: "META_CAMPAIGN_RELINK" }));
  });

  it("relink to a requisition of another branch is refused before any read", async () => {
    expect((await request(app()).get(`/api/meta/campaigns/${C1}/relink-preview?to=${R2}`)).status).toBe(403);
    expect(h.relink.preview).not.toHaveBeenCalled();
  });
});

describe("lead placement (B1 override) and the held list", () => {
  const L1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", L2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  it("HR places a lead in scope on a requisition in scope; audited; re-screened through the service", async () => {
    const r = await request(app()).put(`/api/meta/leads/${L1}/requisition`).send({ requisitionId: R1 });
    expect(r.status).toBe(200);
    expect(h.routing.override).toHaveBeenCalledWith(expect.objectContaining({ metaLeadId: L1, requisitionId: R1, actor: "u1" }));
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action_type: "META_LEAD_REQUISITION_OVERRIDE", entity_id: L1 }));
    // the placement enrols through the one Live Meta arrival path
    const enrol = (h.routing.override.mock.calls[0] as unknown as [{ enrol: (id: string) => Promise<unknown> }])[0].enrol;
    await enrol(L1);
    expect(h.arrival).toHaveBeenCalledWith(L1);
  });
  it("another branch's lead is 403; a contacted lead's 409 comes through", async () => {
    expect((await request(app()).put(`/api/meta/leads/${L2}/requisition`).send({ requisitionId: R1 })).status).toBe(403);
    h.routing.override.mockRejectedValueOnce(Object.assign(new Error("already contacted"), { statusCode: 409 }));
    expect((await request(app()).put(`/api/meta/leads/${L1}/requisition`).send({ requisitionId: R1 })).status).toBe(409);
  });
  it("the routing summary of a campaign lists held leads masked", async () => {
    const r = await request(app()).get(`/api/meta/campaigns/${C1}/routing`);
    expect(r.status).toBe(200);
    expect(r.body.data.held[0].maskedMobile).toBe("99xxxxxx22");
  });
});
