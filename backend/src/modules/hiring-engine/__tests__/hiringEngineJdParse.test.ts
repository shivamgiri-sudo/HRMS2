import { describe, expect, it } from "vitest";
import { parseJdText } from "../he-jd-parse.js";

describe("JD free text -> rules", () => {
  it("reads common requisition phrasing", () => {
    const r = parseJdText("Fluent English and Hindi communication. DRA certified preferred. Typing 30 wpm. Night shift. 1+ years of experience in collections.");
    expect(r.languages).toEqual(expect.arrayContaining(["english", "hindi"]));
    expect(r.certifications).toEqual(["DRA"]);
    expect(r).toMatchObject({ minTypingWpm: 30, nightShift: true, minExperienceYears: 1 });
  });
  it("gender only when explicit; freshers; empty text", () => {
    expect(parseJdText("Female candidates only, freshers welcome").gender).toBe("female");
    expect(parseJdText("Female candidates only, freshers welcome").minExperienceYears).toBe(0);
    expect(parseJdText("Good communication skills").languages).toEqual([]);
    expect(parseJdText("Male or female").gender).toBeNull();
    expect(parseJdText(null).languages).toEqual([]);
  });
});

describe("education from JD text", () => {
  it("reads the level", () => {
    expect(parseJdText("Graduation with good typing speed").minEducationRank).toBe(5);
    expect(parseJdText("12th pass, Hindi").minEducationRank).toBe(3);
    expect(parseJdText("Graduate preferred").minEducationRank).toBeNull();
    expect(parseJdText("Good communication").minEducationRank).toBeNull();
  });
});

describe("education 'preferred' wording", () => {
  it("a Preferred Skills heading does not make education optional", async () => {
    const { parseJdText } = await import("../he-jd-parse.js");
    expect(parseJdText("Female candidates only. Graduation required.\nPreferred Skills:\n- BPO").minEducationRank).toBe(5);
    expect(parseJdText("Graduate preferred").minEducationRank).toBeNull();
    expect(parseJdText("Female candidates only").gender).toBe("female");
  });
});
