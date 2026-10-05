import { describe, it, expect } from "vitest";
import { renderIncrementLetter, renderPromotionLetter, renderExperienceLetter, renderAppointmentLetter } from "../letters-render.service.js";

const D = {
  full_name: "Test Employee", employee_code: "MAS1", issued_date: "2026-10-05", designation: "Agent",
  branch_name: "NOIDA", branch_address: "Okaya Centre\nNoida", branch_hr_contact: "hr@teammas.in",
  date_of_joining: "2025-01-01", date_of_exit: "2026-09-30",
  effective_date: "1 Jul 2026", revised_ctc: "1,99,056", revised_fixed_ctc: "1,99,056", total_tctc: "1,99,056", variable_pay: "",
  new_designation: "Team Lead", new_department: "Ops",
};
const LOGO = "https://x.test/mcn-logo.png";

describe.each([
  ["increment", renderIncrementLetter, "INCREMENT LETTER"],
  ["promotion", renderPromotionLetter, "PROMOTION LETTER"],
  ["experience", renderExperienceLetter, "EXPERIENCE CERTIFICATE"],
])("%s letter uses the standard frame", (_name, render, subject) => {
  const html = render(D, LOGO);
  it("has the MAS logo, header, dated line, Subject line and branch footer like the appointment letter", () => {
    expect(html).toContain(`src="${LOGO}"`);
    expect(html).toContain("Mas Callnet India Pvt. Ltd.");
    expect(html).toContain("Date : 2026-10-05");
    expect(html).toContain("Subject :");
    expect(html).toContain(subject);
    expect(html).toContain("E-mail : hr@teammas.in");
    expect(html).toContain("For Mas Callnet India Pvt. Ltd.");
  });
  it("has no hardcoded address or signatory person", () => {
    expect(html).not.toContain("Okaya Center, Noida Sector");
    expect(html).not.toContain("Sheelu");
    expect(html).toContain("Authorized Signatory");
  });
});

describe("increment letter figures", () => {
  it("prints the supplied approved figures, derives the financial year from the effective date, hides an empty variable-pay row", () => {
    const html = renderIncrementLetter(D, LOGO);
    expect(html).toContain("Rs 1,99,056/-");
    expect(html).toContain("Financial Year 2026-27");
    expect(html).toContain("Annual Performance Evaluation for the year 2025-26");
    expect(html).not.toContain("Performance Linked Variable Pay");
  });
});

describe("addressing", () => {
  it("increment and promotion address the employee; experience is To Whomsoever it May Concern", () => {
    expect(renderIncrementLetter(D, LOGO)).toContain("EMP Code - MAS1");
    expect(renderPromotionLetter(D, LOGO)).toContain("Dear Test Employee,");
    const exp = renderExperienceLetter(D, LOGO);
    expect(exp).toContain("To Whomsoever it May Concern");
    expect(exp).not.toContain("Dear Test Employee");
  });
  it("the appointment letter itself is unchanged in structure", () => {
    const html = renderAppointmentLetter({ ...D, basic: "1.00" }, LOGO);
    expect(html).toContain("APPOINTMENT LETTER");
    expect(html).toContain("Subject :");
  });
});
