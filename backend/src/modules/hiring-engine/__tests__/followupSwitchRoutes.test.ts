import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const optOut = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../he-pinbot-quality.service.js", () => ({ getPinbotQuality: vi.fn(async () => "GREEN"), resetPinbotQualityCache: vi.fn() }));
vi.mock("../followup-optout.service.js", async (orig) => ({ ...(await orig<object>()), recordPersonOptOut: optOut }));
const audit = vi.hoisted(() => ({ get: vi.fn(async () => ({ id: "x", mobile: "98xxxxxx10" })), retry: vi.fn(async () => "ok") }));
vi.mock("../qualified-followup.attention.js", async (orig) => ({ ...(await orig<object>()), getFollowupAudit: audit.get, retryFollowupStep: audit.retry }));

let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); } };
});

import { heRouter } from "../he.routes.js";

const ID = "0f1e2d3c-aaaa-bbbb-cccc-0000000abcde";
const REQ = "11111111-2222-3333-4444-abcdefabcdef";
function appFor(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use("/api/he", heRouter);
  return app;
}
const sqls = (re: RegExp) => execute.mock.calls.filter(([sql]) => re.test(String(sql)));

let params: Array<{ param_key: string; value: number }>;
let requisition: Record<string, unknown> | null;
let rowBranch: string | null;
beforeEach(() => {
  execute.mockReset(); optOut.mockReset(); optOut.mockResolvedValue({ leadId: null, journeysStopped: 2 });
  vi.unstubAllEnvs(); vi.stubEnv("QUAL_FOLLOWUP_MODE", "live");
  params = [];
  requisition = { approval_status: "approved", active_status: 1, closed_at: null, requested_headcount: 5, fulfilled_headcount: 1, requisition_validity: null };
  rowBranch = "NOIDA-2";
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("FROM he_model_param WHERE param_key LIKE 'policy.followup.%'")) return [params];
    if (q.includes("wa_inbound_verified")) return [params.filter((p) => p.param_key === "policy.followup.wa_inbound_verified")];
    if (q.includes("FROM followup_canary")) return [[{ source_type: "meta_live", requisition_id: REQ, requisition_code: "REQ-9", branch_name: "NOIDA-2 Sector 63" }, { source_type: "he", requisition_id: "r-ahm", requisition_code: "REQ-A", branch_name: "AHMEDABAD" }]];
    if (q.includes("FROM job_requisition WHERE id = ?")) return [requisition ? [requisition] : []];
    if (q.includes("FROM employees e")) return [[{ branch_name: "NOIDA-2" }]];
    if (q.includes("FROM qualified_followup qf JOIN job_requisition")) return [rowBranch === null ? [] : [{ branch_name: rowBranch }]];
    if (q.includes("SELECT mobile10 FROM qualified_followup")) return [[{ mobile10: "9876543210" }]];
    if (q.includes("GROUP BY source_type, journey_state")) return [[{ source_type: "meta_live", journey_state: "enrolled", n: 3 }]];
    if (q.includes("direction = 'in' AND channel = 'whatsapp'")) return [[{ last_at: null, n7: 0 }]];
    if (q.startsWith("UPDATE") || q.startsWith("INSERT") || q.startsWith("DELETE")) return [{ affectedRows: 1 }];
    if (q.includes("COUNT(*)")) return [[{ n: 0 }]];
    return [[]];
  });
});

