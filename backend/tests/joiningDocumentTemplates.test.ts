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
import fs from "fs";
import os from "os";
import path from "path";
import PizZip from "pizzip";
import { applyTransformRule } from "../src/modules/employees/pdfAcroFormFill.service.js";
import { renderPlaceholderDocx, matchPlaceholderField } from "../src/modules/employees/universalDigitalFormFill.service.js";
import {
  TEMPLATE_DEFINITIONS,
  buildTemplateDocx,
  templateTokens,
} from "../src/modules/employees/joiningDocumentTemplates.js";

/**
 * Injected by joiningDocumentPdf.service at render time from the branch letterhead and
 * the company constant, so they resolve without being field values. Same set the sibling
 * templateTokenCoverage.contract.test.ts keeps.
 */
const RENDERER_INJECTED = new Set(["branch_address", "branch_name", "company_registered_office"]);

/**
 * Whether the fill engine can resolve a token.
 *
 * Asked of the engine rather than compared against a copy of its field list. The copy
 * that used to live here was written by hand and then fell behind on two separate
 * counts: relation_prefix, payroll_hr_name and payroll_hr_designation were added to
 * COMMON_TEMPLATE_FIELDS and never mirrored, and branch_address and
 * company_registered_office are injected by the renderer rather than declared as fields
 * at all. So this reported five tokens as "would render blank" in the employment
 * contract when the engine resolves every one of them — a false alarm on the one
 * document where a blank would be most serious, which is the fastest way to teach
 * people to ignore a failing test.
 */
function isResolvable(token: string): boolean {
  return RENDERER_INJECTED.has(token) || Boolean(matchPlaceholderField(token));
}

const EXPECTED = [
  "EMPLOYMENT_CONTRACT",
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
    const unknown = template.tokens.filter((token) => !isResolvable(token));
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
    // Built from the tokens the templates actually carry, not from a list of keys kept
    // alongside them: a token missing from that list survived substitution and was
    // reported as an unreplaced placeholder, which is the same staleness twice over.
    const sample: Record<string, string> = Object.fromEntries(
      EXPECTED.flatMap((code) => readTemplate(code).tokens)
        .filter(isResolvable)
        .map((key) => [key, `VALUE_${key.toUpperCase()}`]),
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

  it("TC-TPL-07: dates render DD/MM/YYYY in the document", () => {
    // Mirrors formatDateForDocumentDisplay in renderPlaceholderDocx.
    const display = (v: string) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
      return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
    };
    expect(display("2017-01-19")).toBe("19/01/2017");
    expect(display("2026-07-29")).toBe("29/07/2026");
    // Non-dates pass through untouched.
    expect(display("MAS36220")).toBe("MAS36220");
    expect(display("NOIDA-2")).toBe("NOIDA-2");
  });

  it("TC-TPL-08: EPF date boxes still require ISO, so stored values must not be reformatted", () => {
    // The statutory EPF form splits a date into single-character boxes via
    // applyTransformRule -> splitIsoDate, which only matches ISO. If a stored
    // value were ever changed to DD/MM/YYYY, every date box would render blank.
    expect(applyTransformRule("2017-01-19", "date_day")).toBe("19");
    expect(applyTransformRule("2017-01-19", "date_month")).toBe("01");
    expect(applyTransformRule("2017-01-19", "date_year")).toBe("2017");
    expect(applyTransformRule("2017-01-19", "date_ddmmyyyy")).toBe("19012017");

    // Proof of the hazard this guards against:
    expect(applyTransformRule("19/01/2017", "date_day")).toBe("");
    expect(applyTransformRule("19/01/2017", "date_ddmmyyyy")).toBe("");
  });

  it("TC-TPL-09: the legacy fix-up pass does not eat data on token templates", async () => {
    // renderPlaceholderDocx carries regexes written for the original
    // hand-authored Word files. One of them, /Employee Name\s*:\s*[^<]+/, is
    // greedy to the end of the run. The PI consent form renders
    // "Employee Name: {{pi_employee_name}}  Employee Code: {{employee_code}}"
    // as a SINGLE run, so unguarded it replaced the whole run and the employee
    // code silently vanished from a document the joiner then signed.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-"));
    const file = path.join(dir, "PI_PROCESSING_CONSENT.docx");
    fs.writeFileSync(file, buildTemplateDocx("PI_PROCESSING_CONSENT"));
    try {
      const out = await renderPlaceholderDocx(file, {
        pi_employee_name: "KAMAL SINGH RAWAT",
        employee_code: "MAS36220",
        employee_name: "KAMAL SINGH RAWAT",
        mobile: "9876543210",
        email: "kamal.rawat@example.com",
        pi_signature_date: "2026-07-29",
      });
      const xml = new PizZip(out).file("word/document.xml")?.asText() ?? "";
      expect(xml).toContain("KAMAL SINGH RAWAT");
      expect(xml, "employee code was eaten by the legacy fix-up pass").toContain("MAS36220");
      expect(xml, "a token survived substitution").not.toMatch(/\{\{/);
      // Dates render in the Indian convention, not as a raw ISO string.
      expect(xml).toContain("29/07/2026");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("TC-TPL-10: every generated template survives a real render", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-all-"));
    try {
      for (const code of EXPECTED) {
        const file = path.join(dir, `${code}.docx`);
        fs.writeFileSync(file, buildTemplateDocx(code));
        const replacements = Object.fromEntries(
          templateTokens(code).map((token) => [token, token.includes("date") ? "2026-07-29" : `V_${token}`]),
        );
        const xml = new PizZip(await renderPlaceholderDocx(file, replacements)).file("word/document.xml")?.asText() ?? "";
        expect(xml, `${code} left a placeholder unreplaced`).not.toMatch(/\{\{/);
        for (const token of templateTokens(code)) {
          const expected = token.includes("date") ? "29/07/2026" : `V_${token}`;
          expect(xml, `${code} lost the value for ${token}`).toContain(expected);
        }
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
