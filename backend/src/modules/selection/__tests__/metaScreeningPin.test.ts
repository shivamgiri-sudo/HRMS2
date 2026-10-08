import { describe, expect, it } from "vitest";
import { parseLead } from "../../meta-campaign/meta-lead.parser.js";
import { screenLead } from "../../meta-campaign/lead-screener.service.js";
import { META_LEADS, META_REQS } from "./fixtures/meta-fixtures.js";

// PIN (S8, written before the selection engine existed): today's Meta screening of every fixture pair, exactly as
// ingest calls it (parseLead -> screenLead). Never edit this snapshot; the engine's legacy mode must agree with it.
describe("screenLead pin over the Meta fixtures", () => {
  it("qualified + reason for every requisition x lead", () => {
    const out: Record<string, { qualified: boolean; reason: string | null }> = {};
    for (const r of META_REQS) for (const l of META_LEADS) {
      const p = parseLead(l.payload);
      const res = screenLead(
        { parsedAge: p.age, parsedEducation: p.education, parsedExperienceYr: p.experienceYears, parsedGender: p.gender, rawFields: p.rawFields },
        { metaTargetAgeMin: r.ageMin, metaTargetAgeMax: r.ageMax, educationRequirement: r.education, experienceMinYears: r.expMin, experienceMaxYears: r.expMax, screeningConfig: r.config },
      );
      out[`${r.name} | ${l.name}`] = { qualified: res.qualified, reason: res.reason };
    }
    expect(out).toMatchSnapshot();
  });
});
