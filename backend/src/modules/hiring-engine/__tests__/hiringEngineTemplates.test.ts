import { describe, expect, it } from "vitest";
import { buildParams, getTemplate, HE_TEMPLATES, renderBody, templateVars } from "../he-template-catalog.js";

describe("template catalog obeys Meta body rules", () => {
  for (const t of HE_TEMPLATES) for (const lang of ["hi", "en"] as const) {
    it(`${t.key} (${lang})`, () => {
      const b = t.body[lang];
      expect(b.length).toBeLessThan(1024);
      expect(/^\s*\{/.test(b)).toBe(false);
      expect(/\}\s*$/.test(b)).toBe(false);
      expect(/\}\s*\{/.test(b)).toBe(false);
      expect(templateVars(t.key, lang).length).toBeGreaterThan(0);
    });
  }
  it("has 11 templates", () => expect(HE_TEMPLATES.length).toBe(11));
});

describe("params", () => {
  it("slot order is per language", () => {
    expect(templateVars("he_reminder_1d", "hi")).toEqual(["candidate_name", "slot_time", "branch_name", "role", "docs_list", "maps_link"]);
    expect(templateVars("he_reminder_1d", "en")).toEqual(["candidate_name", "role", "drive_date", "slot_time", "branch_name", "docs_list", "maps_link"]);
  });
  it("builds in order and refuses a missing value", () => {
    expect(buildParams("he_optout_ack", "en", { candidate_name: "Rahul" })).toEqual(["Rahul"]);
    expect(() => buildParams("he_walkin_confirmed", "hi", { candidate_name: "Rahul" })).toThrow(/missing drive_date/);
  });
  it("collapses newlines in values", () => expect(buildParams("he_optout_ack", "en", { candidate_name: "A\nB" })).toEqual(["A B"]));
  it("renders", () => expect(renderBody("he_optout_ack", "en", { candidate_name: "Rahul" })).toContain("Candidate: Rahul"));
  it("location template buttons are quick replies (no URL button) as approved", () => expect(getTemplate("he_reminder_2h_location").buttons.en).toEqual(["I'm on my way", "My Location"]));
});

describe("Meta-approved English templates (T1-T11)", () => {
  it("every English template carries its approved name, in T-order", () => {
    expect(HE_TEMPLATES.map((t) => t.metaName.en)).toEqual(["t1_he_walkin_invitation", "t2_he_appointment_confirmed", "t3_he_reminder_1d", "t4_he_reminder_2h_location",
      "t5_he_reschedule_offer", "t6_he_no_show_recovery", "t7_he_other_role_offer", "t8_he_winback", "t9_he_missed_call", "t10_he_optout_ack", "t11_he_hr_arrival_alert"]);
  });
  it("{{n}} order follows the approved body text (T1 {{1}} is the candidate name, 9 variables)", () => {
    expect(templateVars("he_walkin_invite", "en")).toEqual(["candidate_name", "role", "company", "drive_date", "slot_time", "branch_address", "maps_link", "assessment_link", "docs_list"]);
    expect(templateVars("he_walkin_confirmed", "en")).toEqual(["candidate_name", "drive_date", "slot_time", "branch_name", "reference_id", "contact_name", "contact_phone"]);
    expect(templateVars("he_hr_arrival_alert", "en")).toEqual(["contact_name", "expected_count", "branch_name", "confirmed_count", "live_count", "board_link"]);
  });
  it("T7 and T8 stay MARKETING", () => {
    expect(getTemplate("he_other_role_offer").category).toBe("MARKETING");
    expect(getTemplate("he_winback").category).toBe("MARKETING");
  });
});
