import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The appointment letter's "Salary Date" (3.1) and closing reference date both
 * printed employees.date_of_joining — the Salary Date line was labelled
 * correctly but fed the wrong column, and the closing line was literally
 * "Date of Joining:" while what it meant on this document is when salary
 * actually starts, which is employees.salary_start_date and can differ from
 * the join date (ats.onboarding.service.ts guards salary_start_date >=
 * joining_date, so the two are not interchangeable).
 */
const pdf = readFileSync(
  resolve(process.cwd(), "src/modules/letters/appointmentLetterPdf.service.ts"),
  "utf8",
);
const issue = readFileSync(
  resolve(process.cwd(), "src/modules/letters/appointmentLetterIssue.service.ts"),
  "utf8",
);
const routes = readFileSync(
  resolve(process.cwd(), "src/modules/letters/appointmentLetter.routes.ts"),
  "utf8",
);

describe("Appointment letter — Salary Date uses salary_start_date, not date_of_joining", () => {
  it("AppointmentLetterInput carries salaryStartDate", () => {
    expect(pdf).toContain("salaryStartDate: Date | string | null;");
  });

  it("the Salary Date line reads salaryStartDate (falling back to dateOfJoining)", () => {
    expect(pdf).toContain("3.1 Salary Date: ${istDisplayDate(input.salaryStartDate ?? input.dateOfJoining)}");
  });

  it("the closing reference date is now labelled and sourced as Salary Start Date", () => {
    expect(pdf).toContain("Salary Start Date: ${istDisplayDate(input.salaryStartDate ?? input.dateOfJoining)}");
    expect(pdf).not.toMatch(/Date of Joining: \$\{istDisplayDate\(input\.dateOfJoining\)\}/);
  });

  it("every renderAppointmentLetterPdf caller fetches and passes salary_start_date", () => {
    for (const [label, src] of [["appointmentLetterIssue.service.ts", issue], ["appointmentLetter.routes.ts", routes]] as const) {
      expect(src, `${label} must select e.salary_start_date`).toContain("e.salary_start_date");
      expect(src, `${label} must pass salaryStartDate into renderAppointmentLetterPdf`).toContain("salaryStartDate:");
    }
  });
});
