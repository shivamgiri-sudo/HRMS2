import { describe, expect, it } from "vitest";
import { placedInBranchArea } from "../../hiring-engine/he-location-match.js";
import { legacyMatchRequisition } from "../../hiring-engine/he-match-requisition.js";
import { scoreLead } from "../../hiring-engine/he-matcher.js";
import { screenLead } from "../../meta-campaign/lead-screener.service.js";
import { parseLead } from "../../meta-campaign/meta-lead.parser.js";
import type { MetaLeadDetail } from "../../meta-campaign/meta-campaign.types.js";
import { compileCriteria, type RequisitionCriteriaRow } from "../compile-criteria.js";
import { toCriteriaRow } from "../criteria-row.js";
import { evaluate } from "../evaluate.js";
import { normaliseFacts, type RawPerson } from "../facts-normalise.js";
import { generateHeLeads, HE_REQS } from "./fixtures/he-fixtures.js";
import { META_LEADS, META_REQS, type MetaReqFixture } from "./fixtures/meta-fixtures.js";

const NOW = new Date("2026-10-09T06:00:00Z");
const SYSTEM_OFF = { eligibility: { ok: true, blocks: [], priority: 1 }, inOtherJourney: null, bookedFor: null, exEmployee: null, rejectedOtherProcess: false };

const metaRow = (r: MetaReqFixture): RequisitionCriteriaRow => ({
  id: "rm", code: "REQ-M", branchName: "NOIDA-2", branchCity: "Noida", branchState: "Uttar Pradesh", processName: "Onfido", educationRequirement: r.education, skillsRequired: null,
  experienceMinYears: r.expMin, experienceMaxYears: r.expMax, ageMin: r.ageMin, ageMax: r.ageMax, targetLocations: null, radiusKm: null, shiftRequirement: null, nightShiftRequired: 0, rotationalShift: 0,
  salaryMin: null, salaryMax: null, preferredSources: null, screeningConfig: r.config, selectionRules: null, approvalStatus: "approved",
});
const metaPerson = (payload: MetaLeadDetail, sourceKind: "meta_live" | "meta_old"): RawPerson => ({
  sourceKind, subSource: sourceKind, mobile: parseLead(payload).phone ?? "9876543210", ats: null, lead: null, profile: null,
  meta: { rawPayload: JSON.stringify(payload), parsedEducation: null, parsedLocation: null, parsedExperienceYr: null, createdAt: "2026-10-08 10:00:00" },
  dra: null, system: SYSTEM_OFF, contact: { lastFirstContactAt: null },
});
function screen(payload: MetaLeadDetail, r: MetaReqFixture) {
  const p = parseLead(payload);
  return screenLead({ parsedAge: p.age, parsedEducation: p.education, parsedExperienceYr: p.experienceYears, parsedGender: p.gender, rawFields: p.rawFields },
    { metaTargetAgeMin: r.ageMin, metaTargetAgeMax: r.ageMax, educationRequirement: r.education, experienceMinYears: r.expMin, experienceMaxYears: r.expMax, screeningConfig: r.config });
}

describe("legacy parity with Meta screening (screenLead)", () => {
  it("every fixture pair: qualified <=> pass|review, disqualified <=> fail, and the first failing reason is the screener's own text", () => {
    for (const r of META_REQS) {
      const c = compileCriteria(metaRow(r));
      for (const l of META_LEADS) for (const kind of ["meta_live", "meta_old"] as const) {
        const s = screen(l.payload, r);
        const e = evaluate(normaliseFacts(metaPerson(l.payload, kind), NOW), c, NOW);
        const label = `${r.name} | ${l.name} | ${kind}`;
        expect(e.verdict === "fail", label).toBe(!s.qualified);
        if (!s.qualified) expect(e.failed[0].actualText, label).toBe(s.reason);
      }
    }
  });

  it("600 generated Meta forms against every requisition config agree too", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
    const answers = { age: ["", "17", "22", "36", "45", "18-25"], qualification: ["", "graduate", "12th", "below_12th", "diploma", "post_graduate", "xyz"], experience: ["", "0", "6 months", "2 years", "fresher"],
      gender: ["", "Male", "Female", "M", "female"], are_you_a_graduate: ["", "Yes", "No", "maybe"], can_travel_noida: ["", "yes", "no", "can_relocate"],
      do_you_have_a_valid_dra_certificate: ["", "Yes", "No", "not sure"], languages_you_can_speak: ["", "Hindi", "English", "Hindi, English"], typing_speed_wpm: ["", "20", "30 wpm", "fast"],
      written_english_level: ["", "basic", "Intermediate", "advanced", "good"], months_of_experience: ["", "3", "12"], city: ["", "Noida", "Surat"] };
    for (let i = 0; i < 600; i++) {
      const fields = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, pick(v)]).filter(([, v]) => v));
      const payload: MetaLeadDetail = { id: `g${i}`, field_data: Object.entries({ phone_number: "9876543210", ...fields }).map(([name, v]) => ({ name, values: [v as string] })) };
      for (const r of META_REQS) {
        const s = screen(payload, r);
        const e = evaluate(normaliseFacts(metaPerson(payload, "meta_live"), NOW), compileCriteria(metaRow(r)), NOW);
        expect(e.verdict === "fail", `${r.name} ${JSON.stringify(fields)}`).toBe(!s.qualified);
        if (!s.qualified) expect(e.failed[0].actualText).toBe(s.reason);
      }
    }
  });
});

describe("legacy parity with the drive line-up (SQL location filter + eligibility gate + strict scoreLead)", () => {
  const heRow = (k: "A" | "B" | "C") => toCriteriaRow({ ...HE_REQS[k], requisition_code: k });
  it("pass <=> lined up, for 400 generated pool leads x 3 requisitions", () => {
    let lined = 0, notLined = 0;
    for (const k of ["A", "B", "C"] as const) {
      const req = HE_REQS[k];
      const c = compileCriteria(heRow(k));
      const mreq = { ...legacyMatchRequisition(req as never), strict: true };
      for (const L of generateHeLeads(400)) {
        const f = normaliseFacts({ sourceKind: "he", subSource: "pool_other", mobile: String(L.lead.mobile10), ats: null, lead: L.lead, profile: L.profile, meta: null, dra: null,
          system: { ...SYSTEM_OFF, eligibility: { ok: L.gateOk, blocks: L.gateOk ? [] : ["opted_out"], priority: 1 } }, contact: { lastFirstContactAt: null } }, NOW);
        const sqlLocation = placedInBranchArea(L.lead.locality as string | null, String(req.branch_name), req.bcity as string);
        const sqlPre = (mreq.minEducationRank == null || (L.lead.education_rank != null && Number(L.lead.education_rank) >= mreq.minEducationRank))
          && (mreq.ageMin == null || (L.lead.age != null && Number(L.lead.age) >= mreq.ageMin)) && (mreq.ageMax == null || (L.lead.age != null && Number(L.lead.age) <= mreq.ageMax))
          && (mreq.nightShift !== true || Number(L.lead.night_shift_ok) === 1);
        const lineUp = sqlLocation && sqlPre && L.gateOk && scoreLead(f.match, mreq).eligible;
        const e = evaluate(f, c, NOW);
        expect(e.verdict === "pass", `${k} ${L.id} ${JSON.stringify(L)}`).toBe(lineUp);
        if (lineUp) lined++; else notLined++;
      }
    }
    expect(lined).toBeGreaterThan(5); // the generator exercises both sides
    expect(notLined).toBeGreaterThan(100);
  });
});
