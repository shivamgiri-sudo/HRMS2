/**
 * An optional field the system cannot fill must not block its document.
 *
 * surveillance_hr_name is defined `source_path: null, required: false`: nothing
 * populates it automatically and nothing requires it. deriveFieldValue still
 * marked it 'hr_fill_required' (it never consults `required`), and
 * persistChecklistFillStatus counted that as missing — so the NDA sat at
 * hr_fill_required permanently and no joining kit containing it could be sent.
 *
 * These assertions read the source rather than the database because the rule
 * lives in the SQL string, and a mock would only re-state the expectation.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const SRC = path.resolve(
  __dirname, "..", "universalDigitalFormFill.service.ts",
);
const src = fs.readFileSync(SRC, "utf8");

describe("optional unsourced fields do not block a document", () => {
  it("surveillance_hr_name is still defined optional and unsourced", () => {
    // If this changes, the rest of this file is describing a field that no
    // longer exists in that shape.
    expect(src).toMatch(
      /field_key: "surveillance_hr_name"[^}]*source_path: null, required: false/,
    );
  });

  it("the non-blocking set is derived from the definitions, not hardcoded", () => {
    expect(src).toContain("NON_BLOCKING_FIELD_KEYS");
    expect(src).toMatch(/COMMON_TEMPLATE_FIELDS\s*\n?\s*\.filter\(\(f\) => f\.required === false && !f\.source_path\)/);
  });

  it("missing_count excludes non-blocking fields", () => {
    // The specific regression: without this clause the document can never
    // leave hr_fill_required.
    expect(src).toMatch(
      /SUM\(CASE WHEN fill_status = 'hr_fill_required'\s*\n?\s*AND field_key NOT IN \(\$\{skipSql\}\)/,
    );
  });

  it("binds the excluded keys before checklistId", () => {
    // The placeholders appear earlier in the SQL than the WHERE, so the
    // parameter array has to match that order or the query silently filters on
    // the wrong values.
    expect(src).toContain("[...skip, checklistId]");
  });

  it("survives an empty exclusion set", () => {
    // `NOT IN ()` is a MySQL syntax error, which would break every document.
    expect(src).toMatch(/NON_BLOCKING_FIELD_KEYS\.length \? NON_BLOCKING_FIELD_KEYS : \[/);
  });

  it("does not loosen validation for required fields", () => {
    // The exclusion is conditioned on required === false. If that were dropped,
    // genuinely missing statutory data (EPF nominees) would stop blocking.
    const filter = src.match(/\.filter\(\(f\) => ([^)]+)\)/);
    expect(filter?.[1]).toContain("f.required === false");
    expect(filter?.[1]).toContain("!f.source_path");
  });

  it("leaves the HR manual-entry path intact", () => {
    // HR must still be able to fill the field by hand; that path is what makes
    // the blank an informed choice rather than a silent gap.
    expect(src).toContain('valueSource: "HR_ENTERED"');
  });
});
