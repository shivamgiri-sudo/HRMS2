import { describe, expect, it } from "vitest";
import { bmsScore, matchSkills, parseJdSalaryMonthly, parseStructuredJd, ratingFor } from "../he-jd-doc.js";

// The MAS "JD Format.docx" used by the BMS tool, as extracted text.
const JD = `Job Title: Sales Executive
Company: MascallNet India
Location: Noida
Employment Type: Full Time
Minimum Experience: 5 Years
Salary: 3 LPA
Job Summary:
Motivated Sales Executive with experience in sales, telesales, lead generation.
Responsibilities:
- Generate and follow up with sales leads.
Mandatory Skills:
- Good Communication, Sale Experience
Preferred Skills:
- Telesales
- Lead Generation
- Negotiation`;

describe("BMS JD format", () => {
  it("reads every field of the MAS JD format", () => {
    const j = parseStructuredJd(JD);
    expect(j).toMatchObject({ title: "Sales Executive", location: "Noida", employmentType: "Full Time", minExperience: 5, salaryMonthly: 25000 });
    expect(j.mandatorySkills).toEqual(["Good Communication", "Sale Experience"]);
    expect(j.preferredSkills).toEqual(["Telesales", "Lead Generation", "Negotiation"]);
  });
  it("salary forms", () => {
    expect(parseJdSalaryMonthly("18,000 - 22,000")).toBe(22000);
    expect(parseJdSalaryMonthly("2.4 - 3 LPA")).toBe(25000);
    expect(parseJdSalaryMonthly("20k")).toBe(20000);
  });
  it("skill matching tolerates wording", () => {
    expect(matchSkills("Sales executive, 2 yrs experience in telesales and lead-generation", ["Sale Experience", "Telesales", "Lead Generation", "Negotiation"])).toEqual(["Sale Experience", "Telesales", "Lead Generation"]);
  });
  it("BMS weighting, rating, strengths and gaps", () => {
    const j = parseStructuredJd(JD);
    const strong = bmsScore(j, { skillsText: "Good communication; sales executive with sale experience; telesales", experienceYears: 6, locationOk: true, salaryMonthly: 24000 });
    expect(strong.score).toBe(100); expect(strong.rating).toBe("Excellent Match");
    const weak = bmsScore(j, { skillsText: "data entry operator", experienceYears: 1, locationOk: false, salaryMonthly: 40000 });
    expect(weak.rating).toBe("Poor Match");
    expect(weak.gaps.join(" ")).toMatch(/Good Communication not found.*Sale Experience not found/);
    expect(weak.gaps.join(" ")).toMatch(/location|salary/);
    expect(ratingFor(70)).toBe("Strong Match");
  });
});
