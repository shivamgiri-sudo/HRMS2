import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  campaigns: [] as Array<Record<string, unknown>>,
  reqs: [] as Array<Record<string, unknown>>,
  streams: [] as Array<Record<string, unknown>>,
  activity: [] as Array<Record<string, unknown>>,
  drives: [] as Array<Record<string, unknown>>,
  runs: [] as Array<Record<string, unknown>>,
  params: [] as Array<Record<string, unknown>>,
  noResponses: true,
  runsFail: false,
  activityFail: false,
}));
vi.mock("../he-read-limit.js", () => {
  const exec = async (sql: string, p: unknown[] = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    h.sqls.push({ sql: s, p });
    if (s.includes("activity48h")) { if (h.activityFail) throw Object.assign(new Error("Query execution was interrupted, maximum statement execution time exceeded"), { code: "ER_QUERY_TIMEOUT" }); return [h.activity, []]; }
    if (s.includes("FROM meta_campaign mc")) return [h.campaigns, []];
    if (s.includes("FROM job_requisition jr")) return [h.reqs.filter((r) => !s.includes("jr.branch_name = ?") || r.branch_name === p[p.length - 1]), []];
    if (s.includes("FROM requisition_stream")) return [h.streams, []];
    if (s.includes("FROM candidate_response")) { if (h.noResponses) throw Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE" }); return [[], []]; }
    if (s.includes("FROM he_drive")) return [h.drives, []];
    if (s.includes("FROM shortlist_run")) { if (h.runsFail) throw Object.assign(new Error("timeout"), { code: "ER_QUERY_TIMEOUT" }); return [h.runs, []]; }
    if (s.includes("FROM he_model_param")) return [h.params, []];
    return [[], []];
  };
  return { limitedDb: { execute: exec } };
});
vi.mock("../he-source-attribution.service.js", () => ({ loadLiveFrom: async () => "2026-10-08" }));
vi.mock("../qualified-followup.schedule.js", () => ({ followupMode: () => "off" }));

import { clearMatrixCache, getCampaignMatrix } from "../campaign-matrix.service.js";

const NOW = new Date("2026-10-09T06:00:00Z");
const req = (id: string, o: Record<string, unknown> = {}) => ({ id, requisition_code: id.toUpperCase(), branch_name: "NOIDA-2", process_name: "Onfido", designation_name: "CSA",
  approval_status: "approved", active_status: 1, closed_at: null, requested_headcount: 10, fulfilled_headcount: 0, requisition_validity: "2026-12-31", has_bmi: 1,
  education_requirement: null, skills_required: null, experience_min_years: null, experience_max_years: null, meta_target_age_min: null, meta_target_age_max: null,
  meta_target_locations: null, meta_target_radius_km: null, shift_requirement: null, night_shift_required: 0, rotational_shift: 0, salary_min: null, salary_max: null,
  preferred_sources: null, meta_screening_config: null, selection_rules: null, bcity: "Noida", bstate: null, blat: null, blng: null, ...o });
const camp = (id: string, link: string, o: Record<string, unknown> = {}) => ({ id, campaign_name: `Camp ${id}`, campaign_status: "active", meta_form_id: "f", primary_id: link, link_id: link, ...o });
const ALL = { all: true as const };

beforeEach(() => {
  clearMatrixCache(); h.sqls = []; h.noResponses = true;
  h.reqs = [req("k7bk", { approval_status: "closed", active_status: 0, closed_at: "2026-10-01 10:00:00" }), req("onf17"), req("onf18"), req("ahm", { branch_name: "AHMEDABAD" })];
  h.campaigns = [camp("ck", "k7bk"), camp("cm", "onf17"), camp("cm", "onf18", { primary_id: "onf17" }), camp("cp", "onf17", { campaign_status: "paused" })];
  h.streams = [{ id: "s1", requisition_id: "onf17", source_type: "meta_live", origin_id: "cm", status: "open" }];
  h.activity = [{ requisition_id: "onf17", kind: "meta_live", campaign_id: "cm", n: 4 }, { requisition_id: "ahm", kind: "he", campaign_id: null, n: 2 }];
  h.drives = [{ requisition_id: "ahm", n: 1 }];
  h.runs = [];
  h.params = [];
});

describe("getCampaignMatrix (C1 service)", () => {
  it("rows: active campaigns x their links, requisition-only rows for open requisitions without a campaign; paused campaigns without a stream left out", async () => {
    const m = await getCampaignMatrix({}, ALL, NOW);
    expect(m.rows.map((r) => r.key)).toEqual(["ck|k7bk", "cm|onf17", "cm|onf18", "~|ahm"]);
    const k7 = m.rows.find((r) => r.key === "ck|k7bk")!;
    expect(k7.cells.meta_live).toMatchObject({ state: "idle", reason: "requisition_closed", relink: true });
    expect(k7.requisition.closedReason).toBe("requisition is inactive");
    expect(m.rows.find((r) => r.key === "cm|onf17")!.cells.meta_live).toMatchObject({ state: "running", activity48h: 4, streamId: "s1" });
    expect(m.rows.find((r) => r.key === "~|ahm")!.cells.he).toMatchObject({ state: "running", activity48h: 2 });
    expect(m.rows.find((r) => r.key === "~|ahm")!.cells.meta_live.state).toBe("not_applicable");
  });

  it("one statement per fact family (no N+1), every read keyed by the requisition ids", async () => {
    await getCampaignMatrix({}, ALL, NOW);
    expect(h.sqls.length).toBeLessThanOrEqual(9);
    expect(h.sqls.find((x) => x.sql.includes("FROM requisition_stream"))!.p).toEqual(expect.arrayContaining(["k7bk", "onf17", "onf18", "ahm"]));
  });

  it("branch scope: an Ahmedabad HR sees only Ahmedabad rows", async () => {
    const m = await getCampaignMatrix({}, { all: false, branchName: "AHMEDABAD" }, NOW);
    expect(m.rows.map((r) => r.key)).toEqual(["~|ahm"]);
  });

  it("a branch-scoped caller without a branch sees nothing", async () => {
    const m = await getCampaignMatrix({}, { all: false, branchName: null }, NOW);
    expect(m.rows).toEqual([]);
    expect(h.sqls).toHaveLength(0);
  });

  it("filters by requisition and caches for 60 s per scope key", async () => {
    const a = await getCampaignMatrix({ requisitionId: "onf18" }, ALL, NOW);
    expect(a.rows.map((r) => r.key)).toEqual(["cm|onf18"]);
    const n = h.sqls.length;
    await getCampaignMatrix({ requisitionId: "onf18" }, ALL, NOW);
    expect(h.sqls.length).toBe(n);
  });

  it("an absent responses table reads as unknown; a failing optional read is listed in partial and the matrix still renders", async () => {
    const m = await getCampaignMatrix({}, ALL, NOW);
    expect(m.partial).toEqual([]);
    expect(m.rows[1].cells.meta_live.state).toBe("running");
    clearMatrixCache();
    h.runsFail = true;
    const m2 = await getCampaignMatrix({}, ALL, NOW);
    expect(m2.partial).toEqual(["shortlist"]);
    expect(m2.rows.length).toBe(4);
    h.runsFail = false;
  });

  it("E6: the 48 h activity read is index-friendly (no COALESCE on a join key; driven by the requisition ids and their campaigns) and read through the time-capped limiter", async () => {
    await getCampaignMatrix({}, ALL, NOW);
    const sql = h.sqls.find((x) => x.sql.includes("activity48h"))!.sql;
    expect(sql).not.toMatch(/COALESCE\(r\.requisition_id/);
    expect(sql).toContain("WHERE r.requisition_id IN (");
    expect(sql).toContain("WHERE mc.requisition_id IN (");
    expect(sql).toContain("r.requisition_id IS NULL");
    // time cap: limitedDb adds MAX_EXECUTION_TIME to every read (he-read-limit withStatementTimeout)
  });
  it("E6: an activity timeout returns the matrix with activity unknown (partial), never a failure", async () => {
    h.activityFail = true;
    const m = await getCampaignMatrix({}, ALL, NOW);
    h.activityFail = false;
    expect(m.partial).toContain("activity");
    expect(m.rows.length).toBeGreaterThan(0);
    const cell = m.rows.find((r) => r.key === "~|ahm")!.cells.he;
    expect(cell).toMatchObject({ activityUnknown: true });
    expect(cell.reasonText).not.toMatch(/Nobody contacted/);
  });
  it("E7: activity and responses are typed by the shared attribution rule (Meta origin of the person, first fill, activity time), not by the raw fill alone", async () => {
    h.noResponses = false;
    await getCampaignMatrix({}, ALL, NOW);
    h.noResponses = true;
    for (const key of ["activity48h", "FROM candidate_response"]) {
      const sql = h.sqls.find((x) => x.sql.includes(key))!.sql;
      expect(sql).not.toContain("IF(f.id IS NULL, 'he'");
      expect(sql).toContain("he_lead_campaign alx"); // metaOriginSql of the shared rule
    }
  });
  it("awaiting approval: a run with waiting people older than 24 h", async () => {
    h.runs = [{ requisition_id: "onf18", source_kind: "he", created_at: "2026-10-07 19:00:00", waiting: 5, n: 9 }];
    h.streams.push({ id: "s2", requisition_id: "onf18", source_type: "he", origin_id: "pool", status: "open" });
    h.reqs = h.reqs.map((r) => (r.id === "onf18" ? { ...r, education_requirement: "12th", meta_target_age_min: 18, meta_target_age_max: 35, night_shift_required: 1, meta_target_locations: JSON.stringify(["Noida"]) } : r));
    const m = await getCampaignMatrix({}, ALL, NOW);
    expect(m.rows.find((r) => r.key === "cm|onf18")!.cells.he.reason).toBe("awaiting_approval");
  });
});

describe("end-date enforcement shown in the matrix", () => {
  it("needs both the env key and the policy", async () => {
    h.params = [{ param_key: "policy.req_end_date_enforced", value: 1 }];
    delete process.env.REQ_END_DATE_ENFORCEMENT;
    expect((await getCampaignMatrix({}, ALL, NOW)).enforcedEndDate).toBe(false);
    clearMatrixCache();
    process.env.REQ_END_DATE_ENFORCEMENT = "policy";
    expect((await getCampaignMatrix({}, ALL, NOW)).enforcedEndDate).toBe(true);
    delete process.env.REQ_END_DATE_ENFORCEMENT;
  });
});
