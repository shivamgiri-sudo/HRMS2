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
