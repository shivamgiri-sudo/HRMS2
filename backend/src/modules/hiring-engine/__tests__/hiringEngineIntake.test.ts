import { describe, expect, it } from "vitest";
import { detectColumns, headerSignature, mapIntakeRows, parseAgeFromDob, parseExperienceYears, parseMoney } from "../he-intake.js";

// Header layouts in the style of common Indian job portals. Exact headers differ per account/export; the point is
// that different names for the same fact all land in the same field.
const workIndia = [
  { "Candidate Name": "Ravi Kumar", "Mobile Number": "9876543210", "Alternate Number": "9123456780", "Gender": "Male", "Age": "24", "Highest Qualification": "12th Pass",
    "Total Experience": "1 Year 6 Months", "Current City": "Noida", "Languages Known": "Hindi, English", "Expected Salary": "15000", "Job Title": "Telecaller", "Applied On": "05/10/2026" },
  { "Candidate Name": "Sita Devi", "Mobile Number": "+91 98765 43211", "Alternate Number": "", "Gender": "Female", "Age": "22", "Highest Qualification": "Graduate",
    "Total Experience": "Fresher", "Current City": "Delhi", "Languages Known": "Hindi", "Expected Salary": "12k", "Job Title": "Telecaller", "Applied On": "05/10/2026" },
];
const naukri = [
  { "Name": "Amit Shah", "Email ID": "amit@x.in", "Phone Number": "9988776655", "Date of Birth": "15/08/2000", "Total Exp. (Years)": "3", "UG Degree": "B.Com",
    "Current Location": "Gurgaon", "Key Skills": "Collections, DRA certified, Excel", "Current CTC": "3.6 Lacs", "Expected CTC": "4.2 LPA" },
];
const apna = [
  { "Applicant Name": "Pooja", "Contact No.": "98111-22334", "Sex": "F", "Education Level": "10th", "Experience (in months)": "18", "Area": "Sector 62", "Pin Code": "201301", "Job Applied": "Back Office" },
];
const noHeaders = [
  { A: "Neha", B: "9811122335", C: "neha@y.com", D: "Female" },
  { A: "Rohit", B: "9811122336", C: "rohit@y.com", D: "Male" },
  { A: "Kiran", B: "9811122337", C: "kiran@y.com", D: "F" },
];

describe("portal header recognition", () => {
  it("WorkIndia-style export: every field recognised, alt number + languages + salary parsed", () => {
    const d = detectColumns(workIndia);
    expect(d.mapping).toMatchObject({ name: "Candidate Name", mobile: "Mobile Number", altMobile: "Alternate Number", gender: "Gender", age: "Age",
      education: "Highest Qualification", experience: "Total Experience", city: "Current City", languages: "Languages Known", expectedSalary: "Expected Salary", process: "Job Title" });
    const r = mapIntakeRows(workIndia).rows;
    expect(r[0]).toMatchObject({ ok: true, mobile10: "9876543210", altMobile10: "9123456780", gender: "male", age: 24, experienceYears: 1.5, languages: ["english", "hindi"], expectedSalary: 15000 });
    expect(r[1]).toMatchObject({ mobile10: "9876543211", experienceYears: 0, expectedSalary: 12000, gender: "female" });
  });
  it("Naukri-style export: email, DOB -> age, years, skills, annual CTC -> monthly", () => {
    const d = detectColumns(naukri);
    expect(d.mapping).toMatchObject({ name: "Name", email: "Email ID", mobile: "Phone Number", dob: "Date of Birth", education: "UG Degree", city: "Current Location", skills: "Key Skills", currentSalary: "Current CTC", expectedSalary: "Expected CTC" });
    const r = mapIntakeRows(naukri).rows[0];
    expect(r.age).toBeGreaterThanOrEqual(25);
    expect(r).toMatchObject({ experienceYears: 3, expectedSalary: 35000 });
  });
  it("Apna-style export: months of experience, pincode, short gender", () => {
    const r = mapIntakeRows(apna).rows[0];
    expect(r).toMatchObject({ ok: true, mobile10: "9811122334", gender: "female", experienceYears: 1.5, pincode: "201301", process: "Back Office" });
  });
  it("headers that say nothing: recognised from the values", () => {
    const d = detectColumns(noHeaders);
    expect(d.mapping).toMatchObject({ mobile: "B", email: "C", gender: "D" });
  });
  it("never takes a recruiter / reference phone as the candidate's", () => {
    const d = detectColumns([{ "Recruiter Mobile": "9000000001", "Candidate Contact": "9000000002", "Candidate Name": "X" }]);
    expect(d.mapping.mobile).toBe("Candidate Contact");
  });
  it("two numbers in one cell, saved mapping wins, same layout -> same signature", () => {
    const rows = [{ "Phone": "9811100001 / 9811100002", "Full Name": "Y" }];
    expect(mapIntakeRows(rows).rows[0]).toMatchObject({ mobile10: "9811100001", altMobile10: "9811100002" });
    expect(detectColumns([{ X: "9811100001", Y: "a" }], { mobile: "X", name: "Y" }).guesses[0].reason).toBe("saved mapping");
    expect(headerSignature(["Mobile No", "Name"])).toBe(headerSignature(["name", "mobile_no"]));
  });
  it("needs some mobile column", () => expect(mapIntakeRows([{ name: "x" }]).missingColumns).toEqual(["mobile"]));
});

