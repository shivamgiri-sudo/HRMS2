import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { toMatchRequisition } from "../he-drive.service.js";
import { legacyMatchRequisition } from "../he-match-requisition.js";

// S8: toMatchRequisition reads through compileCriteria(...).matchReq only when the requisition has selection_rules.
const row = (o: Record<string, unknown> = {}) => ({
  id: "r1", branch_name: "NOIDA-2", process_name: "Onfido", designation_name: "CSE", requested_headcount: 10, fulfilled_headcount: 0, approval_status: "approved", active_status: 1,
  meta_target_age_min: 18, meta_target_age_max: 35, meta_target_radius_km: null, education_requirement: "Graduate", experience_min_years: null, night_shift_required: 1,
  salary_max: 18000, meta_screening_config: null, skills_required: null, blat: null, blng: null, bcity: "Noida", bstate: "Uttar Pradesh", ...o,
}) as never;

describe("toMatchRequisition and selection_rules", () => {
  it("no selection_rules: exactly the legacy builder (null or absent)", () => {
    expect(toMatchRequisition(row())).toEqual(legacyMatchRequisition(row()));
    expect(toMatchRequisition(row({ selection_rules: null }))).toEqual(legacyMatchRequisition(row()));
  });
  it("education MUST graduate -> minEducationRank 5 through the compiled criteria", () => {
    const m = toMatchRequisition(row({ selection_rules: { schema: 1, rules: { education_min: { mode: "must" } } } }));
    expect(m.minEducationRank).toBe(5);
    expect(m.id).toBe("r1");
  });
  it("HR switched education off: the column still says Graduate, the line-up no longer requires it (the adapter is used)", () => {
    const m = toMatchRequisition(row({ selection_rules: JSON.stringify({ schema: 1, rules: { education_min: { mode: "off", decided: true }, night_shift: { mode: "prefer", weight: 5 } } }) }));
    expect(m.minEducationRank).toBeNull();
    expect(m.nightShift).toBe(false);
    expect(m.ageMin).toBe(18);
  });
  it("unreadable selection_rules fall back to the legacy builder", () => {
    expect(toMatchRequisition(row({ selection_rules: { schema: 9 } }))).toEqual(legacyMatchRequisition(row()));
  });
});
