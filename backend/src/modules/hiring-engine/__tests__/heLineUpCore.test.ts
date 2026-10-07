import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { calls, refresh, flags } = vi.hoisted(() => ({ calls: [] as Array<[string, unknown[]]>, refresh: vi.fn(async () => ({})), flags: { stale: false, night: false } }));

const driveRow = { id: "d1", requisition_id: "r1", branch_name: "Noida", drive_date: "2026-10-08", slot_start: "10:00", slot_end: "16:00", slot_minutes: 30, slot_capacity: 4, target_shows: 10, show_rate_pct: 50, status: "active", auto_send: 1, source_kind: "pool", source_ids: null, max_lead_age_days: null, run_label: null, reinvite: 0 };
const reqRow = { id: "r1", branch_name: "Noida", process_name: "Sales", designation_name: "Agent", requested_headcount: 10, fulfilled_headcount: 0, approval_status: "approved", active_status: 1, meta_target_age_min: null, meta_target_age_max: null, meta_target_radius_km: null, education_requirement: null, experience_min_years: null, night_shift_required: 0, salary_max: null, meta_screening_config: null, skills_required: null, blat: null, blng: null, bcity: "Noida", bstate: "UP" };
const lead = (id: string) => ({ id, mobile10: `98${id.padStart(8, "0")}`, ats_candidate_id: null, status: "new", primary_source: "meta", final_status: "", is_employee: 0, walkin_count: 0, last_attempt_date: null, last_outcome: null, history_refreshed_at: new Date(), locality: "Noida", age: 25, education_rank: 3, experience_years: 1, night_shift_ok: 1, lat: null, lng: null, eng: 0, has_consent: 1 });

vi.mock("node:crypto", () => ({ randomBytes: () => ({ toString: () => "tok" }) }));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql.replace(/\s+/g, " ").trim(), params]);
      if (/FROM he_drive WHERE id = \?/.test(sql)) return [[driveRow]];
      if (/FROM job_requisition jr/.test(sql)) return [[{ ...reqRow, night_shift_required: flags.night ? 1 : 0 }]];
      if (/FROM he_lead l LEFT JOIN he_lead_insight/.test(sql)) return [["1", "2"].map((i) => ({ ...lead(i), ...(flags.stale ? { history_refreshed_at: null } : {}), ...(flags.night ? { night_shift_ok: null } : {}) }))];
      if (/^SELECT m\.lead_id FROM he_match m/.test(sql.trim())) { if (onDrive.fail) throw new Error("x"); return [onDrive.ids.map((lead_id) => ({ lead_id }))]; }
      return [[]];
    }),
  },
}));
const { matched, onDrive, warn } = vi.hoisted(() => ({ matched: vi.fn(async () => ({ enqueued: 0, exists: 0, handedOver: 0 })), onDrive: { ids: [] as string[], fail: false }, warn: vi.fn() }));
vi.mock("../../../logger.js", () => ({ logger: { warn, info: vi.fn(), error: vi.fn() } }));
vi.mock("../qualified-followup.service.js", () => ({ enqueueMatchedFollowups: matched }));
vi.mock("../he-eligibility.service.js", () => ({
  applyEligibilityGate: vi.fn(async (leads: Array<{ id: string }>) => ({ verdicts: new Map(leads.map((l) => [l.id, { eligible: true, priority: 0 }])), blockedByReason: {} })),
}));
vi.mock("../he-profile.service.js", () => ({ loadProfiles: vi.fn(async () => new Map()) }));
vi.mock("../he-jd.service.js", () => ({ getRequisitionJd: vi.fn(async () => null) }));
vi.mock("../he-showup.service.js", () => ({ loadMatchParams: vi.fn(async () => ({})) }));
vi.mock("../he-master.service.js", () => ({ refreshHistoryChunk: refresh }));
vi.mock("../he-learn.js", () => ({ learnedBonus: () => ({ bonus: 0, reasons: [] }) }));

import { lineUpCandidates, suggestMatchesDetailed } from "../he-drive.service.js";

