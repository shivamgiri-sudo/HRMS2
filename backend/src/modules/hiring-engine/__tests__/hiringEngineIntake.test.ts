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
