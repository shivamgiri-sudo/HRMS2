import { describe, expect, it } from "vitest";
import { criteriaOf, criteriaSummary, endDateOf, requisitionEndedReason, seatsLeft, type RequisitionRow } from "../requisition-criteria.js";

const base = (o: Partial<RequisitionRow> = {}): RequisitionRow => ({
  id: "r1", code: "NOIDA-Onfido-17", branchName: "NOIDA-2", branchCity: "Noida", branchState: "Uttar Pradesh", processName: "Onfido",
  educationRequirement: null, skillsRequired: "English, typing", experienceMinYears: null, experienceMaxYears: null, ageMin: null, ageMax: null,
  targetLocations: null, radiusKm: null, shiftRequirement: null, nightShiftRequired: null, rotationalShift: null, salaryMin: null, salaryMax: 18000,
  preferredSources: null, screeningConfig: { auto_notify: true }, selectionRules: null, approvalStatus: "approved",
  validity: "2026-10-20", activeStatus: 1, closedAt: null, requestedHeadcount: 25, fulfilledHeadcount: 3, bmiUrlPresent: false,
  ...o,
});

describe("requisition criteria adapter (A3, thin over compileCriteria / completeness)", () => {
  it("an Onfido-like row with skills only is not complete and lists the enrolment keys as missing", () => {
    const s = criteriaSummary(criteriaOf(base()));
    expect(s.label).not.toBe("complete");
    expect(s.enrolmentReady).toBe(false);
    for (const k of ["location_cities", "education_min", "night_shift", "age"]) expect(s.missing).toContain(k);
  });

  it("deciding location, education, shift and age makes enrolment ready", () => {
    const c = criteriaOf(base({ educationRequirement: "12th", ageMin: 18, ageMax: 35, nightShiftRequired: 1, targetLocations: ["Noida"] }));
    const s = criteriaSummary(c);
    expect(s.enrolmentReady).toBe(true);
    expect(s.missing).not.toContain("age");
    expect(c.requisitionId).toBe("r1");
  });

  it("end date: a past validity gives the reason only when enforced; today is still open (inclusive)", () => {
    expect(requisitionEndedReason(base({ validity: "2026-10-08" }), "2026-10-09", true)).toBe("requisition end date passed (2026-10-08)");
    expect(requisitionEndedReason(base({ validity: "2026-10-08" }), "2026-10-09", false)).toBeNull();
    expect(requisitionEndedReason(base({ validity: "2026-10-09" }), "2026-10-09", true)).toBeNull();
    expect(requisitionEndedReason(base({ validity: null }), "2026-10-09", true)).toBeNull();
  });

  it("endDateOf reads a Date or a DATETIME string as the IST calendar day", () => {
    expect(endDateOf(base({ validity: "2026-10-08 00:00:00" }))).toBe("2026-10-08");
    expect(endDateOf(base({ validity: new Date("2026-10-07T18:30:00Z") as unknown as string }))).toBe("2026-10-08");
    expect(endDateOf(base({ validity: null }))).toBeNull();
  });

  it("seats left never go negative", () => {
    expect(seatsLeft(base())).toBe(22);
    expect(seatsLeft(base({ requestedHeadcount: 5, fulfilledHeadcount: 7 }))).toBe(0);
    expect(seatsLeft(base({ requestedHeadcount: null, fulfilledHeadcount: null }))).toBe(0);
  });
});
