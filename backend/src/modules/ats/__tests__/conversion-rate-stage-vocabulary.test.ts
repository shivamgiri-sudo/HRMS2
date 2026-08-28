import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// candidateBecameEmployee() is pure and never touches `db` itself, but importing its
// module does (module-level `import { db } from "../../db/mysql.js"`), so the mock is
// required just to load the file under test — same convention as this directory's other
// service-importing tests (see e.g. candidate-access-scope.test.ts).
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));

import { candidateBecameEmployee } from "../analytics.unified.service.js";

/**
 * Source-by-source conversion rate counted `current_stage = 'joined'`.
 *
 * No row in ats_candidate has ever held that value. Verified against production on
 * 2026-08-27: 38,191 candidates, 0 at 'joined'. The live vocabulary for "became an
 * employee" is Onboarded (28), converted (16) and payroll_validated (4).
 *
 * So the metric was not merely inaccurate — it was arithmetically incapable of returning
 * anything but 0.00% on any dataset, and a permanent zero on a conversion rate reads as
 * "nothing converts" rather than "this is not being measured". It shipped that way beside
 * a funnel showing 1,272 live offers.
 *
 * `current_stage` is free varchar with mixed casing conventions, so the guard also pins
 * the case-insensitive comparison: matching 'Onboarded' with a bare `IN ('onboarded')`
 * would silently reintroduce a zero for the largest of the three stages.
 */
describe("ATS conversion rate counts stages that exist", () => {
  const source = readFileSync(
    resolve(__dirname, "../analytics.unified.service.ts"),
    "utf-8",
  );

  it("does not compare current_stage to 'joined', a value no row has ever held", () => {
    expect(source).not.toMatch(/current_stage\s*=\s*'joined'/i);
  });

  it("counts the three stages that actually terminate the funnel", () => {
    expect(source).toMatch(/JOINED_STAGES\s*=\s*\[/);
    for (const stage of ["onboarded", "converted", "payroll_validated"]) {
      expect(source, `${stage} missing from JOINED_STAGES`).toContain(`'${stage}'`);
    }
  });

  it("compares case-insensitively, because current_stage mixes casing conventions", () => {
    const start = source.indexOf("const JOINED_STAGE_PREDICATE");
    expect(start, "JOINED_STAGE_PREDICATE not found").toBeGreaterThan(-1);
    expect(source.slice(start, start + 240)).toMatch(/LOWER\(TRIM\(current_stage\)\)/);
  });

  it("routes every joined-stage filter through the constant, not just the conversion rate", () => {
    // The dead literal was in nine places, not one: getTimeToHireMetrics' overall / by_role
    // / by_source / by_branch / fastest / slowest, plus the forecast's monthly-hires and
    // candidate-journey queries. Fixing only the conversion rate would have left an entire
    // time-to-hire surface still returning null on every call.
    const uses = source.match(/\$\{JOINED_STAGE_PREDICATE\}/g) ?? [];
    expect(uses.length, "expected the predicate to be reused across the joined-stage queries")
      .toBeGreaterThanOrEqual(8);
  });

  it("does not compare current_stage to \"joined\" in double quotes either", () => {
    // getCustomReport's ad-hoc conversion_rate metric had the same dead comparison, just
    // double-quoted — invisible to the single-quote regex above, which is why it survived
    // the first pass at this fix. Both quote styles are equally dead; both must be gone.
    expect(source).not.toMatch(/current_stage\s*=\s*"joined"/i);
  });
});

/**
 * getSourceChannelROI's total_hired/conversion_rate no longer come from a bare SQL SUM —
 * only 0.07% of genuine candidates carry a terminal stage (6 of 8,253, verified live
 * 2026-08-28), so stage alone is still close to always-zero even with the vocabulary
 * fixed above. 643 more are demonstrably on payroll (mobile-matched to an employees row
 * joining on/after the application), so conversion_rate now also counts those — see
 * candidateBecameEmployee() in analytics.unified.service.ts.
 */
describe("candidateBecameEmployee — the identity-match half of conversion", () => {
  const mapOf = (pairs: [string, string][]) => new Map(pairs);

  it("counts a terminal stage even with no identity match at all", () => {
    expect(
      candidateBecameEmployee(
        { current_stage: "Onboarded", mobile: null, created_at: "2026-01-01" },
        mapOf([]),
      ),
    ).toBe(true);
  });

  it("counts an identity match whose employer joined on/after the application", () => {
    expect(
      candidateBecameEmployee(
        { current_stage: "round 2- op's", mobile: "9876543210", created_at: "2026-01-01" },
        mapOf([["9876543210", "2026-01-15"]]),
      ),
    ).toBe(true);
  });

  it("rejects an identity match whose employer joined BEFORE the application", () => {
    // A rehire, or a family/reused number: the employee predates this application, so
    // this specific candidacy did not convert. Without this check mobile-only matching
    // over-counted by roughly 2x in production (measured 2026-08-27).
    expect(
      candidateBecameEmployee(
        { current_stage: "applied", mobile: "9876543210", created_at: "2026-06-01" },
        mapOf([["9876543210", "2025-01-15"]]),
      ),
    ).toBe(false);
  });

  it("treats same-day joining as a match (>=, not >)", () => {
    expect(
      candidateBecameEmployee(
        { current_stage: "applied", mobile: "9876543210", created_at: "2026-01-15" },
        mapOf([["9876543210", "2026-01-15"]]),
      ),
    ).toBe(true);
  });

  it("rejects a candidate with no mobile on file, even if the stage is unset", () => {
    expect(
      candidateBecameEmployee(
        { current_stage: null, mobile: null, created_at: "2026-01-01" },
        mapOf([["9876543210", "2026-01-15"]]),
      ),
    ).toBe(false);
  });

  it("rejects a mobile with no entry in the map", () => {
    expect(
      candidateBecameEmployee(
        { current_stage: "applied", mobile: "0000000000", created_at: "2026-01-01" },
        mapOf([["9876543210", "2026-01-15"]]),
      ),
    ).toBe(false);
  });

  it("matches case-insensitively on stage the same way the SQL predicate does", () => {
    expect(
      candidateBecameEmployee(
        { current_stage: "  CONVERTED  ", mobile: null, created_at: "2026-01-01" },
        mapOf([]),
      ),
    ).toBe(true);
  });
});
