import { describe, expect, it } from "vitest";
import { statusLabelFor } from "../NativeHelpdesk";

describe("statusLabelFor", () => {
  it("uses ESIC wording for ESIC tickets", () => {
    expect(statusLabelFor("open", "hr_benefits_esic_card_issue")).toBe("Submitted");
    expect(statusLabelFor("pending_info", "payroll_esic_deduction_query")).toBe("Pending Information");
    expect(statusLabelFor("resolved", "hr_benefits_esic_card_issue")).toBe("Completed");
  });

  it("leaves every other ticket's wording alone", () => {
    expect(statusLabelFor("in_progress", "hr_benefits_gratuity_query")).toBe("in progress");
    expect(statusLabelFor("resolved")).toBe("resolved");
  });
});
