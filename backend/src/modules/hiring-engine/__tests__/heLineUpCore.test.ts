import { beforeEach, describe, expect, it, vi } from "vitest";

const { calls, refresh } = vi.hoisted(() => ({ calls: [] as Array<[string, unknown[]]>, refresh: vi.fn(async () => ({})) }));

const driveRow = { id: "d1", requisition_id: "r1", branch_name: "Noida", drive_date: "2026-10-08", slot_start: "10:00", slot_end: "16:00", slot_minutes: 30, slot_capacity: 4, target_shows: 10, show_rate_pct: 50, status: "active", auto_send: 1, source_kind: "pool", source_ids: null, max_lead_age_days: null, run_label: null, reinvite: 0 };
const reqRow = { id: "r1", branch_name: "Noida", process_name: "Sales", designation_name: "Agent", requested_headcount: 10, fulfilled_headcount: 0, approval_status: "approved", active_status: 1, meta_target_age_min: null, meta_target_age_max: null, meta_target_radius_km: null, education_requirement: null, experience_min_years: null, night_shift_required: 0, salary_max: null, meta_screening_config: null, skills_required: null, blat: null, blng: null, bcity: "Noida", bstate: "UP" };
const lead = (id: string) => ({ id, mobile10: `98${id.padStart(8, "0")}`, ats_candidate_id: null, status: "new", primary_source: "meta", final_status: "", is_employee: 0, walkin_count: 0, last_attempt_date: null, last_outcome: null, history_refreshed_at: new Date(), locality: "Noida", age: 25, education_rank: 3, experience_years: 1, night_shift_ok: 1, lat: null, lng: null, eng: 0, has_consent: 1 });

vi.mock("node:crypto", () => ({ randomBytes: () => ({ toString: () => "tok" }) }));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql.replace(/\s+/g, " ").trim(), params]);
      if (/FROM he_drive WHERE id = \?/.test(sql)) return [[driveRow]];
      if (/FROM job_requisition jr/.test(sql)) return [[reqRow]];
      if (/FROM he_lead l LEFT JOIN he_lead_insight/.test(sql)) return [[lead("1"), lead("2")]];
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

import { suggestMatchesDetailed } from "../he-drive.service.js";

beforeEach(() => { calls.length = 0; refresh.mockClear(); });

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
