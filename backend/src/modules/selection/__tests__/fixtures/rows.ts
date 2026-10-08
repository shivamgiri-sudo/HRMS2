import type { RequisitionCriteriaRow } from "../../compile-criteria.js";

/** An approved Onfido-like requisition as prod holds them today: skills and a salary band, nothing else. */
export function onfidoRow(o: Partial<RequisitionCriteriaRow> = {}): RequisitionCriteriaRow {
  return {
    id: "r-onfido", code: "REQ-2610-ONF1", branchName: "NOIDA-2", branchCity: "Noida", branchState: "Uttar Pradesh", branchLat: null, branchLng: null,
    processName: "Onfido", educationRequirement: null, skillsRequired: "Excel, typing", experienceMinYears: null, experienceMaxYears: null,
    ageMin: null, ageMax: null, targetLocations: null, radiusKm: null, shiftRequirement: null, nightShiftRequired: 0, rotationalShift: 0,
    salaryMin: 15000, salaryMax: 18000, preferredSources: null, screeningConfig: null, selectionRules: null, approvalStatus: "approved",
    ...o,
  };
}

export const K7BK_CONFIG = {
  custom_field_rules: [
    { field: "are_you_a_graduate", op: "is_yes", value: "", label: "Graduate (must)" },
    { field: "this_role_includes_night_shifts_are_you_willing_and_able_to_work_night_shifts", op: "is_yes", value: "", label: "Willing to work night shifts" },
  ],
};
