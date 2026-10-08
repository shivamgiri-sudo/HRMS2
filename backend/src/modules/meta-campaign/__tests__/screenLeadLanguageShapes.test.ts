import { describe, expect, it } from "vitest";
import { normaliseLanguageRequirements, screenLead } from "../lead-screener.service.js";

// language_requirements stored as plain strings (seen on the he-e2e2 rig seed) made screenLead throw
// ("lr.skills is not iterable"), which would break Meta ingest for that requisition's leads.
const input = (rawFields: Record<string, string>) => ({ parsedAge: null, parsedEducation: null, parsedExperienceYr: null, parsedGender: null, rawFields });
const req = (language_requirements: unknown) => ({
  metaTargetAgeMin: null, metaTargetAgeMax: null, educationRequirement: null, experienceMinYears: null, experienceMaxYears: null,
  screeningConfig: { language_requirements } as never,
});

describe("screenLead language requirement shapes", () => {
  it("a plain string means the language must be spoken; never throws", () => {
    expect(() => screenLead(input({}), req(["Hindi"]))).not.toThrow();
    expect(screenLead(input({ languages_you_can_speak: "Hindi, English" }), req(["Hindi"])).qualified).toBe(true);
    // existing semantics: a "can you speak Hindi" question answered without Hindi fails; an answer elsewhere that never names Hindi is skipped
    expect(screenLead(input({ can_you_speak_hindi: "No" }), req(["Hindi"]))).toMatchObject({ qualified: false, reason: expect.stringMatching(/Hindi \(speak\)/) });
    expect(screenLead(input({ languages_you_can_speak: "Gujarati" }), req(["Hindi"])).qualified).toBe(true);
    expect(screenLead(input({}), req(["Hindi"])).skipped.join()).toMatch(/language "Hindi" speak/);
  });
  it("an object without skills, a blank or a non-object entry is ignored, never thrown on", () => {
    for (const v of [[{ language: "Hindi" }], [""], [null], [42], "Hindi", null]) expect(() => screenLead(input({ languages_you_can_speak: "x" }), req(v))).not.toThrow();
    expect(screenLead(input({ languages_you_can_speak: "x" }), req([{ language: "Hindi" }])).qualified).toBe(true);
  });
  it("normaliseLanguageRequirements: one shape for the screener and the selection engine", () => {
    expect(normaliseLanguageRequirements(["Hindi", { language: "English", skills: ["read", "bogus"] }, { language: "Tamil" }, "", null, 3])).toEqual([
      { language: "Hindi", skills: ["speak"] }, { language: "English", skills: ["read"] }, { language: "Tamil", skills: [] },
    ]);
    expect(normaliseLanguageRequirements("Hindi")).toEqual([]);
  });
});
