import { describe, expect, it } from "vitest";
import { extractProfile, parseSalary } from "../he-profile.js";
import { scoreLead } from "../he-matcher.js";

describe("profile extraction from form answers", () => {
  it("reads clear answers, leaves ambiguity unknown", () => {
    const p = extractProfile({ gender: "Female", can_you_speak_english: "Yes", do_you_have_dra_certificate: "yes", typing_speed_wpm: "35-40", written_english_level: "Intermediate", expected_salary: "18k" });
    expect(p).toMatchObject({ gender: "female", certifications: ["DRA"], typingWpm: 35, englishLevel: "intermediate", salaryExpectation: 18000 });
    expect(p.languages).toContain("english");
    expect(extractProfile({ do_you_have_dra_certificate: "No" }).certifications).toEqual([]);
    expect(extractProfile({ city: "Noida" })).toMatchObject({ gender: null, languages: null, certifications: null });
    expect(extractProfile({ languages_known: "Hindi, Marathi" }).languages).toEqual(["hindi", "marathi"]);
  });
  it("salary parsing", () => {
    expect(parseSalary("2.4 LPA")).toBe(20000);
    expect(parseSalary("15,000")).toBe(15000);
    expect(parseSalary("25")).toBeNull();
  });
});

describe("JD-aware scoring", () => {
  const req = { gender: "female" as const, languages: ["english"], certifications: ["DRA"], minTypingWpm: 30, englishLevel: "intermediate" as const, salaryMax: 18000 };
  it("hard fails gender and language; soft-penalises certification, typing, english, salary", () => {
    expect(scoreLead({ gender: "male" }, req).eligible).toBe(false);
    expect(scoreLead({ gender: "female", languages: ["hindi"] }, req).eligible).toBe(false);
    const full = scoreLead({ gender: "female", languages: ["english"], certifications: ["DRA"], typingWpm: 40, englishLevel: "advanced", salaryExpectation: 17000 }, req);
    const weak = scoreLead({ gender: "female", languages: ["english"], certifications: [], typingWpm: 20, englishLevel: "basic", salaryExpectation: 30000 }, req);
    expect(full.eligible && weak.eligible).toBe(true);
    expect(full.score).toBeGreaterThan(weak.score);
    expect(weak.reasons.join(" ")).toMatch(/DRA/);
  });
  it("thin records rank below proven fits through confidence", () => {
    const thin = scoreLead({}, req);
    const proven = scoreLead({ gender: "female", languages: ["english"], certifications: ["DRA"], typingWpm: 35, englishLevel: "intermediate" }, req);
    expect(thin.eligible).toBe(true);
    expect(thin.confidence).toBeLessThan(0.3);
    expect(proven.rankScore).toBeGreaterThan(thin.rankScore);
  });
});

describe("strict drive shortlists", () => {
  it("required certification and education must be confirmed", () => {
    const req = { certifications: ["DRA"], minEducationRank: 5, strict: true };
    expect(scoreLead({ certifications: ["DRA"], educationRank: 5 }, req).eligible).toBe(true);
    expect(scoreLead({ certifications: [], educationRank: 5 }, req).eligible).toBe(false);
    expect(scoreLead({ educationRank: 5 }, req).reasons.join(" ")).toMatch(/not confirmed: certifications/);
    expect(scoreLead({ certifications: ["DRA"] }, req).eligible).toBe(false);
    expect(scoreLead({}, { certifications: ["DRA"] }).eligible).toBe(true); // non-strict stays lenient
  });
  it("experience minimum is hard when strict", () => {
    expect(scoreLead({ experienceYears: 0.5 }, { minExperienceYears: 1, strict: true }).eligible).toBe(false);
    expect(scoreLead({ experienceYears: 0.5 }, { minExperienceYears: 1 }).eligible).toBe(true);
  });
});

describe("strict drive shortlists: skills, salary and JD wording", () => {
  it("skills on record but none of the mandatory ones -> out; no skills text stays neutral", () => {
    const req = { mandatorySkills: ["Good Communication", "Sale Experience"], strict: true };
    expect(scoreLead({ skillsText: "Data entry, MS Excel" }, req).eligible).toBe(false);
    expect(scoreLead({ skillsText: "telesales, english" }, req).eligible).toBe(true);
    expect(scoreLead({}, req).eligible).toBe(true);
  });
  it("stated salary 25%+ above the JD -> out; inferred salary only lowers rank", () => {
    expect(scoreLead({ salaryExpectation: 33000 }, { salaryMax: 18000, strict: true }).eligible).toBe(false);
    expect(scoreLead({ salaryExpectation: 20000 }, { salaryMax: 18000, strict: true }).eligible).toBe(true);
    expect(scoreLead({ lastSalary: 30000 }, { salaryMax: 18000, strict: true }).eligible).toBe(true);
  });
});
