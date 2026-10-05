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
    expect(templateVars("he_reminder_1d", "en")).toEqual(["candidate_name", "role", "slot_time", "branch_name", "docs_list", "maps_link"]);
  });
  it("builds in order and refuses a missing value", () => {
    expect(buildParams("he_optout_ack", "en", { candidate_name: "Rahul" })).toEqual(["Rahul"]);
    expect(() => buildParams("he_walkin_confirmed", "hi", { candidate_name: "Rahul" })).toThrow(/missing drive_date/);
  });
  it("collapses newlines in values", () => expect(buildParams("he_optout_ack", "en", { candidate_name: "A\nB" })).toEqual(["A B"]));
  it("renders", () => expect(renderBody("he_optout_ack", "en", { candidate_name: "Rahul" })).toContain("Understood Rahul."));
  it("location template has the dynamic URL button", () => expect(getTemplate("he_reminder_2h_location").buttons.en.some((b) => b.startsWith("URL:"))).toBe(true));
});
