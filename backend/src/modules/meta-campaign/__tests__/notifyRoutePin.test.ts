import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Pin of the single Notify route (notifyQualifiedLead arguments, reply, scope refusal) taken before Notify All moved to the server. */
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


async function app() {
  const { metaCampaignRouter } = await import("../meta-campaign.routes.js");
  const a = express();
  a.use(express.json());
  a.use("/api/meta", metaCampaignRouter);
  return a;
}
beforeEach(() => {
  vi.clearAllMocks(); caller.roles = ["hr"];
  dbExecute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/FROM employees e\s+JOIN branch_master/.test(sql)) return [[{ branch_name: "Noida" }], []];
    if (/FROM meta_lead_raw ml\s+JOIN job_requisition jr/.test(sql)) return [params[0] === "lead-noida" ? [{ 1: 1 }] : [], []];
    return [[], []];
  });
});

describe("single Notify route pin", () => {
  it("in scope, with and without force", async () => {
    const { notifyQualifiedLead } = await import("../lead-outreach.service.js");
    const a = await app();
    const r1 = await request(a).post("/api/meta/leads/lead-noida/notify").send({});
    const r2 = await request(a).post("/api/meta/leads/lead-noida/notify").send({ force: true });
    const r3 = await request(a).post("/api/meta/leads/lead-pune/notify").send({});
    expect({ statuses: [r1.status, r2.status, r3.status], bodies: [r1.body, r2.body, r3.body], calls: vi.mocked(notifyQualifiedLead).mock.calls }).toMatchSnapshot();
  });
});
