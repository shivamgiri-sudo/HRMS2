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
  it("surveillance_hr_name is optional, and cannot block a document", () => {
    // This field used to be `source_path: null, required: false`, and this
    // canary caught the moment that changed. It is now sourced from
    // payroll_hr.name so it stops printing blank on every NDA — but a branch
    // with no configured signatory still resolves to nothing, so it must
    // remain non-blocking or the document sticks at hr_fill_required forever.
    // With no branch configured yet, that would have been every document.
    expect(src).toMatch(/field_key: "surveillance_hr_name"[^}]*required: false/);
    expect(src).toMatch(/OPTIONAL_SOURCED_FIELD_KEYS = \[[^\]]*"surveillance_hr_name"/);
  });

  it("the optional-but-sourced allowance stays narrow", () => {
    // It exists for fields whose source can legitimately be empty. Widening it
    // to the whole optional set would stop genuinely missing statutory data
    // from blocking, which is what the derived rule below is protecting.
    //
    // Ceiling raised 3 -> 4 when "process" joined: 19,270 of 58,627 employees
    // have no process_id and the kit stuck at hr_fill_required forever. Raise
    // this again only for a field whose source is genuinely, routinely empty —
    // not to quieten a failure.
    const list = src.match(/OPTIONAL_SOURCED_FIELD_KEYS = \[([^\]]*)\]/)?.[1] ?? "";
    const entries = list
      // Count quoted keys, not commas. The array is commented, and comment prose
      // contains commas — a plain split counted 12 entries where there were 4.
      .replace(/\/\/[^\n]*/g, "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^"[^"]+"$/.test(s));
    expect(entries.length).toBeLessThanOrEqual(4);
    expect(entries).toContain('"process"');
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
