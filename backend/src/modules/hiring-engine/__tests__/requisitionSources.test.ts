import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: logError } }));

let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); } };
});
vi.mock("../he-inbox.service.js", () => ({ listInbox: vi.fn(), getInboxThread: vi.fn(), replyToCandidate: vi.fn() }));

import { clearRequisitionSourcesCache, computeShares, getRequisitionSources } from "../he-requisition-sources.service.js";
import { heRouter } from "../he.routes.js";

const RID = "0f1e2d3c-aaaa-bbbb-cccc-0000000abcde";
const C9 = "c9c9c9c9-aaaa-bbbb-cccc-0000000abcde";
const D7 = "d7d7d7d7-aaaa-bbbb-cccc-0000000abcde";
const ALL = { all: true, branchName: null } as never;
const PUNE = { all: false, branchName: "Pune" } as never;
const DELHI = { all: false, branchName: "Delhi" } as never;
const zeros = { qualified: 0, emailed: 0, whatsapped: 0, replied: 0, called: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0 };

let stages: Array<Record<string, unknown>>;
let matchLeads: Array<Record<string, unknown>>;
let streams: Array<Record<string, unknown>>;
let campaigns: Array<Record<string, unknown>>;
let campaignLeads: Array<Record<string, unknown>>;
let failOnce: string | null;
let hrBranch: string;

const sqlSeen = (): string[] => execute.mock.calls.map((c) => String(c[0]));
const heavy = (): number => sqlSeen().filter((q) => /FROM qualified_followup qf/.test(q)).length;

beforeEach(() => {
  vi.clearAllMocks();
  clearRequisitionSourcesCache();
  hrBranch = "Pune";
  failOnce = null;
  streams = [];
  campaigns = [{ id: C9, campaign_name: "Pune walk-in ad" }];
  campaignLeads = [{ campaign_id: C9, leads: 60 }];
  stages = [{ source_type: "meta_live", origin_id: C9, origin_label: "old label", ...zeros, qualified: 20, emailed: 18, whatsapped: 17, replied: 6, called: 10, confirmed: 5, arrived: 3, selected: 3, joined: 3 }];
  matchLeads = [
    { source_type: "meta_old", origin_id: D7, origin_label: "Launch 7", leads: 30 },
    { source_type: "he", origin_id: "pool", origin_label: "Pool: ATS history", leads: 10 },
  ];
  execute.mockImplementation(async (sql: string, params: unknown[]) => {
    const q = String(sql);
    const section = q.includes("FROM qualified_followup qf") ? "stages" : q.includes("FROM he_drive d") ? "driveLeads" : q.includes("FROM meta_lead_raw") ? "campaignLeads" : null;
    if (section && failOnce === section) { failOnce = null; throw new Error("SELECT boom WHERE mobile = 9876543210\n  at x.ts:1"); }
    if (q.includes("FROM job_requisition WHERE id")) {
      if (failOnce === "header") { failOnce = null; throw new Error("SELECT header boom"); }
      return [params[0] === RID ? [{ requisition_code: "REQ-7", branch_name: "Pune", designation_name: "Agent" }] : []];
    }
    if (q.includes("FROM requisition_stream WHERE")) return [streams];
    if (q.includes("FROM qualified_followup qf")) return [stages];
    if (q.includes("FROM he_drive d")) return [matchLeads];
    if (q.includes("FROM meta_campaign")) return [campaigns];
    if (q.includes("FROM meta_lead_raw")) return [campaignLeads];
    if (q.includes("FROM employees e")) return [[{ branch_name: hrBranch }]];
    return [[]];
  });
});
afterEach(() => { vi.useRealTimers(); });

const raw = (leads: number, joined: number) => ({ sourceType: "he" as const, originId: "o", originLabel: "o", streamId: null, streamStatus: null, ...zeros, leads, joined });

describe("computeShares", () => {
  it("returns unrounded fractions of leads and joined, and the lead to join rate", () => {
    const rows = computeShares([raw(60, 3), raw(30, 1), raw(10, 0)]);
    expect(rows.map((r) => r.shareOfLeads)).toEqual([0.6, 0.3, 0.1]);
    expect(rows.reduce((a, r) => a + r.shareOfJoined, 0)).toBeCloseTo(1);
    expect(rows[0].shareOfJoined).toBe(0.75);
    expect(rows[0].leadToJoinRate).toBe(0.05);
  });

  it("gives 0 (never NaN) when every denominator is 0", () => {
    const rows = computeShares([raw(0, 0), raw(0, 0)]);
    for (const r of rows) expect([r.shareOfLeads, r.shareOfJoined, r.leadToJoinRate]).toEqual([0, 0, 0]);
    expect(computeShares([])).toEqual([]);
  });
});

