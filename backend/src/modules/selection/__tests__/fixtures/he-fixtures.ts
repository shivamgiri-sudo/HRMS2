// Drive line-up parity fixtures: the three requisitions of hiring-engine/__tests__/lineUpCriteriaPin.test.ts (same values)
// plus a seeded generator of pool leads and profiles (he_lead + he_lead_profile column shapes).
export const BASE_REQ = { branch_name: "NOIDA-2", process_name: "Onfido", designation_name: "CSE", requested_headcount: 10, fulfilled_headcount: 0, approval_status: "approved", active_status: 1,
  meta_target_age_min: null, meta_target_age_max: null, meta_target_radius_km: null, education_requirement: null, experience_min_years: null, night_shift_required: 0,
  salary_max: null, meta_screening_config: null, skills_required: null, blat: null, blng: null, bcity: "Noida", bstate: "Uttar Pradesh" } as Record<string, unknown>;
export const HE_REQS: Record<"A" | "B" | "C", Record<string, unknown>> = {
  A: { ...BASE_REQ, id: "rA", meta_target_age_min: 18, meta_target_age_max: 35, education_requirement: "Graduate", night_shift_required: 1, salary_max: "18000.00" },
  B: { ...BASE_REQ, id: "rB", process_name: "SBI Credit Cards Collections", branch_name: "AHMEDABAD-JALDARSHAN", bcity: "Ahmedabad", bstate: "Gujarat", experience_min_years: "1.0", salary_max: 20000,
    meta_screening_config: { gender: "female", certifications: ["DRA"], language_requirements: [{ language: "Hindi", skills: ["speak"] }], min_typing_speed_wpm: 25, written_english_level: "intermediate" } },
  C: { ...BASE_REQ, id: "rC", skills_required: "Female candidates only. DRA certified. Night shifts. Hindi and English. Graduation required.", meta_screening_config: "{\"auto_notify\":true}" },
};

export interface HeLeadFixture { id: string; lead: Record<string, unknown>; profile: Record<string, unknown> | null; gateOk: boolean }

let seed = 20261009;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];

/** Pool leads with every fact sometimes missing, sometimes failing, sometimes passing. */
export function generateHeLeads(n: number): HeLeadFixture[] {
  seed = 20261009;
  const out: HeLeadFixture[] = [];
  for (let i = 0; i < n; i++) {
    // every other lead is drawn from strong values, so both sides of the line-up are well exercised
    const strong = i % 2 === 0;
    const sp = <T,>(good: readonly T[], all: readonly T[]) => pick(strong ? good : all);
    const lead = {
      mobile10: `98${String(10000000 + i)}`, age: sp([22, 30], [null, 17, 19, 25, 34, 36, 41]), education_rank: sp([5, 6], [null, 2, 3, 4, 5, 6]), experience_years: sp([1, 3], [null, 0, 0.5, 1, 3]),
      night_shift_ok: sp([1], [null, 0, 1]), locality: pick(["Noida", "Sector 62 Noida", "Ahmedabad", "Naroda", "Surat", "No Noida location", null, "ccc"]), lat: null, lng: null, updated_at: "2026-10-01 00:00:00",
    };
    const profile = !strong && rnd() < 0.15 ? null : {
      gender: sp(["female"], [null, "male", "female"]), languages: sp(["[\"hindi\",\"english\"]"], [null, "[\"hindi\"]", "[\"hindi\",\"english\"]", "[\"gujarati\"]", "[]"]), certifications: sp(["[\"DRA\"]"], [null, "[\"DRA\"]", "[]", "[\"IRDA\"]"]),
      typing_wpm: pick([null, 20, 30]), english_level: pick([null, "basic", "intermediate", "advanced"]), salary_expectation: sp([15000, null], [null, 15000, 24000, 30000]),
      last_salary: pick([null, 12000, 40000]), education_status: sp(["completed", null], [null, "completed", "pursuing", "dropped"]),
    };
    out.push({ id: `L${i}`, lead, profile, gateOk: rnd() > 0.1 });
  }
  return out;
}