describe("GET /qualified-followup/switches", () => {
  it("returns ceiling, kill switch, per-source mode and effective mode, canary list, caps, budget, inbound, counts (CEO may view)", async () => {
    params = [{ param_key: "policy.followup.meta_live", value: 4 }, { param_key: "policy.followup.he", value: 1 }];
    const res = await request(appFor("ceo")).get("/api/he/qualified-followup/switches");
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.ceiling).toBe("live");
    expect(d.killSwitch).toBe(false);
    // live on the screen, but inbound is not verified: it runs as dry_run
    expect(d.sources.meta_live).toEqual({ mode: "live", effective: "dry_run" });
    expect(d.sources.meta_old).toEqual({ mode: "off", effective: "off" });
    expect(d.sources.he).toEqual({ mode: "dry_run", effective: "dry_run" });
    expect(d.canary).toEqual([{ sourceType: "meta_live", requisitionId: REQ, code: "REQ-9", branch: "NOIDA-2 Sector 63" }, { sourceType: "he", requisitionId: "r-ahm", code: "REQ-A", branch: "AHMEDABAD" }]);
    expect(d.caps).toEqual(expect.arrayContaining([{ prefix: "NOIDA-2", dailyMax: 50, usedToday: 0 }, { prefix: "AHMEDABAD", dailyMax: 30, usedToday: 0 }]));
    expect(d.budget).toEqual({ max: 500, quality: "GREEN", used: 0 });
    expect(d.inbound).toMatchObject({ verified: false, acknowledged: false, inbound7d: 0 });
    expect(d.counts.meta_live).toEqual({ enrolled: 3 });
    expect(JSON.stringify(res.body)).not.toMatch(/\d{10}/);
  });
  it("a branch-scoped viewer (hr, admin at NOIDA-2) sees only their branch's canary rows, caps and journey counts", async () => {
    for (const role of ["hr", "admin"]) {
      execute.mockClear();
      const d = (await request(appFor(role)).get("/api/he/qualified-followup/switches")).body.data;
      expect(d.canary.map((c: { code: string }) => c.code)).toEqual([]); // "NOIDA-2 Sector 63" is not the caller's branch "NOIDA-2"
      expect(d.caps.map((c: { prefix: string }) => c.prefix)).toEqual(["NOIDA-2"]);
      const cnt = sqls(/GROUP BY source_type, journey_state/);
      expect(cnt[0][0]).toContain("WHERE branch_name = ?");
      expect(cnt[0][1]).toEqual(["NOIDA-2"]);
    }
  });
  it("a role outside the view roles gets 403", async () => {
    expect((await request(appFor("employee")).get("/api/he/qualified-followup/switches")).status).toBe(403);
  });
});

describe("PUT /qualified-followup/switches/:source", () => {
  it("validates source and mode", async () => {
    expect((await request(appFor("super_admin")).put("/api/he/qualified-followup/switches/tiktok").send({ mode: "live" })).status).toBe(400);
    expect((await request(appFor("super_admin")).put("/api/he/qualified-followup/switches/he").send({ mode: "turbo" })).status).toBe(400);
  });
  it("hr and ceo cannot change a switch", async () => {
    expect((await request(appFor("hr")).put("/api/he/qualified-followup/switches/he").send({ mode: "dry_run" })).status).toBe(403);
    expect((await request(appFor("ceo")).put("/api/he/qualified-followup/switches/he").send({ mode: "dry_run" })).status).toBe(403);
    expect(sqls(/INSERT INTO he_model_param/)).toHaveLength(0);
  });
  it("writes the code and an audit row with the user id", async () => {
    const res = await request(appFor("super_admin")).put("/api/he/qualified-followup/switches/meta_old").send({ mode: "dry_run" });
    expect(res.status).toBe(200);
    expect(sqls(/INSERT INTO he_model_param/).map(([, p]) => p)).toEqual([["policy.followup.meta_old", 1]]);
    const audit = sqls(/INSERT INTO audit_action_log/);
    expect(audit).toHaveLength(1);
    expect(audit[0][1]).toEqual(expect.arrayContaining(["u-super_admin", "he_followup_switch"]));
  });
  it("live / canary refused with 409 while Pinbot inbound is not verified, unless the owner acknowledges", async () => {
    const refused = await request(appFor("super_admin")).put("/api/he/qualified-followup/switches/meta_live").send({ mode: "live" });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/not verified/);
    expect(sqls(/INSERT INTO he_model_param/)).toHaveLength(0);
    const ok = await request(appFor("super_admin")).put("/api/he/qualified-followup/switches/meta_live").send({ mode: "canary", acknowledgeInboundUnverified: true });
    expect(ok.status).toBe(200);
    expect(sqls(/INSERT INTO he_model_param/).map(([, p]) => p)).toEqual([["policy.followup.wa_inbound_ack", 1], ["policy.followup.meta_live", 3]]);
  });
  it("verified inbound: live is accepted without acknowledgement", async () => {
    params = [{ param_key: "policy.followup.wa_inbound_verified", value: 1 }];
    expect((await request(appFor("super_admin")).put("/api/he/qualified-followup/switches/he").send({ mode: "live" })).status).toBe(200);
  });
  it("admin is branch-scoped: every write is 403 for admin (org-wide users only), nothing written", async () => {
    params = [{ param_key: "policy.followup.wa_inbound_verified", value: 1 }];
    const a = appFor("admin");
    expect((await request(a).put("/api/he/qualified-followup/switches/he").send({ mode: "live" })).status).toBe(403);
    expect((await request(a).post("/api/he/qualified-followup/canary").send({ sourceType: "he", requisitionId: REQ })).status).toBe(403);
    expect((await request(a).delete(`/api/he/qualified-followup/canary/he/${REQ}`)).status).toBe(403);
    expect((await request(a).put("/api/he/qualified-followup/caps/NOIDA-2").send({ dailyMax: 5 })).status).toBe(403);
    expect((await request(a).put("/api/he/qualified-followup/kill").send({ paused: true })).status).toBe(403);
    expect((await request(a).put("/api/he/qualified-followup/inbound-verified").send({ verified: true })).status).toBe(403);
    expect(sqls(/INSERT INTO he_model_param|INSERT INTO followup_canary|DELETE FROM followup_canary/)).toHaveLength(0);
  });
});