beforeEach(() => { matched.mockClear(); warn.mockClear(); onDrive.ids = []; onDrive.fail = false; calls.length = 0; refresh.mockClear(); flags.stale = false; flags.night = false; });

describe("line-up SQL before the stream options (snapshot of today's behaviour)", () => {
  it("suggestMatchesDetailed(d1)", async () => {
    await suggestMatchesDetailed("d1");
    expect(calls).toMatchSnapshot();
  });
  it("suggestMatchesDetailed(d1, 5, metaOnly)", async () => {
    await suggestMatchesDetailed("d1", 5, { metaOnly: true });
    expect(calls).toMatchSnapshot();
  });
});

describe("lineUpCandidates options", () => {
  const audience = { source_kind: "campaign", source_ids: ["c9"], max_lead_age_days: null };
  const cand = () => calls.find(([sql]) => sql.startsWith("SELECT l.id"))!;

  it("a stream audience, exclude-on-drive and keep-others change only the SQL they own", async () => {
    const r = await lineUpCandidates("d1", { audience, excludeOnDrive: true, keepOtherSuggestions: true, limit: 1 });
    const [sql, params] = cand();
    expect(sql).toContain("lc.campaign_id IN (?)");
    expect(sql).toContain("mx.drive_id = ?");
    expect(params.slice(0, 2)).toEqual(["c9", "d1"]);
    expect(calls.filter(([q]) => q.startsWith("INSERT INTO he_match"))).toHaveLength(1);
    expect(calls.some(([q]) => q.startsWith("DELETE"))).toBe(false);
    expect(r.leadIds).toHaveLength(1);
    expect(r.suggested).toBe(1);
  });

  it("the stream audience also decides the night-shift rule: a campaign audience lets an unknown preference through, a pool does not", async () => {
    flags.night = true;
    expect((await lineUpCandidates("d1", { audience })).suggested).toBe(2);
    expect(cand()[0]).toContain("l.night_shift_ok IS NULL");
    calls.length = 0;
    expect((await lineUpCandidates("d1")).suggested).toBe(0);
  });

  it("excludeOnDrive alone implies keepOtherSuggestions: a stream line-up never deletes other streams' suggestions", async () => {
    await lineUpCandidates("d1", { audience, excludeOnDrive: true, limit: 1 });
    expect(calls.filter(([q]) => q.startsWith("INSERT INTO he_match"))).toHaveLength(1);
    expect(calls.some(([q]) => q.startsWith("DELETE"))).toBe(false);
  });

  it("excludeOnDrive also leaves out people queued on another live, not-past drive of the same requisition (no cross-day re-pointing)", async () => {
    await lineUpCandidates("d1", { audience, excludeOnDrive: true, limit: 1 });
    const [sql, params] = cand();
    expect(sql).toContain("AND NOT EXISTS (SELECT 1 FROM he_match mx LEFT JOIN he_drive dx ON dx.id = mx.drive_id WHERE mx.lead_id = l.id AND (mx.drive_id = ? OR (mx.requisition_id = ? AND dx.status <> 'closed' AND dx.drive_date >= CURDATE())))");
    expect(params.slice(0, 3)).toEqual(["c9", "d1", "r1"]);
  });

  it("write:false is a preview: no refresh, no INSERT, no DELETE, leadIds still returned", async () => {
    flags.stale = true;
    const r = await lineUpCandidates("d1", { write: false });
    expect(calls.some(([q]) => q.startsWith("INSERT") || q.startsWith("DELETE"))).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
    expect(r.leadIds).toHaveLength(2);
    expect(r.suggested).toBe(2);
    // the same call with writing on does refresh stale rollups
    await lineUpCandidates("d1");
    expect(refresh).toHaveBeenCalled();
  });

  it("no options gives the same SQL as suggestMatchesDetailed", async () => {
    await lineUpCandidates("d1");
    const a = calls.slice();
    calls.length = 0;
    await suggestMatchesDetailed("d1");
    expect(calls).toEqual(a);
  });

  it("without excludeOnDrive the clause is absent", async () => {
    await lineUpCandidates("d1", { audience });
    expect(cand()[0]).not.toContain("mx.drive_id");
  });
});

