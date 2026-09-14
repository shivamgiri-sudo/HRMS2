/**
 * Mobile-based dedup/match guard against placeholder values.
 *
 * Confirmed live: a single-digit placeholder mobile value is shared by 539
 * ats_candidate rows and 1,284 employees rows — an INNER JOIN on mobile equality
 * between the two tables produced 729,994 rows (539 x 1,284 accounts for nearly all
 * of it), vastly more than either table's size. Every mobile-based dedup/match query
 * in the ATS module was exposed to this: matching on an unvalidated mobile value risks
 * false "already registered" blocks, silently updating an unrelated candidate's record
 * in place, or wrong-linking a hiring-activity import row.
 *
 * The fix reuses the mobile-format regex already established and tested elsewhere in
 * this exact module (registration.enhanced.routes.ts, ats-assessment/assessment.routes.ts,
 * ats/__tests__/integration.test.ts) rather than inventing a new validation format.
 *
 * Source-text inspection, matching this repo's established contract-test style.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MOBILE_REGEX_SRC = "/^[6-9]\\d{9}$/";

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function read(rel: string): string {
  return stripComments(readFileSync(resolve(process.cwd(), rel), "utf8"));
}

describe("ats.service.ts createCandidate guards mobile dedup against placeholder values", () => {
  const source = read("src/modules/ats/ats.service.ts");
  const fn = source.match(/async createCandidate\([\s\S]*?\n  \},/);

  it("createCandidate function found", () => {
    expect(fn).toBeTruthy();
  });

  it("validates mobile format before the duplicate-mobile SELECT", () => {
    expect(fn![0]).toContain(MOBILE_REGEX_SRC);
    expect(fn![0]).toContain("isRealMobile");
  });
});

describe("atsFullParity.service.ts createIntake guards mobile dedup against placeholder values", () => {
  const source = read("src/modules/ats-full-parity/atsFullParity.service.ts");
  const fn = source.match(/async createIntake\([\s\S]*?\n  \},/);

  it("createIntake function found", () => {
    expect(fn).toBeTruthy();
  });

  it("validates mobile format before the existing-candidate SELECT", () => {
    expect(fn![0]).toContain(MOBILE_REGEX_SRC);
    expect(fn![0]).toContain("isRealMobile");
  });
});

describe("bulk-import.service.ts findExistingCandidate guards mobile dedup against placeholder values", () => {
  const source = read("src/modules/ats/bulk-import.service.ts");
  const fn = source.match(/async function findExistingCandidate\([\s\S]*?\n\}/);

  it("findExistingCandidate function found", () => {
    expect(fn).toBeTruthy();
  });

  it("validates mobile format before the by-mobile SELECT", () => {
    expect(fn![0]).toContain(MOBILE_REGEX_SRC);
  });

  it("still falls through to email match when mobile is not a real number", () => {
    expect(fn![0]).toContain("byEmail");
  });
});

describe("recruiter-hiring.service.ts resolveCandidateByActivity guards mobile dedup against placeholder values", () => {
  const source = read("src/modules/ats/recruiter-hiring.service.ts");
  const fn = source.match(/async function resolveCandidateByActivity\([\s\S]*?\n\}/);

  it("resolveCandidateByActivity function found", () => {
    expect(fn).toBeTruthy();
  });

  it("validates mobile format before either mobile-keyed tier is added to the query list", () => {
    expect(fn![0]).toContain(MOBILE_REGEX_SRC);
    expect(fn![0]).toContain("isRealMobile");
  });

  it("still queries by email, employee_code and candidate_code unconditionally", () => {
    expect(fn![0]).toContain("WHERE email = ?");
    expect(fn![0]).toContain("WHERE employee_code = ?");
    expect(fn![0]).toContain("WHERE candidate_code = ?");
  });
});
