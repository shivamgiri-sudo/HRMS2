/**
 * A blank form field must mean "leave this column alone", not "".
 *
 * The ats_candidate mirror in saveOnboardingProfile binds every value into
 * COALESCE(?, existing_column). The sentinel for "don't change it" is therefore
 * NULL — but the bindings used `input.x ?? fallback ?? null`, and `??` only
 * falls back on null/undefined. An untouched form field arrives as "", so ""
 * was passed through, and COALESCE('', col) evaluates to ''.
 *
 * Two live failures came from that, both observed in production on 2026-08-08:
 *
 *   1. date_of_birth — MySQL rejects '' as a datetime, so the statement threw
 *      ER_TRUNCATED_WRONG_VALUE: Incorrect datetime value: ''. That aborted the
 *      whole UPDATE *after* candidate_onboarding_profile had already been
 *      written, leaving the two tables disagreeing. It fired twice inside 20
 *      seconds, so real candidates were hitting it.
 *   2. every varchar — COALESCE('', father_name) is '', verified against the live
 *      DB, so a blank field writes an empty string rather than leaving the column
 *      alone. Latent, not demonstrated: the 26 rows currently holding '' have the
 *      same blank in candidate_onboarding_profile, so those are blank-in
 *      blank-out rather than proven data loss. Fixed anyway — '' and NULL must
 *      not mean different things in a COALESCE-guarded column.
 *
 * These tests assert the binding layer, which is where the defect lived. The
 * SQL text is asserted too, because the fix is only correct while the columns
 * stay COALESCE-guarded — switching one to a bare `= ?` would reintroduce the
 * overwrite with the bindings looking untouched.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.resolve(__dirname, "../onboarding-full.service.ts"),
  "utf8",
);

/** The helper the service uses, reproduced exactly (service module has DB-heavy imports). */
function nonEmptyString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

describe("blank onboarding fields normalise to NULL", () => {
  it("turns empty and whitespace-only input into NULL", () => {
    expect(nonEmptyString("")).toBeNull();
    expect(nonEmptyString("   ")).toBeNull();
    expect(nonEmptyString(null)).toBeNull();
    expect(nonEmptyString(undefined)).toBeNull();
  });

  it("preserves real values, trimmed", () => {
    expect(nonEmptyString("SULTAN AHMED")).toBe("SULTAN AHMED");
    expect(nonEmptyString("  7819827526  ")).toBe("7819827526");
  });

  it("`??` alone does NOT fix this — the bug in one line", () => {
    const blankField = "";
    // What the code used to do: "" is neither null nor undefined, so it survives.
    expect(blankField ?? null).toBe("");
    // What it does now.
    expect(nonEmptyString(blankField)).toBeNull();
  });
});

describe("saveOnboardingProfile bindings", () => {
  const mirror = source.slice(
    source.indexOf("UPDATE ats_candidate SET\n       father_name = COALESCE"),
    source.indexOf("Mirror the UAN onto ats_candidate"),
  );

  it("the ats_candidate mirror block was located", () => {
    expect(mirror.length).toBeGreaterThan(200);
  });

  it("binds DOB through the normalised value, not the raw input", () => {
    // normalizedDob is computed ~100 lines earlier ("convert empty strings to
    // null") and was simply not reused here.
    expect(mirror).toContain("normalizedDob");
    expect(mirror).not.toMatch(/input\.dateOfBirth \?\? tokenData\.date_of_birth \?\? null/);
  });

  it("wraps every user-supplied string binding in a null-safe helper", () => {
    // input.fatherHusbandName moved to toStoredName (2026-08-18, "names stored
    // uppercase" policy): it has the exact same blank-to-NULL safety property
    // this test guards, plus the new uppercase requirement, so it's an equally
    // valid wrapper here — not a regression of the fix this file documents.
    for (const [field, wrapper] of [
      ["input.fatherHusbandName", "toStoredName("],
      ["input.gender", "nonEmptyString("],
      ["input.permanentAddress", "nonEmptyString("],
      ["input.mobileNumber", "nonEmptyString("],
      ["input.personalEmailId", "nonEmptyString("],
    ] as const) {
      const at = mirror.indexOf(field);
      expect(at, `${field} not bound in the mirror`).toBeGreaterThan(-1);
      const line = mirror.slice(mirror.lastIndexOf("\n", at), mirror.indexOf("\n", at));
      expect(line, `${field} still binds a raw value`).toContain(wrapper);
    }
  });

  it("no binding in the mirror still uses the bare `?? null` sentinel", () => {
    expect(mirror).not.toMatch(/\?\? null,/);
  });

  it("the guarded columns are still COALESCE, so NULL means 'leave alone'", () => {
    for (const col of ["father_name", "gender", "date_of_birth", "mobile", "email"]) {
      expect(mirror).toContain(`${col} = COALESCE(?, ${col})`);
    }
  });

  it("the UAN mirror is normalised too", () => {
    const uan = source.slice(source.indexOf("uan_number = COALESCE(?, uan_number)"));
    expect(uan.slice(0, 600)).toContain("nonEmptyString(input.uanNumber)");
  });
});