describe("follow-up enqueue hook", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("mode unset: no extra SQL and no enqueue call (same calls as with the hook absent)", async () => {
    await lineUpCandidates("d1");
    expect(calls.some(([q]) => q.startsWith("SELECT m.lead_id FROM he_match m"))).toBe(false);
    expect(matched).not.toHaveBeenCalled();
  });

  it("mode off spelled out behaves like unset", async () => {
    vi.stubEnv("QUAL_FOLLOWUP_MODE", "off");
    await lineUpCandidates("d1");
    expect(calls.some(([q]) => q.startsWith("SELECT m.lead_id FROM he_match m"))).toBe(false);
    expect(matched).not.toHaveBeenCalled();
  });

  it("dry_run: one he_match pre-check before the INSERTs, enqueue called once with only the lead not already on the drive", async () => {
    vi.stubEnv("QUAL_FOLLOWUP_MODE", "dry_run");
    onDrive.ids = ["1"];
    await lineUpCandidates("d1", { followupStream: { streamId: "s1", sourceType: "meta_live", originId: "c9", originLabel: "Oct ads" } });
    const sel = calls.findIndex(([q]) => q.startsWith("SELECT m.lead_id FROM he_match m"));
    const ins = calls.findIndex(([q]) => q.startsWith("INSERT INTO he_match"));
    expect(sel).toBeGreaterThan(-1);
    expect(sel).toBeLessThan(ins);
    expect(calls.filter(([q]) => q.startsWith("SELECT m.lead_id FROM he_match m"))).toHaveLength(1);
    expect(matched).toHaveBeenCalledTimes(1);
    expect(matched).toHaveBeenCalledWith({ id: "d1", requisitionId: "r1", sourceKind: "pool", runLabel: null, driveDate: "2026-10-08" }, ["2"],
      { streamId: "s1", sourceType: "meta_live", originId: "c9", originLabel: "Oct ads" });
  });

  it("preview (write:false) never enqueues", async () => {
    vi.stubEnv("QUAL_FOLLOWUP_MODE", "dry_run");
    await lineUpCandidates("d1", { write: false });
    expect(matched).not.toHaveBeenCalled();
    expect(calls.some(([q]) => q.startsWith("SELECT m.lead_id FROM he_match m"))).toBe(false);
  });

  it("fail open: a rejecting enqueue or a failing pre-check never throws into the line-up", async () => {
    vi.stubEnv("QUAL_FOLLOWUP_MODE", "dry_run");
    matched.mockRejectedValueOnce(new Error("boom 9876543210"));
    await expect(lineUpCandidates("d1")).resolves.toMatchObject({ suggested: 2 });
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).not.toMatch(/\d{10}/);
    warn.mockClear(); matched.mockClear();
    onDrive.fail = true;
    await expect(lineUpCandidates("d1")).resolves.toMatchObject({ suggested: 2 });
    // pre-check failed: every scored person goes to the (idempotent) enqueue, the line-up itself is untouched
    expect(matched).toHaveBeenCalledTimes(1);
    expect(matched.mock.calls[0][1]).toEqual(["1", "2"]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("self-healing pre-check: a person counts as already handled only when on the drive AND holding a follow-up row (group 6-7 review I2)", async () => {
    vi.stubEnv("QUAL_FOLLOWUP_MODE", "dry_run");
    onDrive.ids = []; // lead 1 is on the drive but its follow-up row was lost: the query returns nobody, so both are enqueued
    await lineUpCandidates("d1");
    const [sql, params] = calls.find(([q]) => q.startsWith("SELECT m.lead_id FROM he_match m"))!;
    expect(sql).toContain("JOIN he_lead l ON l.id = m.lead_id");
    expect(sql).toContain("EXISTS (SELECT 1 FROM qualified_followup qf WHERE qf.mobile10 = l.mobile10 AND qf.requisition_id = m.requisition_id)");
    expect(params).toEqual(["d1", "1", "2"]);
    expect(matched.mock.calls[0][1]).toEqual(["1", "2"]);
  });
});
