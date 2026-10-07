import { beforeEach, describe, expect, it, vi } from "vitest";

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
      return [[]];
    }),
  },
}));
vi.mock("../he-eligibility.service.js", () => ({
  applyEligibilityGate: vi.fn(async (leads: Array<{ id: string }>) => ({ verdicts: new Map(leads.map((l) => [l.id, { eligible: true, priority: 0 }])), blockedByReason: {} })),
}));
vi.mock("../he-profile.service.js", () => ({ loadProfiles: vi.fn(async () => new Map()) }));
vi.mock("../he-jd.service.js", () => ({ getRequisitionJd: vi.fn(async () => null) }));
vi.mock("../he-showup.service.js", () => ({ loadMatchParams: vi.fn(async () => ({})) }));
vi.mock("../he-master.service.js", () => ({ refreshHistoryChunk: refresh }));
vi.mock("../he-learn.js", () => ({ learnedBonus: () => ({ bonus: 0, reasons: [] }) }));

import { lineUpCandidates, suggestMatchesDetailed } from "../he-drive.service.js";

beforeEach(() => { calls.length = 0; refresh.mockClear(); flags.stale = false; flags.night = false; });

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
