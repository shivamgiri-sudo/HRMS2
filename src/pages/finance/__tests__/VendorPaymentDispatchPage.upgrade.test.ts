import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Source-text contract tests for VendorPaymentDispatchPage.tsx's 2026-09-10 upgrade.
 * No rendering harness exists for this page (DashboardLayout + multiple useQuery hooks with
 * no test-time QueryClient/router setup) — same convention as
 * PnlMasterControlCenterPage.branch-filter.test.ts. Extended by later tasks in this plan.
 */

const SRC = readFileSync(
  new URL("../VendorPaymentDispatchPage.tsx", import.meta.url),
  "utf8",
);

describe("VendorPaymentDispatchPage — financialYear filter (Task 2)", () => {
  it("Filters interface declares financialYear", () => {
    expect(SRC).toMatch(/interface Filters \{[\s\S]*?financialYear: string;[\s\S]*?\}/);
  });

  it("initialFilters() sets financialYear to empty string", () => {
    expect(SRC).toMatch(/function initialFilters\(\): Filters \{[\s\S]*?financialYear: "",[\s\S]*?\}/);
  });

  it("defines financialYearOptions() generating YYYY-YY strings back to real-data floor 2017", () => {
    expect(SRC).toMatch(/function financialYearOptions\(\)/);
    expect(SRC).toMatch(/year >= 2017/);
    expect(SRC).toMatch(/\$\{year\}-\$\{String\(\(year \+ 1\) % 100\)\.padStart\(2, "0"\)\}/);
  });

  it("renders a financialYear Select (not a free-text Input) in the filter bar", () => {
    expect(SRC).toMatch(
      /value=\{filters\.financialYear \|\| "_all"\}[\s\S]{0,600}financialYearOptions\(\)\.map/
    );
  });
});