describe("value parsing", () => {
  it("experience / dob / money", () => {
    expect(parseExperienceYears("2 yrs 3 months")).toBe(2.3);
    expect(parseExperienceYears("18", true)).toBe(1.5);
    expect(parseExperienceYears("1-2 years")).toBe(1);
    expect(parseAgeFromDob("2000-08-15", new Date("2026-10-05"))).toBe(26);
    expect(parseMoney("2.4 LPA")).toBe(20000);
    expect(parseMoney("300000")).toBe(25000);
    expect(parseMoney("25")).toBeNull();
  });
});

import { isoDob, parseEducationStatus, parseIndustry, parseStream } from "../he-intake.js";
import { industriesForProcess, scoreLead } from "../he-matcher.js";
describe("portal screening facts", () => {
  const rows = [{ "Name": "Kavya", "Mobile": "9811100011", "Date Of Birth": "12-03-2002", "Qualification": "B.Com", "Education Status": "Pursuing (Final Year)", "Stream": "Commerce",
    "Previous Company": "Teleperformance", "Last Designation": "Customer Care Executive", "Last Drawn Salary": "14,500", "State": "Uttar Pradesh", "City": "Noida", "Address": "B-12, Sector 62" }];
  it("maps and parses DOB, education status, stream, previous industry, last salary, state, address", () => {
    const d = detectColumns(rows);
    expect(d.mapping).toMatchObject({ dob: "Date Of Birth", educationStatus: "Education Status", stream: "Stream", lastEmployer: "Previous Company", prevRole: "Last Designation", currentSalary: "Last Drawn Salary", state: "State", address: "Address" });
    const r = mapIntakeRows(rows).rows[0];
    expect(r).toMatchObject({ dob: "2002-03-12", educationStatus: "pursuing", stream: "commerce", prevIndustry: "bpo", lastSalary: 14500, state: "Uttar Pradesh", address: "B-12, Sector 62", lastEmployer: "Teleperformance" });
  });
  it("parsers", () => {
    expect(parseEducationStatus(null, "12th appearing")).toBe("pursuing");
    expect(parseEducationStatus("Completed", "BA")).toBe("completed");
    expect(parseEducationStatus(null, "Graduation dropout")).toBe("dropped");
    expect(parseStream(null, "BCA")).toBe("it_engineering");
    expect(parseIndustry("Banking", null)).toBe("bfsi");
    expect(parseIndustry(null, "Recovery agent")).toBe("collections");
    expect(isoDob("05/10/1999")).toBe("1999-10-05");
    expect(isoDob("31/13/2000")).toBeNull();
  });
  it("screening uses them", () => {
    const req = { minEducationRank: 5, goodIndustries: industriesForProcess("SBI Card Collections"), salaryMax: 15000, branchCity: "Noida", branchState: "Uttar Pradesh", streams: ["commerce"] };
    const strong = scoreLead({ educationRank: 5, educationStatus: "completed", prevIndustry: "collections", lastSalary: 12000, city: "Noida", stream: "commerce" }, req);
    const weak = scoreLead({ educationRank: 5, educationStatus: "pursuing", prevIndustry: "retail", lastSalary: 25000, state: "Bihar", stream: "arts" }, req);
    expect(strong.score).toBeGreaterThan(weak.score + 30);
    expect(strong.reasons.join(" ")).toMatch(/collections experience|same city/);
    expect(weak.reasons.join(" ")).toMatch(/still pursuing/);
    expect(weak.reasons.join(" ")).toMatch(/Bihar/);
    expect(scoreLead({ educationRank: 5, educationStatus: "dropped" }, req).eligible).toBe(false);
  });
});

import { parseNightShift } from "../he-intake.js";
describe("night shift column", () => {
  it("parses common answers", () => {
    expect(parseNightShift("Yes")).toBe(true); expect(parseNightShift("Rotational")).toBe(true); expect(parseNightShift("Any shift")).toBe(true);
    expect(parseNightShift("Day shift only")).toBe(false); expect(parseNightShift("No")).toBe(false); expect(parseNightShift("")).toBeNull();
  });
  it("is mapped from a portal header", () => {
    const r = mapIntakeRows([{ Name: "X", Mobile: "9811100099", "Shift Preference": "Night" }]).rows[0];
    expect(r.nightShiftOk).toBe(true);
  });
});

describe("ragged rows", () => {
  it("finds the mobile column even when the first row lacks it", async () => {
    const { detectColumns } = await import("../he-intake.js");
    const r = detectColumns([{ "Candidate Name": "No Mobile" }, { "Candidate Name": "B", "Mobile Number": "9000070002" }]);
    expect(r.mapping.mobile).toBe("Mobile Number");
  });
});

describe("email and age cleaning", () => {
  it("keeps only plausible emails", async () => {
    const { validEmail } = await import("../he-intake.js");
    expect(validEmail(" Rahul@Mail.COM ")).toBe("rahul@mail.com");
    for (const bad of ["not-an-email", "a@b", "a b@c.com", "", null, "x@y.c"]) expect(validEmail(bad)).toBeNull();
  });
  it("reads '26 yrs' as an age and drops a bad email on the row", async () => {
    const { mapIntakeRows } = await import("../he-intake.js");
    const { rows } = mapIntakeRows([{ Mobile: "9000070005", Age: "26 yrs", Email: "oops" }]);
    expect(rows[0]).toMatchObject({ ok: true, age: 26, email: null });
  });
});