describe("getRequisitionSources", () => {
  it("lists the three source types with leads that add up to the totals", async () => {
    const out = (await getRequisitionSources(RID, ALL))!;
    expect(out).toMatchObject({ requisitionId: RID, code: "REQ-7", branch: "Pune", role: "Agent", partial: false, failedSections: [] });
    expect(out.rows.map((r) => [r.sourceType, r.originId, r.leads])).toEqual([["meta_live", C9, 60], ["meta_old", D7, 30], ["he", "pool", 10]]);
    expect(out.rows[0].originLabel).toBe("Pune walk-in ad");
    expect(out.rows[1].originLabel).toBe("Launch 7");
    expect(out.totals.leads).toBe(100);
    expect(out.rows.reduce((a, r) => a + r.leads, 0)).toBe(out.totals.leads);
    expect(out.rows.map((r) => r.shareOfLeads)).toEqual([0.6, 0.3, 0.1]);
    expect(out.totals).toMatchObject({ qualified: 20, joined: 3, selected: 3, leadToJoinRate: 0.03 });
    for (const r of out.rows) { expect(r.qualified).toBeLessThanOrEqual(r.leads); expect(r.joined).toBeLessThanOrEqual(r.selected); }
  });

  it("lists an open he stream with no data yet as a row of zeros carrying its status", async () => {
    streams = [{ id: "5555aaaa-aaaa-bbbb-cccc-0000000abcde", source_type: "he", origin_id: "pool", origin_label: "Pool: ATS history", status: "open" }];
    matchLeads = [];
    const out = (await getRequisitionSources(RID, ALL))!;
    const he = out.rows.find((r) => r.sourceType === "he")!;
    expect(he).toMatchObject({ originId: "pool", streamId: "5555aaaa-aaaa-bbbb-cccc-0000000abcde", streamStatus: "open", leads: 0, qualified: 0, joined: 0, shareOfLeads: 0, shareOfJoined: 0, leadToJoinRate: 0 });
  });

  it("merges a stream and its follow-up rows into one origin and never lets leads fall below qualified", async () => {
    streams = [{ id: "5555aaaa-aaaa-bbbb-cccc-0000000abcde", source_type: "meta_live", origin_id: C9, origin_label: "stream label", status: "paused" }];
    campaignLeads = [{ campaign_id: C9, leads: 12 }];
    const out = (await getRequisitionSources(RID, ALL))!;
    const live = out.rows.filter((r) => r.sourceType === "meta_live");
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ leads: 20, qualified: 20, streamStatus: "paused" });
  });

  it("shows a follow-up origin that has no stream or campaign, labelled from its own row", async () => {
    campaigns = [];
    campaignLeads = [];
    const out = (await getRequisitionSources(RID, ALL))!;
    expect(out.rows[0]).toMatchObject({ sourceType: "meta_live", originLabel: "old label", leads: 20 });
    expect(sqlSeen().some((q) => q.includes("FROM meta_lead_raw"))).toBe(false);
  });

  it("two label variants of one origin add up (never overwrite) and the shares stay consistent; the SQL groups by origin only", async () => {
    const variant = (label: string, n: number) => ({ source_type: "he", origin_id: "pool", origin_label: label, ...zeros, qualified: n, emailed: n, replied: n, joined: n - 1, arrived: 1, confirmed: 2, selected: 1, called: 0, whatsapped: 0 });
    stages = [variant("Pool: ATS history", 10), variant("HR pool run", 6), { ...stages[0], joined: 3 }];
    streams = [{ id: "5a5a5a5a-aaaa-bbbb-cccc-0000000abcde", source_type: "he", origin_id: "pool", origin_label: "HR pool run", status: "open" }];
    const d = (await getRequisitionSources(RID, ALL))!;
    const he = d.rows.find((r) => r.sourceType === "he" && r.originId === "pool")!;
    expect(he).toMatchObject({ qualified: 16, emailed: 16, replied: 16, joined: 14 });
    expect(he.originLabel).toBe("Pool: ATS history"); // the match-lead pass labels the pool origin last (rank 3)
    expect(d.rows.reduce((a, r) => a + r.shareOfJoined, 0)).toBeCloseTo(1);
    expect(d.totals.qualified).toBe(36);
    const stagesSql = sqlSeen().find((q) => /FROM qualified_followup qf/.test(q))!;
    expect(stagesSql).toMatch(/GROUP BY f\.source_type, f\.origin_id`?\s*$/);
    expect(stagesSql).not.toMatch(/GROUP BY[^`]*origin_label/);
  });

  it("every share is a finite fraction when nothing exists", async () => {
    stages = []; matchLeads = []; campaigns = []; campaignLeads = [];
    const out = (await getRequisitionSources(RID, ALL))!;
    expect(out.rows).toEqual([]);
    expect(out.totals).toMatchObject({ leads: 0, joined: 0, leadToJoinRate: 0 });
  });

  it("keys every statement by requisition or campaign, never scans he_lead, and collates string joins", async () => {
    campaigns = [{ id: C9, campaign_name: "x" }];
    await getRequisitionSources(RID, ALL);
    const all = sqlSeen();
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const q of all) expect(q).toMatch(/requisition_id = \?|campaign_id IN|WHERE id = \?/);
    for (const q of all) for (const m of q.matchAll(/\bhe_lead\b/g)) expect(q.slice(0, m.index).trimEnd()).toMatch(/JOIN$/);
    for (const q of all) expect(q).not.toMatch(/FROM\s+he_lead\b/);
    for (const q of all) for (const m of q.matchAll(/JOIN\s+(?:meta_lead_raw|meta_campaign|job_requisition)\b[^()]*?\bON\b([^\n]*)/g)) expect(m[1]).toContain("COLLATE utf8mb4_unicode_ci");
  });

  it("collates the joins to ats_candidate and meta_lead_messages (non-HE tables can carry another collation)", async () => {
    await getRequisitionSources(RID, ALL);
    const stages = sqlSeen().find((q) => q.includes("FROM qualified_followup qf"))!;
    expect(stages).toMatch(/ac\.id = COALESCE\(qf\.ats_candidate_id, hl\.ats_candidate_id\) COLLATE utf8mb4_unicode_ci/);
    expect(stages).toMatch(/mm\.lead_id = qf\.meta_lead_id COLLATE utf8mb4_unicode_ci/);
  });

  it("serves a second call within 60 seconds from the cache, and re-reads after it expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T10:00:00Z"));
    await getRequisitionSources(RID, ALL);
    await getRequisitionSources(RID, ALL);
    expect(heavy()).toBe(1);
    vi.setSystemTime(new Date("2026-10-07T10:01:01Z"));
    await getRequisitionSources(RID, ALL);
    expect(heavy()).toBe(2);
  });

  it("answers null outside the caller's scope, before and after the cache is warm, and never leaks another scope's data", async () => {
    expect(await getRequisitionSources(RID, DELHI)).toBeNull();
    expect(heavy()).toBe(0);
    expect(await getRequisitionSources(RID, { all: false, branchName: null } as never)).toBeNull();
    expect(await getRequisitionSources(RID, ALL)).not.toBeNull();
    expect(await getRequisitionSources(RID, DELHI)).toBeNull();
    expect(await getRequisitionSources(RID, PUNE)).not.toBeNull();
    expect(heavy()).toBe(2);
    expect(await getRequisitionSources("00000000-aaaa-bbbb-cccc-0000000abcde", ALL)).toBeNull();
  });

  it("flags a failing section instead of throwing, never caches it, and recovers on the next call", async () => {
    failOnce = "stages";
    const bad = (await getRequisitionSources(RID, ALL))!;
    expect(bad.partial).toBe(true);
    expect(bad.failedSections).toEqual(["stages"]);
    expect(bad.rows.map((r) => r.sourceType)).toEqual(["meta_live", "meta_old", "he"]);
    expect(bad.rows[0]).toMatchObject({ qualified: 0, leads: 60 });
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/\d{10}|x\.ts|SELECT/);
    const good = (await getRequisitionSources(RID, ALL))!;
    expect(good).toMatchObject({ partial: false, failedSections: [] });
    expect(good.rows[0].qualified).toBe(20);
    failOnce = "campaignLeads";
    clearRequisitionSourcesCache();
    const bad2 = (await getRequisitionSources(RID, ALL))!;
    expect([bad2.partial, bad2.failedSections, bad2.rows[0].leads]).toEqual([true, ["campaignLeads"], 20]);
  });
});

