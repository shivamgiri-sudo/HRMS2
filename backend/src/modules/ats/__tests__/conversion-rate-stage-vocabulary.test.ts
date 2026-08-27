import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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

  it("derives the SQL from the constant so a stage rename cannot silently zero the metric", () => {
    // Both the numerator and the rate must go through JOINED_STAGE_SQL — an inlined copy
    // in one of them is how the two drift apart.
    const hired = source.indexOf("as total_hired");
    const rate = source.indexOf("as conversion_rate");
    expect(hired).toBeGreaterThan(-1);
    expect(rate).toBeGreaterThan(-1);
    expect(source.slice(hired - 200, hired)).toContain("${JOINED_STAGE_SQL}");
    expect(source.slice(rate - 200, rate)).toContain("${JOINED_STAGE_SQL}");
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
});
