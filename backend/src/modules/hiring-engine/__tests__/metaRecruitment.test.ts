import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/he/meta-recruitment counts (he-meta-recruitment.service). The db is a small fake: each statement is answered from the tables below
 * by what it asks for, so the counts do not depend on statement text.
 */
const h = vi.hoisted(() => {
  process.env.HE_META_CACHE_MS = "0";
  return { calls: [] as Array<[string, unknown[]]> };
});

type Cand = { id: string; mobile: string; walk_in_date: string | null; current_stage: string };
const CAMPS = [
  { id: "c1", campaign_name: "Pune Voice", campaign_status: "active", requisition_code: "REQ-1", branch_name: "PUNE" },
  { id: "c2", campaign_name: "Noida Chat", campaign_status: "paused", requisition_code: "REQ-2", branch_name: "NOIDA-2" },
  { id: "c3", campaign_name: "Unlinked", campaign_status: "active", requisition_code: null, branch_name: null },
];
const LEADS = [
  { campaign_id: "c1", ats_candidate_id: "a1", screening_result: "qualified", notification_sent_at: "2026-10-01", parsed_phone: "9800000001" },
  { campaign_id: "c1", ats_candidate_id: null, screening_result: "qualified", notification_sent_at: null, parsed_phone: "+91 98000 00002" },
  { campaign_id: "c1", ats_candidate_id: null, screening_result: "rejected", notification_sent_at: null, parsed_phone: "9800000009" },
  { campaign_id: "c2", ats_candidate_id: null, screening_result: "qualified", notification_sent_at: "2026-10-02", parsed_phone: "p:9800000002" },
  { campaign_id: "c2", ats_candidate_id: "a3", screening_result: "qualified", notification_sent_at: null, parsed_phone: null },
  { campaign_id: "c3", ats_candidate_id: null, screening_result: "qualified", notification_sent_at: null, parsed_phone: "98000-00004" },
];
const CANDS: Cand[] = [
  { id: "a1", mobile: "9800000001", walk_in_date: "2026-10-03", current_stage: "Selected" },
  { id: "a2", mobile: "+91-98000-00002", walk_in_date: null, current_stage: "screening" },
  { id: "a3", mobile: "9800000003", walk_in_date: null, current_stage: "joined" },
  { id: "a4", mobile: "(980) 000 0004", walk_in_date: "2026-10-04", current_stage: "new" },
  { id: "a5", mobile: "9800000077", walk_in_date: "2026-10-05", current_stage: "offered" },
];
const SELECTED_BY_REQ = new Set(["a2"]);
const TOKENS = new Set(["a2"]);
const BRIDGE = [{ candidate_id: "a3", employee_id: "E1", status: "complete", docs: 100, hr_approved_at: "2026-10-06" }, { candidate_id: "a1", employee_id: null, status: "pending", docs: 0, hr_approved_at: null }];
const digits10 = (s: string): string => s.replace(/[^0-9]/g, "").slice(-10);
const candRow = (c: Cand) => ({ id: c.id, mobile: c.mobile, m: digits10(c.mobile), walked: c.walk_in_date ? 1 : 0, current_stage: c.current_stage });
const inIds = (params: unknown[]) => new Set(params.map(String));

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const s = sql.replace(/\s+/g, " ").trim();
      h.calls.push([s, params]);
      if (s.includes("FROM meta_campaign c")) {
        const branch = s.includes("jr.branch_name = ?") ? String(params[0]) : null;
        return [CAMPS.filter((c) => branch === null || c.branch_name === branch)];
      }
      if (s.includes("FROM meta_lead_raw")) return [LEADS];
      if (s.includes("FROM ats_candidate c WHERE c.id IN")) { const ids = inIds(params); return [CANDS.filter((c) => ids.has(c.id)).map(candRow)]; }
      if (s.includes("FROM ats_candidate c")) return [CANDS.filter((c) => c.mobile).map(candRow)];
      if (s.includes("FROM job_requisition_candidate")) { const ids = inIds(params); return [[...SELECTED_BY_REQ].filter((x) => ids.has(x)).map((candidate_id) => ({ candidate_id }))]; }
      if (s.includes("FROM ats_queue_token")) { const ids = inIds(params); return [[...TOKENS].filter((x) => ids.has(x)).map((candidate_id) => ({ candidate_id }))]; }
      if (s.includes("FROM ats_onboarding_bridge")) { const ids = inIds(params); return [BRIDGE.filter((b) => ids.has(b.candidate_id))]; }
      throw new Error(`unexpected statement: ${s.slice(0, 80)}`);
    }),
  },
}));