describe("canary, caps, kill switch, inbound flag", () => {
  it("an unknown requisition cannot be a canary (404)", async () => {
    requisition = null;
    expect((await request(appFor("super_admin")).post("/api/he/qualified-followup/canary").send({ sourceType: "he", requisitionId: REQ })).status).toBe(404);
    expect(sqls(/INSERT INTO followup_canary/)).toHaveLength(0);
  });
  it("adds an open requisition to the canary list; a closed one is refused", async () => {
    const ok = await request(appFor("super_admin")).post("/api/he/qualified-followup/canary").send({ sourceType: "he", requisitionId: REQ });
    expect(ok.status).toBe(200);
    expect(sqls(/INSERT INTO followup_canary/)[0][1]).toEqual(["he", REQ, "u-super_admin"]);
    requisition = { ...requisition, active_status: 0, closed_at: "2026-10-01 10:00:00" };
    const closed = await request(appFor("super_admin")).post("/api/he/qualified-followup/canary").send({ sourceType: "he", requisitionId: REQ });
    expect(closed.status).toBe(409);
    expect(sqls(/INSERT INTO followup_canary/)).toHaveLength(1);
    expect((await request(appFor("super_admin")).post("/api/he/qualified-followup/canary").send({ sourceType: "x", requisitionId: REQ })).status).toBe(400);
  });
  it("removes a canary requisition", async () => {
    const res = await request(appFor("super_admin")).delete(`/api/he/qualified-followup/canary/he/${REQ}`);
    expect(res.status).toBe(200);
    expect(sqls(/DELETE FROM followup_canary/)[0][1]).toEqual(["he", REQ]);
  });
  it("cap 0..1000 per branch prefix", async () => {
    expect((await request(appFor("super_admin")).put("/api/he/qualified-followup/caps/NOIDA-2").send({ dailyMax: 1001 })).status).toBe(400);
    expect((await request(appFor("super_admin")).put("/api/he/qualified-followup/caps/NOIDA-2").send({ dailyMax: -1 })).status).toBe(400);
    expect((await request(appFor("super_admin")).put("/api/he/qualified-followup/caps/no%20ida';").send({ dailyMax: 5 })).status).toBe(400);
    expect((await request(appFor("super_admin")).put("/api/he/qualified-followup/caps/NOIDA_2").send({ dailyMax: 5 })).status).toBe(400); // '_' is a LIKE wildcard
    expect((await request(appFor("super_admin")).put("/api/he/qualified-followup/caps/noida-2").send({ dailyMax: 20 })).status).toBe(200);
    expect(sqls(/INSERT INTO he_model_param/).map(([, p]) => p)).toEqual([["policy.followup.canary_cap.NOIDA-2", 20]]);
  });
  it("kill switch and inbound-verified flag", async () => {
    expect((await request(appFor("super_admin")).put("/api/he/qualified-followup/kill").send({ paused: "yes" })).status).toBe(400);
    expect((await request(appFor("super_admin")).put("/api/he/qualified-followup/kill").send({ paused: true })).status).toBe(200);
    expect((await request(appFor("super_admin")).put("/api/he/qualified-followup/inbound-verified").send({ verified: true })).status).toBe(200);
    expect(sqls(/INSERT INTO he_model_param/).map(([, p]) => p)).toEqual([["policy.followup.paused", 1], ["policy.followup.wa_inbound_verified", 1]]);
    expect(sqls(/INSERT INTO audit_action_log/)).toHaveLength(2);
    expect((await request(appFor("hr")).put("/api/he/qualified-followup/kill").send({ paused: false })).status).toBe(403);
  });
});

