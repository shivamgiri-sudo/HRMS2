/**
 * Every placeholder in every candidate-facing document must resolve to something.
 *
 * Two defects reached a signed contract because nothing checked this. The parties
 * clause printed the template's own unresolved choice, "s/o | d/o", and the
 * remuneration printed "Rs. 0 (Rupees Zero only)". Neither was visible to the
 * type checker, and neither breaks the render: an unmatched `{{token}}` still
 * gets a field map, just with a null source_path, so nothing populates it and
 * the page prints a blank where a name or a date belongs.
 *
 * The rule this pins is the one buildFieldMapsFromTemplate actually applies —
 * a token is filled iff matchPlaceholderField() finds an entry for it that has
 * a source_path. Adding a token to a template without wiring it now fails here.
 *
 * Verified against production first: MAS63085's six documents were dumped and
 * every token except surveillance_hr_name did have a persisted value, so this
 * asserts a rule the live data already satisfies rather than inventing one.
 */
import { describe, it, expect } from "vitest";
import { TEMPLATE_DEFINITIONS, templateTokens } from "../joiningDocumentTemplates.js";
import { matchPlaceholderField } from "../universalDigitalFormFill.service.js";

/**
 * Injected by joiningDocumentPdf.service at render time from the branch
 * letterhead and the company constant, not from a field value.
 */
const RENDERER_INJECTED = new Set(["branch_address", "branch_name", "company_registered_office"]);

/**
 * Tokens deliberately left for a human to complete on the printed page. Each
 * needs a reason; an empty reason is not an exemption.
 */
const COMPLETED_BY_HAND: Record<string, string> = {
  surveillance_hr_name:
    "countersigned by whichever HR witnesses the declaration, which is not known when the document is rendered",
};

const CODES = TEMPLATE_DEFINITIONS.map((entry) => entry.code);

describe("template token coverage", () => {
  it("covers every structured document", () => {
    expect(CODES).toEqual(expect.arrayContaining([
      "EMPLOYMENT_CONTRACT", "NDA_CONFIDENTIALITY", "IT_COMPLIANCE",
      "BAMS_DECLARATION", "PI_PROCESSING_CONSENT", "ZERO_TOLERANCE_ACK",
    ]));
  });

  for (const code of CODES) {
    it(`${code}: every token is backed by a field with a source`, () => {
      const unresolved = templateTokens(code).filter((token) => {
        if (RENDERER_INJECTED.has(token) || token in COMPLETED_BY_HAND) return false;
        return !matchPlaceholderField(token)?.source_path;
      });

      expect(unresolved, `${code} would render these as empty strings: ${unresolved.join(", ")}`).toEqual([]);
    });
  }

  it("the employment contract no longer ships an unresolved s/o | d/o", () => {
    expect(templateTokens("EMPLOYMENT_CONTRACT")).toContain("relation_prefix");

    // The literal is what printed on a real signed contract. It may only reach
    // the page as a deliberate fallback for an unknown gender, never as template
    // text that no code path can resolve.
    const blocks = JSON.stringify(TEMPLATE_DEFINITIONS.find((e) => e.code === "EMPLOYMENT_CONTRACT")?.blocks);
    expect(blocks).not.toContain("s/o | d/o");
  });

  it("the contract states a remuneration in both figures and words", () => {
    const tokens = templateTokens("EMPLOYMENT_CONTRACT");
    expect(tokens).toContain("monthly_remuneration");
    expect(tokens).toContain("monthly_remuneration_words");
  });

  it("the contract carries the branch address as well as the registered office", () => {
    const tokens = templateTokens("EMPLOYMENT_CONTRACT");
    expect(tokens).toContain("branch_address");
    expect(tokens).toContain("company_registered_office");
  });

  it("every hand-completed exemption states why", () => {
    for (const [token, reason] of Object.entries(COMPLETED_BY_HAND)) {
      expect(reason.length, `${token} is exempted without a reason`).toBeGreaterThan(20);
    }
  });
});
