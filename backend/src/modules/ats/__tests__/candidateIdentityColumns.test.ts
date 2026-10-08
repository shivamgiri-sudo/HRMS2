/**
 * The onboarding save must not write columns ats_candidate does not have.
 *
 * Production logs this on every candidate who reaches the identity step:
 *
 *   ER_BAD_FIELD_ERROR: Unknown column 'passport_no' in 'field list'
 *   UPDATE ats_candidate SET passport_no = ..., driving_license_no = ...,
 *          uan_number = ..., epf_number = ..., esic_number = ...
 *
 * Four of those five live on candidate_onboarding_profile, not ats_candidate.
 * MySQL rejects the whole statement, so uan_number — which ats_candidate really
 * does have — never gets written either. The failure was invisible because the
 * call carried `.catch(() => {})` with the comment "columns may not exist on
 * older schema — safe to ignore". It was not safe to ignore: it silently
 * discarded a write on every save.
 *
 * Nothing is lost by narrowing it. The candidate_onboarding_profile upsert
 * immediately above already stores all five fields, including in its ON
 * DUPLICATE KEY UPDATE clause.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/modules/ats/onboarding-full.service.ts"),
  "utf8",
);

/** Columns that exist on ats_candidate, confirmed against the live schema. */
const NOT_ON_ATS_CANDIDATE = ["passport_no", "driving_license_no", "epf_number", "esic_number"];

function atsCandidateUpdates(): string[] {
  return [...SOURCE.matchAll(/UPDATE ats_candidate SET[\s\S]*?WHERE/g)].map((m) => m[0]);
}

describe("onboarding writes only to columns that exist", () => {
  it("finds the ats_candidate updates it is meant to check", () => {
    expect(atsCandidateUpdates().length).toBeGreaterThan(0);
  });

  for (const column of NOT_ON_ATS_CANDIDATE) {
    it(`never sets ${column} on ats_candidate`, () => {
      const offending = atsCandidateUpdates().filter((sql) => sql.includes(column));
      expect(
        offending.length,
        `${column} is on candidate_onboarding_profile, not ats_candidate — the whole UPDATE fails and takes uan_number with it`,
      ).toBe(0);
    });
  }

  it("still records the UAN, which ats_candidate does have", () => {
    // The point is to keep the one write that was always valid, not to delete
    // the statement wholesale.
    const keepsUan = atsCandidateUpdates().some((sql) => sql.includes("uan_number"));
    expect(keepsUan).toBe(true);
  });

  it("the profile upsert still carries all five identity fields", () => {
    // This is what makes narrowing the ats_candidate write safe.
    const upsert = SOURCE.slice(
      SOURCE.indexOf("INSERT INTO candidate_onboarding_profile"),
      SOURCE.indexOf("INSERT INTO candidate_onboarding_profile") + 4000,
    );
    for (const column of [...NOT_ON_ATS_CANDIDATE, "uan_number"]) {
      expect(upsert, `${column} must still reach candidate_onboarding_profile`).toContain(column);
    }
  });

  it("does not hide a failed identity write behind an empty catch", () => {
    // The empty catch is why this went unnoticed for so long: a rejected
    // statement and a successful one looked identical from the outside.
    const at = SOURCE.search(/UPDATE ats_candidate SET[\s\S]*?uan_number/);
    expect(at).toBeGreaterThan(-1);
    const tail = SOURCE.slice(at, at + 900);
    expect(tail).not.toMatch(/\.catch\(\s*\(\)\s*=>\s*\{\s*\/\*[^*]*\*\/\s*\}\s*\)/);
  });
});
