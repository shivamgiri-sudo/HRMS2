import { describe, expect, it } from "vitest";
import { metaAnswerFacts } from "../meta-answer-facts.js";

const NIGHT = "this_role_includes_night_shifts_are_you_willing_and_able_to_work_night_shifts";

describe("metaAnswerFacts", () => {
  it.each([["Yas", true], ["Yes", true], ["No", false], ["nahi", false], ["maybe", null]])("night shift answer %s -> %s", (a, v) => {
    const f = metaAnswerFacts({ [NIGHT]: a });
    expect(f.nightShiftOk?.value).toBe(v);
    expect(f.nightShiftOk?.quality).toBe(v === null ? "ambiguous" : "ok");
  });
  it("graduate yes -> rank 5; no -> not known (below graduate is not a rank)", () => {
    expect(metaAnswerFacts({ are_you_a_graduate: "Yes" }).educationRank).toMatchObject({ value: 5, quality: "ok" });
    expect(metaAnswerFacts({ are_you_a_graduate: "No" }).educationRank).toMatchObject({ value: null, quality: "ambiguous" });
  });
  it("relocation / can travel / work from our location", () => {
    expect(metaAnswerFacts({ can_travel_noida: "can_relocate" }).relocationOk?.value).toBe(true);
    expect(metaAnswerFacts({ can_travel_noida: "no" }).relocationOk?.value).toBe(false);
    expect(metaAnswerFacts({ can_you_work_from_our_ahmedabad_location: "yes" }).relocationOk?.value).toBe(true);
  });
  it("certificates: DRA yes declared, no -> empty list, ambiguous -> ambiguous", () => {
    expect(metaAnswerFacts({ do_you_have_a_valid_dra_certificate: "Yes" }).certificates).toMatchObject({ value: [{ code: "DRA", level: "declared" }], quality: "ok" });
    expect(metaAnswerFacts({ do_you_have_a_valid_dra_certificate: "No" }).certificates).toMatchObject({ value: [], quality: "ok" });
    expect(metaAnswerFacts({ do_you_have_a_valid_dra_certificate: "maybe" }).certificates?.quality).toBe("ambiguous");
    expect(metaAnswerFacts({ do_you_have_a_valid_dra_certificate: "applied, not yet" }).certificates?.value).toEqual([]); // the screener reads this as no
  });
  it("typing, English and months of experience", () => {
    const f = metaAnswerFacts({ typing_speed_wpm: "32 wpm", written_english_level: "Intermediate", months_of_experience: "18" });
    expect(f.typingWpm?.value).toBe(32);
    expect(f.englishLevel?.value).toBe(2);
    expect(f.experienceYears?.value).toBe(1.5);
  });
  it("no matching questions -> no facts", () => expect(metaAnswerFacts({ full_name: "A" })).toEqual({}));
});