describe("GET /api/he/requisition-sources", () => {
  function appFor(role: string) {
    actor = { id: `u-${role}`, role, roles: [role] };
    const app = express();
    app.use(express.json());
    app.use("/api/he", heRouter);
    return app;
  }

  it("200 for ceo with counts only", async () => {
    const r = await request(appFor("ceo")).get(`/api/he/requisition-sources?requisitionId=${RID}`);
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data.rows).toHaveLength(3);
    expect(JSON.stringify(r.body)).not.toMatch(/\d{10}/);
  });

  it("400 for a missing or malformed requisitionId", async () => {
    expect((await request(appFor("ceo")).get("/api/he/requisition-sources")).status).toBe(400);
    expect((await request(appFor("ceo")).get("/api/he/requisition-sources?requisitionId=zzz")).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it("404 for an unknown requisition and for one outside the caller's branch", async () => {
    expect((await request(appFor("ceo")).get("/api/he/requisition-sources?requisitionId=00000000-aaaa-bbbb-cccc-0000000abcde")).status).toBe(404);
    hrBranch = "Delhi";
    expect((await request(appFor("hr")).get(`/api/he/requisition-sources?requisitionId=${RID}`)).status).toBe(404);
    hrBranch = "Pune";
    expect((await request(appFor("hr")).get(`/api/he/requisition-sources?requisitionId=${RID}`)).status).toBe(200);
  });

  it("403 for a role outside the view roles", async () => {
    expect((await request(appFor("employee")).get(`/api/he/requisition-sources?requisitionId=${RID}`)).status).toBe(403);
  });

  it("500 carries a generic message, never SQL", async () => {
    failOnce = "header";
    const r = await request(appFor("ceo")).get(`/api/he/requisition-sources?requisitionId=${RID}`);
    expect([r.status, r.body.message]).toEqual([500, "Could not load sources"]);
    expect(JSON.stringify(r.body)).not.toMatch(/SELECT/);
  });
});