describe("branch scope on the audit view and retry (final integration)", () => {
  it("GET /qualified-followup/:id: 404 outside the caller's branch, the audit is not read; inside it is shown", async () => {
    rowBranch = "AHMEDABAD";
    expect((await request(appFor("hr")).get(`/api/he/qualified-followup/${ID}`)).status).toBe(404);
    expect(audit.get).not.toHaveBeenCalled();
    rowBranch = "NOIDA-2";
    const ok = await request(appFor("hr")).get(`/api/he/qualified-followup/${ID}`);
    expect(ok.status).toBe(200);
    expect(audit.get).toHaveBeenCalledTimes(1);
    // the CEO (org-wide) reads every branch without the lookup
    rowBranch = "AHMEDABAD";
    expect((await request(appFor("ceo")).get(`/api/he/qualified-followup/${ID}`)).status).toBe(200);
  });
  it("POST /qualified-followup/:id/retry: a branch-scoped admin gets 404 outside the branch; super_admin retries anywhere", async () => {
    rowBranch = "AHMEDABAD";
    expect((await request(appFor("admin")).post(`/api/he/qualified-followup/${ID}/retry`).send({ channel: "email" })).status).toBe(404);
    expect(audit.retry).not.toHaveBeenCalled();
    rowBranch = "NOIDA-2";
    expect((await request(appFor("admin")).post(`/api/he/qualified-followup/${ID}/retry`).send({ channel: "email" })).status).toBe(200);
    rowBranch = "AHMEDABAD";
    expect((await request(appFor("super_admin")).post(`/api/he/qualified-followup/${ID}/retry`).send({ channel: "email" })).status).toBe(200);
    expect(audit.retry).toHaveBeenCalledTimes(2);
  });
});

describe("branch scope on the row actions", () => {
  it("HR opt-out: a branch user acts only on rows of their branch (404 otherwise)", async () => {
    rowBranch = "AHMEDABAD";
    expect((await request(appFor("hr")).post(`/api/he/qualified-followup/${ID}/opt-out`)).status).toBe(404);
    expect(optOut).not.toHaveBeenCalled();
    rowBranch = "NOIDA-2";
    const ok = await request(appFor("hr")).post(`/api/he/qualified-followup/${ID}/opt-out`);
    expect(ok.status).toBe(200);
    expect(optOut).toHaveBeenCalledTimes(1);
  });
  it("mark-called: same rule; org-wide roles skip the lookup", async () => {
    rowBranch = "AHMEDABAD";
    expect((await request(appFor("recruitment_hr")).post(`/api/he/qualified-followup/${ID}/mark-called`)).status).toBe(404);
    expect(sqls(/^UPDATE qualified_followup/)).toHaveLength(0);
    execute.mockClear();
    expect((await request(appFor("super_admin")).post(`/api/he/qualified-followup/${ID}/mark-called`)).status).toBe(200);
    expect(sqls(/FROM qualified_followup qf JOIN job_requisition/)).toHaveLength(0);
  });
});
