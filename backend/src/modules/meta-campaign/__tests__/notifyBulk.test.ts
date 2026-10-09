import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  outcomes: {} as Record<string, unknown>,
  audits: [] as unknown[],
}));
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
  notifyQualifiedLead: vi.fn(async (id: string) => { const o = h.outcomes[id]; if (o instanceof Error) throw o; return o ?? { leadId: id, attempted: ["email"], succeeded: ["email"], skipped: [], failed: [] }; }), buildNotifyPreview: vi.fn(async () => ({})),
  recordVoiceCallback: vi.fn(), recordWalkInConfirmation: vi.fn(),
}));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog: vi.fn(async (e: unknown) => { h.audits.push(e); }) }));
vi.mock("../../../shared/requestContext.js", () => ({ memoizeForRequest: (_k: string, fn: () => unknown) => fn() }));
vi.mock("../../../shared/demoAuth.js", () => ({ demoRoleForUserId: () => null }));



import { notifyLeadsBulk } from "../meta-notify-bulk.service.js";

async function app() {
  const { metaCampaignRouter } = await import("../meta-campaign.routes.js");
  const a = express();
  a.use(express.json());
  a.use("/api/meta", metaCampaignRouter);
  return a;
}
const ok = (id: string) => ({ leadId: id, attempted: ["email"], succeeded: ["email"], skipped: [], failed: [] });
beforeEach(() => {
  vi.clearAllMocks(); caller.roles = ["hr"]; h.outcomes = {}; h.audits = [];
  dbExecute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/FROM employees e\s+JOIN branch_master/.test(sql)) return [[{ branch_name: "Noida" }], []];
    if (/FROM meta_lead_raw ml\s+JOIN job_requisition jr/.test(sql)) return [String(params[0]).startsWith("noida") ? [{ 1: 1 }] : [], []];
    if (/SELECT id FROM meta_lead_raw WHERE id IN/.test(sql)) return [(params as string[]).filter((x) => !x.startsWith("ghost")).map((id) => ({ id })), []];
    return [[], []];
  });
});

describe("notifyLeadsBulk", () => {
  it("one call per lead, never forced, tagged legacy_meta_bulk, with per-lead results and counts", async () => {
    const { notifyQualifiedLead } = await import("../lead-outreach.service.js");
    h.outcomes = { b: { leadId: "b", attempted: [], succeeded: [], skipped: [{ channel: "all", reason: "Already notified; pass force=true to re-send" }], failed: [] },
      c: { leadId: "c", attempted: ["email"], succeeded: [], skipped: [], failed: [{ channel: "email", error: "smtp down" }] }, d: new Error("boom"), a: ok("a") };
    const r = await notifyLeadsBulk(["a", "b", "c", "d"], { actor: "U1", delayMs: 0 });
    expect(vi.mocked(notifyQualifiedLead).mock.calls).toEqual([["a", { force: false, sourcePath: "legacy_meta_bulk", manual: true, actor: expect.any(String) }], ["b", { force: false, sourcePath: "legacy_meta_bulk", manual: true, actor: expect.any(String) }], ["c", { force: false, sourcePath: "legacy_meta_bulk", manual: true, actor: expect.any(String) }], ["d", { force: false, sourcePath: "legacy_meta_bulk", manual: true, actor: expect.any(String) }]]);
    expect(r.results).toEqual([
      { leadId: "a", status: "sent" },
      { leadId: "b", status: "skipped", reason: "Already notified; pass force=true to re-send" },
      { leadId: "c", status: "failed", reason: "email: smtp down" },
      { leadId: "d", status: "failed", reason: "boom" },
    ]);
    expect(r.counts).toEqual({ sent: 1, skipped: 1, failed: 2 });
  });
  it("writes one audit row with the actor and counts", async () => {
    await notifyLeadsBulk(["a"], { actor: "U1", delayMs: 0 });
    expect(h.audits).toEqual([expect.objectContaining({ actor_user_id: "U1", action_type: "meta_notify_bulk", module_key: "meta_campaign", metadata: { leads: 1, counts: { sent: 1, skipped: 0, failed: 0 } } })]);
  });
});

describe("POST /api/meta/leads/notify-all", () => {
  it("rejects an empty list and more than 200 ids (400)", async () => {
    const a = await app();
    expect((await request(a).post("/api/meta/leads/notify-all").send({ leadIds: [] })).status).toBe(400);
    expect((await request(a).post("/api/meta/leads/notify-all").send({ leadIds: Array.from({ length: 201 }, (_, i) => `noida-${i}`) })).status).toBe(400);
    expect((await request(a).post("/api/meta/leads/notify-all").send({ leadIds: "noida-1" })).status).toBe(400);
  });
  it("ids outside the caller's branch or unknown get their own result (403 / 404) and are never sent; the rest are sent", async () => {
    const { notifyQualifiedLead } = await import("../lead-outreach.service.js");
    const a = await app();
    const r = await request(a).post("/api/meta/leads/notify-all").send({ leadIds: ["noida-1", "pune-1", "ghost-1"] });
    expect(r.status).toBe(200);
    expect(vi.mocked(notifyQualifiedLead).mock.calls.map((c) => c[0])).toEqual(["noida-1"]);
    expect(r.body.data.results).toEqual([
      { leadId: "noida-1", status: "sent" },
      { leadId: "pune-1", status: "failed", reason: "Not in your branch (403)" },
      { leadId: "ghost-1", status: "failed", reason: "Lead not found (404)" },
    ]);
    expect(r.body.data.counts).toEqual({ sent: 1, skipped: 0, failed: 2 });
  });
  it("status re-read after a lost response: which in-scope leads are now marked notified (out-of-scope ids are not answered)", async () => {
    dbExecute.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (/FROM employees e\s+JOIN branch_master/.test(sql)) return [[{ branch_name: "Noida" }], []];
      if (/FROM meta_lead_raw ml\s+JOIN job_requisition jr/.test(sql)) return [String(params[0]).startsWith("noida") ? [{ 1: 1 }] : [], []];
      if (/SELECT id FROM meta_lead_raw WHERE id IN/.test(sql)) return [(params as string[]).filter((x) => !x.startsWith("ghost")).map((id) => ({ id })), []];
      if (/notification_sent_at IS NOT NULL AS notified FROM meta_lead_raw/.test(sql)) return [(params as string[]).map((id) => ({ id, notified: id === "noida-1" ? 1 : 0 })), []];
      return [[], []];
    });
    const a = await app();
    const r = await request(a).post("/api/meta/leads/notify-all/status").send({ leadIds: ["noida-1", "noida-2", "pune-1"] });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ results: [{ leadId: "noida-1", notified: true }, { leadId: "noida-2", notified: false }] });
    expect((await request(a).post("/api/meta/leads/notify-all/status").send({ leadIds: [] })).status).toBe(400);
  });
  it("force in the body is ignored; duplicates are sent once; per-lead results come back", async () => {
    const { notifyQualifiedLead } = await import("../lead-outreach.service.js");
    const a = await app();
    const r = await request(a).post("/api/meta/leads/notify-all").send({ leadIds: ["noida-1", "noida-1", "noida-2"], force: true });
    expect(r.status).toBe(200);
    expect(r.body.data.counts).toEqual({ sent: 2, skipped: 0, failed: 0 });
    expect(vi.mocked(notifyQualifiedLead).mock.calls.map((c) => c[1])).toEqual([{ force: false, sourcePath: "legacy_meta_bulk", manual: true, actor: expect.any(String) }, { force: false, sourcePath: "legacy_meta_bulk", manual: true, actor: expect.any(String) }]);
  });
});
