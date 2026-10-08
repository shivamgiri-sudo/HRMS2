/**
 * `COALESCE(?, col)` treats NULL as "leave alone" — and "" is not NULL.
 *
 * A blank date of birth aborted candidate onboarding in production on
 * 2026-08-08 (fixed in cdaa0c47): the binding was `input.dateOfBirth ?? null`,
 * `??` does not catch "", MySQL rejected '' as a datetime with
 * ER_TRUNCATED_WRONG_VALUE, and the whole UPDATE died *after* a sibling table had
 * already been written.
 *
 * Sweeping the other 189 COALESCE bindings found six more sites with the same
 * shape on a DATE/DATETIME/DECIMAL column, all reachable from unvalidated
 * request bodies. This pins the helper and those call sites.
 *
 * The contrast that caused it: `value || null` converts "" correctly and several
 * call sites already used it (joining-control-room, grn-smart). `value ?? null`
 * is the broken twin. Whether a given column was safe came down to which
 * operator someone happened to type.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { blankToNull } from "../sql-values.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendSrc = path.resolve(__dirname, "../..");

describe("blankToNull", () => {
  it("turns blank strings into the NULL sentinel COALESCE expects", () => {
    expect(blankToNull("")).toBeNull();
    expect(blankToNull("   ")).toBeNull();
    expect(blankToNull("\t\n")).toBeNull();
  });

  it("passes null and undefined through as NULL", () => {
    expect(blankToNull(null)).toBeNull();
    expect(blankToNull(undefined)).toBeNull();
  });

  it("never rejects a value that already worked", () => {
    // The conservative choice on purpose: a format-validating helper such as
    // grn-smart's dateOrNull requires exactly YYYY-MM-DD and would silently drop
    // a valid DATETIME.
    expect(blankToNull("2026-08-08")).toBe("2026-08-08");
    expect(blankToNull("2026-08-08 10:30:00")).toBe("2026-08-08 10:30:00");
    expect(blankToNull("2026-08-08T10:30:00.000Z")).toBe("2026-08-08T10:30:00.000Z");
  });

  it("does not mangle non-strings", () => {
    expect(blankToNull(0)).toBe(0);          // a real numeric zero, not "absent"
    expect(blankToNull(false)).toBe(false);
    expect(blankToNull(12345.67)).toBe(12345.67);
  });

  it("preserves an intentionally padded string's content", () => {
    // Only fully-blank values become NULL; a real value keeps its own spacing.
    expect(blankToNull(" Noida sector 62 ")).toBe(" Noida sector 62 ");
  });

  it("`?? null` is the bug, in one line", () => {
    const untouchedField = "";
    expect(untouchedField ?? null).toBe("");        // reaches MySQL, throws
    expect(blankToNull(untouchedField)).toBeNull(); // leaves the column alone
  });
});

describe("date/decimal columns behind COALESCE are guarded at their call sites", () => {
  const sites: Array<[string, string[]]> = [
    ["modules/org/events.routes.ts", ["event_date", "end_date"]],
    ["modules/privacy/privacy.routes.ts", ["notified_authority_at", "notified_principals_at"]],
    ["modules/assets/assets.service.ts", ["warranty_expiry", "purchase_cost"]],
    ["modules/org/org.service.ts", ["effective_date"]],
    ["modules/business-actions/business-actions.service.ts", ["due_date"]],
    ["modules/ats/ats.onboarding.service.ts", ["date_of_salary"]],
  ];

  for (const [file, columns] of sites) {
    it(`${file} binds ${columns.join(", ")} through blankToNull`, () => {
      const src = fs.readFileSync(path.join(backendSrc, file), "utf8");
      expect(src, "helper not imported").toContain("blankToNull");
      for (const col of columns) {
        // The binding for each column must be wrapped, not left on `?? null`.
        const camel = col.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
        const wrapped =
          src.includes(`blankToNull(${col})`) ||
          src.includes(`blankToNull(data.${col})`) ||
          src.includes(`blankToNull(input.${col})`) ||
          src.includes(`blankToNull(o.${col})`) ||
          src.includes(`blankToNull(${camel})`);
        expect(wrapped, `${col} still bound without blankToNull in ${file}`).toBe(true);
      }
    });
  }
});
