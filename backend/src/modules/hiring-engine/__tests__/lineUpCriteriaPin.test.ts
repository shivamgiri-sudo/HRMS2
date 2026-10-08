import { beforeEach, describe, expect, it, vi } from "vitest";

// PIN (selection criteria S8, written before any engine change): today's drive line-up for three requisitions with no
// selection_rules: every SQL statement + params, the ranked lead ids, and the toMatchRequisition output. Never edit.
const { calls, state } = vi.hoisted(() => ({ calls: [] as Array<[string, unknown[]]>, state: { req: "A" as "A" | "B" | "C" } }));

const base = { branch_name: "NOIDA-2", process_name: "Onfido", designation_name: "CSE", requested_headcount: 10, fulfilled_headcount: 0, approval_status: "approved", active_status: 1,
  meta_target_age_min: null, meta_target_age_max: null, meta_target_radius_km: null, education_requirement: null, experience_min_years: null, night_shift_required: 0,
  salary_max: null, meta_screening_config: null, skills_required: null, blat: null, blng: null, bcity: "Noida", bstate: "Uttar Pradesh" };
export const REQS = {
  A: { ...base, id: "rA", meta_target_age_min: 18, meta_target_age_max: 35, education_requirement: "Graduate", night_shift_required: 1, salary_max: "18000.00" },
  B: { ...base, id: "rB", process_name: "SBI Credit Cards Collections", branch_name: "AHMEDABAD-JALDARSHAN", bcity: "Ahmedabad", bstate: "Gujarat", experience_min_years: "1.0", salary_max: 20000,
    meta_screening_config: { gender: "female", certifications: ["DRA"], language_requirements: [{ language: "Hindi", skills: ["speak"] }], min_typing_speed_wpm: 25, written_english_level: "intermediate" } },
  C: { ...base, id: "rC", skills_required: "Female candidates only. DRA certified. Night shifts. Hindi and English. Graduation required.", meta_screening_config: "{\"auto_notify\":true}" },
};
const lead = (id: string, o: Record<string, unknown>) => ({ id, mobile10: `98765${id.padStart(5, "0")}`, ats_candidate_id: null, status: "new", primary_source: "meta", final_status: "none", is_employee: 0,
  walkin_count: 0, last_attempt_date: null, last_outcome: null, history_refreshed_at: new Date("2026-10-09T00:00:00Z"), locality: "Noida", age: 25, education_rank: 5, experience_years: 2,
  night_shift_ok: 1, lat: null, lng: null, eng: 0, has_consent: 1, ...o });
const LEADS = [
  lead("1", {}), lead("2", { age: null }), lead("3", { education_rank: 3 }), lead("4", { night_shift_ok: null }), lead("5", { night_shift_ok: 0 }),
  lead("6", { experience_years: 0, eng: 5 }), lead("7", { has_consent: 0 }), lead("8", { age: 40 }), lead("9", { education_rank: null, experience_years: null }), lead("10", { eng: 9 }),
];
const PROFILES: Record<string, Record<string, unknown>> = {
  "1": { gender: "female", certifications: ["DRA"], languages: ["hindi", "english"], typingWpm: 30, englishLevel: "intermediate", salaryExpectation: 17000 },
  "2": { gender: "male", certifications: [], languages: ["hindi"] },
  "3": { gender: "female", certifications: ["DRA"], languages: ["gujarati"], typingWpm: 20, englishLevel: "basic" },
  "4": { gender: "female", certifications: null, languages: null },
  "6": { gender: "female", certifications: ["DRA"], languages: ["hindi"], salaryExpectation: 30000 },
  "10": { gender: "female", certifications: ["DRA"], languages: ["hindi", "english"], educationStatus: "dropped" },
};

vi.mock("node:crypto", () => ({ randomBytes: () => ({ toString: () => "tok" }) }));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql.replace(/\s+/g, " ").trim(), params]);
      if (/FROM he_drive WHERE id = \?/.test(sql)) return [[{ id: "d1", requisition_id: REQS[state.req].id, branch_name: REQS[state.req].branch_name, drive_date: "2026-10-12", slot_start: "10:00", slot_end: "16:00",
        slot_minutes: 30, slot_capacity: 4, target_shows: 4, show_rate_pct: 50, status: "active", auto_send: 0, source_kind: "pool", source_ids: null, max_lead_age_days: null, run_label: null, reinvite: 0 }]];
      if (/FROM job_requisition jr/.test(sql)) return [[REQS[state.req]]];
      if (/FROM he_lead l LEFT JOIN he_lead_insight/.test(sql)) return [LEADS];
      return [[]];
    }),
  },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../qualified-followup.service.js", () => ({ enqueueMatchedFollowups: vi.fn(async () => ({})) }));
vi.mock("../he-eligibility.service.js", () => ({
  applyEligibilityGate: vi.fn(async (leads: Array<{ id: string }>) => ({ verdicts: new Map(leads.map((l) => [l.id, { eligible: l.id !== "7", priority: l.id === "6" ? 9 : 1 }])), blockedByReason: { opted_out: 1 } })),
}));
vi.mock("../he-profile.service.js", () => ({ loadProfiles: vi.fn(async (ids: string[]) => new Map(ids.filter((i) => PROFILES[i]).map((i) => [i, PROFILES[i]]))) }));
vi.mock("../he-jd.service.js", () => ({ getRequisitionJd: vi.fn(async () => null) }));
vi.mock("../he-showup.service.js", () => ({ loadMatchParams: vi.fn(async () => ({})) }));
vi.mock("../he-master.service.js", () => ({ refreshHistoryChunk: vi.fn(async () => ({})) }));
vi.mock("../he-learn.js", () => ({ learnedBonus: () => ({ bonus: 0, reasons: [] }) }));

import { lineUpCandidates, toMatchRequisition } from "../he-drive.service.js";

beforeEach(() => { calls.length = 0; });

describe("line-up pin (no selection_rules)", () => {
  it.each(["A", "B", "C"] as const)("requisition %s: SQL, params, ranked ids", async (k) => {
    state.req = k;
    const r = await lineUpCandidates("d1");
    expect({ calls, leadIds: r.leadIds, suggested: r.suggested, considered: r.considered }).toMatchSnapshot();
  });
  it.each(["A", "B", "C"] as const)("toMatchRequisition(%s)", (k) => {
    expect(toMatchRequisition(REQS[k] as never)).toMatchSnapshot();
  });
});
