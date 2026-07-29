/**
 * Guards the generated joining-document templates.
 *
 * A typo in a placeholder token does not fail loudly — the fill engine simply
 * leaves the text `{{token}}` in the finished document, which would then be sent
 * to a new joiner for signature. These tests make that a build failure instead.
 *
 * Templates are built in memory from the shared definitions, so this suite does
 * not depend on the generated files (which are gitignored).
 */
import { describe, it, expect } from "vitest";
import PizZip from "pizzip";
import {
  TEMPLATE_DEFINITIONS,
  buildTemplateDocx,
  templateTokens,
} from "../src/modules/employees/joiningDocumentTemplates.js";

/**
 * Field keys the fill engine knows, mirrored from COMMON_TEMPLATE_FIELDS in
 * universalDigitalFormFill.service.ts. Any token outside this set renders blank.
 */
const KNOWN_FIELD_KEYS = new Set([
  "employee_name", "employee_code", "father_name", "date_of_birth", "date_of_joining",
  "designation", "department", "branch", "process", "mobile", "email",
  "pan_masked", "aadhaar_masked", "uan", "current_date",
  "nda_employee_name", "nda_signature_date",
  "it_employee_name", "it_signature_date",
  "surveillance_candidate_name", "surveillance_hr_name", "surveillance_signature_date",
  "bams_employee_name", "bams_employee_code", "bams_date_of_joining",
  "pi_employee_name", "pi_signature_date",
  "zero_tolerance_employee_name", "zero_tolerance_signature_date",
]);

const EXPECTED = [
  "NDA_CONFIDENTIALITY",
  "IT_COMPLIANCE",
  "BAMS_DECLARATION",
  "PI_PROCESSING_CONSENT",
  "ZERO_TOLERANCE_ACK",
] as const;

function readTemplate(code: string) {
  const buffer = buildTemplateDocx(code);
  const xml = new PizZip(buffer).file("word/document.xml")?.asText() ?? "";
  return { buffer, xml, tokens: templateTokens(code) };
}

describe("joining document templates", () => {
  it("TC-TPL-01: a definition exists for each previously-missing template", () => {
    // Five of seven mandatory documents had no template file at all, so they
    // generated a placeholder stamped "DRAFT - TEMPLATE NOT CONFIGURED".
    const defined = TEMPLATE_DEFINITIONS.map((entry) => entry.code);
    expect(defined).toEqual(expect.arrayContaining([...EXPECTED]));
  });

  it.each(EXPECTED)("TC-TPL-02: %s uses only field keys the engine can resolve", (code) => {
    const template = readTemplate(code);
    const unknown = template.tokens.filter((token) => !KNOWN_FIELD_KEYS.has(token));
    expect(unknown, `unknown tokens would render blank: ${unknown.join(", ")}`).toEqual([]);
  });

  it.each(EXPECTED)("TC-TPL-03: %s carries at least one placeholder", (code) => {
    // A template with no placeholders would produce an unfilled document that
    // still looks plausible — worse than one that is obviously wrong.
    expect(readTemplate(code).tokens.length).toBeGreaterThan(0);
  });

  it("TC-TPL-04: each document names the signer and carries a date", () => {
    const nameToken = /(employee_name|candidate_name)/;
    for (const code of EXPECTED) {
      const { tokens } = readTemplate(code);
      expect(tokens.some((t) => nameToken.test(t)), `${code} has no name field`).toBe(true);
      expect(tokens.some((t) => t.includes("date")), `${code} has no date field`).toBe(true);
    }
  });

  it("TC-TPL-05: substitution leaves no unreplaced placeholder", () => {
    // Mirrors renderPlaceholderDocx: plain string replacement of {{token}}.
    const sample: Record<string, string> = Object.fromEntries(
      [...KNOWN_FIELD_KEYS].map((key) => [key, `VALUE_${key.toUpperCase()}`]),
    );
    for (const code of EXPECTED) {
      let xml = readTemplate(code).xml;
      for (const [token, value] of Object.entries(sample)) xml = xml.split(`{{${token}}}`).join(value);
      expect(xml, `${code} still contains an unreplaced placeholder`).not.toMatch(/\{\{/);
    }
  });

  it("TC-TPL-06: templates are valid DOCX packages", () => {
    for (const code of EXPECTED) {
      const zip = new PizZip(readTemplate(code).buffer);
      expect(zip.file("[Content_Types].xml"), `${code} missing content types`).toBeTruthy();
      expect(zip.file("word/document.xml"), `${code} missing document.xml`).toBeTruthy();
    }
  });
});
