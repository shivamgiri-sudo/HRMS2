import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Pin of the Meta voice-bot callbacks (status, recorded outcome) taken before the response record was added. */
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
  recordVoiceCallback: vi.fn(async () => true), recordWalkInConfirmation: vi.fn(),
}));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog: vi.fn() }));
vi.mock("../../../shared/requestContext.js", () => ({ memoizeForRequest: (_k: string, fn: () => unknown) => fn() }));
vi.mock("../../../shared/demoAuth.js", () => ({ demoRoleForUserId: () => null }));


async function app() {
  const { metaCampaignRouter } = await import("../meta-campaign.routes.js");
  const a = express();
  a.use(express.json());
  a.use("/api/meta", metaCampaignRouter);
  return a;
}
const flush = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => { vi.clearAllMocks(); dbExecute.mockImplementation(async () => [[], []]); process.env.VOICEBOT_CALLBACK_TOKEN = "vb-tok"; delete process.env.VAPI_CALLBACK_SECRET; delete process.env.VAPI_API_KEY; });

describe("Meta voice callbacks pin", () => {
  it("/voice-callback", async () => {
    const { recordVoiceCallback } = await import("../lead-outreach.service.js");
    const a = await app();
    const r = await request(a).post("/api/meta/voice-callback").set("x-voicebot-token", "vb-tok").send({ reference_id: "ML1", status: "completed", outcome: "not_interested" });
    await flush();
    expect({ status: r.status, body: r.body, calls: (recordVoiceCallback as unknown as { mock: { calls: unknown[] } }).mock.calls }).toMatchSnapshot();
  });
  it("/vapi-callback", async () => {
    const { recordVoiceCallback } = await import("../lead-outreach.service.js");
    const a = await app();
    const r = await request(a).post("/api/meta/vapi-callback").send({ call: { id: "vapi-1", endedReason: "customer-ended-call", summary: "Candidate is not interested", metadata: { referenceId: "ML1" } } });
    await flush();
    expect({ status: r.status, body: r.body, calls: (recordVoiceCallback as unknown as { mock: { calls: unknown[] } }).mock.calls }).toMatchSnapshot();
  });
  it("a matched callback also writes a response record (reads the lead's phone), the reply is unchanged", async () => {
    const a = await app();
    await request(a).post("/api/meta/voice-callback").set("x-voicebot-token", "vb-tok").send({ reference_id: "ML1", status: "no_answer" });
    await request(a).post("/api/meta/vapi-callback").send({ call: { id: "vapi-2", endedReason: "no-answer", metadata: { referenceId: "ML1" } } });
    await flush();
    const reads = dbExecute.mock.calls.filter((c) => String(c[0]).includes("SELECT parsed_phone FROM meta_lead_raw WHERE id = ?"));
    expect(reads.map((c) => (c[1] as unknown[])[0])).toEqual(["ML1", "ML1"]);
  });
  it("bad token and missing reference", async () => {
    const a = await app();
    expect((await request(a).post("/api/meta/voice-callback").set("x-voicebot-token", "nope").send({ reference_id: "ML1" })).status).toBe(403);
    expect((await request(a).post("/api/meta/voice-callback").set("x-voicebot-token", "vb-tok").send({})).status).toBe(400);
  });
});
