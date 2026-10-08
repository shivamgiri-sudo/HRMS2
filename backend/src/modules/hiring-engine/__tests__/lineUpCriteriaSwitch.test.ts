import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Ruling (2026-10-09): the line-up reads HR's saved criteria only through a SEPARATE read behind SELECTION_CRITERIA_LINEUP
// (default off). Off: the calls are exactly the pinned ones (lineUpCriteriaPin). On: one extra SELECT, and the line-up uses them.
const { calls, rules } = vi.hoisted(() => ({ calls: [] as string[], rules: { value: null as unknown } }));
const reqRow = { id: "rA", branch_name: "NOIDA-2", process_name: "Onfido", designation_name: "CSE", requested_headcount: 10, fulfilled_headcount: 0, approval_status: "approved", active_status: 1,
  meta_target_age_min: 18, meta_target_age_max: 35, meta_target_radius_km: null, education_requirement: "Graduate", experience_min_years: null, night_shift_required: 1,
  salary_max: null, meta_screening_config: null, skills_required: null, blat: null, blng: null, bcity: "Noida", bstate: "Uttar Pradesh" };
vi.mock("node:crypto", async (orig) => ({ ...(await orig<typeof import("node:crypto")>()), randomBytes: () => ({ toString: () => "tok" }) }));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string) => {
      const s = sql.replace(/\s+/g, " ").trim();
      calls.push(s);
      if (/FROM he_drive WHERE id = \?/.test(s)) return [[{ id: "d1", requisition_id: "rA", branch_name: "NOIDA-2", drive_date: "2026-10-12", slot_start: "10:00", slot_end: "16:00", slot_minutes: 30, slot_capacity: 4,
        target_shows: 4, show_rate_pct: 50, status: "active", auto_send: 0, source_kind: "pool", source_ids: null, max_lead_age_days: null, run_label: null, reinvite: 0 }]];
      if (s.startsWith("SELECT selection_rules FROM job_requisition")) return [[{ selection_rules: rules.value }]];
      if (/FROM job_requisition jr/.test(s)) return [[reqRow]];
      return [[]];
    }),
  },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../qualified-followup.service.js", () => ({ enqueueMatchedFollowups: vi.fn(async () => ({})) }));
vi.mock("../he-eligibility.service.js", () => ({ applyEligibilityGate: vi.fn(async () => ({ verdicts: new Map(), blockedByReason: {} })) }));
vi.mock("../he-profile.service.js", () => ({ loadProfiles: vi.fn(async () => new Map()) }));
vi.mock("../he-jd.service.js", () => ({ getRequisitionJd: vi.fn(async () => null) }));
vi.mock("../he-showup.service.js", () => ({ loadMatchParams: vi.fn(async () => ({})) }));
vi.mock("../he-master.service.js", () => ({ refreshHistoryChunk: vi.fn(async () => ({})) }));
vi.mock("../he-learn.js", () => ({ learnedBonus: () => ({ bonus: 0, reasons: [] }) }));

import { lineUpCandidates } from "../he-drive.service.js";

const candidateSql = () => calls.find((s) => s.startsWith("SELECT l.id, l.mobile10, l.ats_candidate_id"))!;
beforeEach(() => { calls.length = 0; rules.value = { schema: 1, rules: { education_min: { mode: "off", decided: true }, night_shift: { mode: "off", decided: true } } }; });
afterEach(() => vi.unstubAllEnvs());

describe("line-up and HR's saved criteria", () => {
  it("switch off (default): no extra statement; the column criteria apply", async () => {
    await lineUpCandidates("d1", { write: false });
    expect(calls.some((s) => s.startsWith("SELECT selection_rules"))).toBe(false);
    expect(candidateSql()).toContain("l.education_rank >= ?");
    expect(candidateSql()).toContain("l.night_shift_ok = 1");
  });
  it.each(["all", "rX,rA"])("switch %s: one separate read, and education / night shift switched off by HR no longer filter", async (v) => {
    vi.stubEnv("SELECTION_CRITERIA_LINEUP", v);
    await lineUpCandidates("d1", { write: false });
    expect(calls.filter((s) => s.startsWith("SELECT selection_rules FROM job_requisition WHERE id = ?"))).toHaveLength(1);
    expect(candidateSql()).not.toContain("l.education_rank >= ?");
    expect(candidateSql()).not.toContain("l.night_shift_ok = 1");
    expect(candidateSql()).toContain("l.age >= ?");
  });
  it("switch on for another requisition only: untouched", async () => {
    vi.stubEnv("SELECTION_CRITERIA_LINEUP", "rX");
    await lineUpCandidates("d1", { write: false });
    expect(calls.some((s) => s.startsWith("SELECT selection_rules"))).toBe(false);
  });
  it("switch on but the column is missing (before 2145) or empty: today's behaviour", async () => {
    vi.stubEnv("SELECTION_CRITERIA_LINEUP", "all");
    rules.value = null;
    await lineUpCandidates("d1", { write: false });
    expect(candidateSql()).toContain("l.education_rank >= ?");
  });
});