import { getMetaRecruitment } from "../he-meta-recruitment.service.js";

beforeEach(() => { h.calls.length = 0; });

describe("meta recruitment counts (pinned before the branch scope and the scan change)", () => {
  it("org-wide: every campaign, phone matches in any format, a person in two campaigns counted once in the total", async () => {
    const r = await getMetaRecruitment();
    expect(r).toMatchSnapshot("all");
  });
});

describe("meta recruitment is branch scoped and reads the phone pass from the covering index", () => {
  const zero = { leads: 0, qualified: 0, invited: 0, applied: 0, walkedIn: 0, selected: 0, onboarding: 0, joined: 0 };

  it("a branch user sees only their branch's campaigns, and the total is theirs alone", async () => {
    const all = await getMetaRecruitment({ all: true });
    const r = await getMetaRecruitment({ all: false, branchName: "PUNE" });
    expect(r.campaigns.map((c) => c.campaignId)).toEqual(["c1"]);
    const { campaignId: _i, campaignName: _n, status: _s, requisitionCode: _r, branchName: _b, ...c1 } = all.campaigns[0];
    expect(r.total).toEqual(c1);
    const noida = await getMetaRecruitment({ all: false, branchName: "NOIDA-2" });
    expect(noida.campaigns.map((c) => c.campaignId)).toEqual(["c2"]);
    expect(noida.total.joined).toBe(1);
  });

  it("a scope with no branch gets nothing and runs no statement; an unknown branch gets nothing", async () => {
    expect(await getMetaRecruitment({ all: false, branchName: null })).toEqual({ campaigns: [], total: zero });
    expect(h.calls).toEqual([]);
    expect(await getMetaRecruitment({ all: false, branchName: "NOWHERE" })).toEqual({ campaigns: [], total: zero });
  });

  it("the default (no scope) is org-wide, as he-meta-funnel uses it", async () => {
    const a = await getMetaRecruitment();
    const b = await getMetaRecruitment({ all: true });
    expect(a).toEqual(b);
    expect(a.campaigns).toHaveLength(3);
  });

  it("the full ats_candidate pass reads only id, mobile and walk_in_date (covering index), and stages only for matched ids by key", async () => {
    await getMetaRecruitment();
    const scan = h.calls.filter(([s]) => s.includes("FROM ats_candidate c WHERE c.mobile IS NOT NULL"));
    expect(scan).toHaveLength(1);
    expect(scan[0][0]).toBe("SELECT c.id, c.mobile, (c.walk_in_date IS NOT NULL) AS walked FROM ats_candidate c WHERE c.mobile IS NOT NULL AND c.mobile <> ''");
    const byKey = h.calls.filter(([s]) => s.includes("FROM ats_candidate c WHERE c.id IN"));
    // linked ids first (a1, a3), then the phone matches not yet loaded (a2, a4); never the unmatched a5
    expect(byKey.map(([, p]) => [...p].sort())).toEqual([["a1", "a3"], ["a2", "a4"]]);
  });

  it("one cached computation serves every scope", async () => {
    vi.resetModules();
    process.env.HE_META_CACHE_MS = "60000";
    const mod = await import("../he-meta-recruitment.service.js");
    await mod.getMetaRecruitment({ all: true });
    await mod.getMetaRecruitment({ all: false, branchName: "PUNE" });
    await mod.getMetaRecruitment({ all: false, branchName: "NOIDA-2" });
    expect(h.calls.filter(([s]) => s.includes("FROM meta_campaign c"))).toHaveLength(1);
    process.env.HE_META_CACHE_MS = "0";
  });
});
