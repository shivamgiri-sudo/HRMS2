import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The variance report must resolve a month to one payroll run.
 *
 * It selected lines with `WHERE spr.run_month = ?` and no run disambiguation, so
 * a month holding more than one run contributed all of them. The cost-summary
 * report, reading the same underlying data, has always picked a single run — so
 * the two disagreed about the same month.
 *
 * This is reproducible in production today. 2026-03 legitimately holds two runs
 * (an operational 1,140-line run and a 226-line import batch, zero employee
 * overlap), and the variance query returned 1,366 lines for that month against
 * cost summary's 1,140.
 *
 * Because the two runs are disjoint, the failure was not the obvious one. Nothing
 * was overwritten in the employee map — every employee simply appeared, from both
 * populations at once, and the month's variance was computed over a headcount
 * that never existed as a single payroll.
 *
 * Verified after the fix, against production:
 *   2026-03  1,366 lines -> 1,140, canonical pick 3ebd0ab6 (FINALIZED),
 *            which is the same run cost summary picks
 *   2026-07  1,464 lines -> 1,464, unchanged; one run, both reports agree
 */

const VARIANCE = readFileSync(
  resolve(__dirname, "../payroll-variance.routes.ts"),
  "utf8",
);

describe("variance resolves a single canonical run per month", () => {
  it("no longer selects every run in the month", () => {
    expect(
      VARIANCE,
      "an unqualified run_month filter merges every run the month holds",
    ).not.toMatch(/WHERE spr\.run_month = \?/);
  });

  it("pins both the current and previous month queries to one run id", () => {
    const anchored = VARIANCE.match(/WHERE spr\.id = \(/g) ?? [];
    expect(anchored, "both month queries must resolve a canonical run").toHaveLength(2);
  });

  it("uses the shared ranking rather than a local copy", () => {
    // A second copy of this ordering is exactly how variance and cost summary
    // drifted apart to begin with.
    expect(VARIANCE).toMatch(/import \{ runRankSql \} from "\.\/run-status\.js"/);
    expect(VARIANCE).toMatch(/ORDER BY \$\{runRankSql\("r"\)\}, r\.created_at DESC/);
    expect(VARIANCE.match(/WHEN 'DISBURSED'/g) ?? []).toHaveLength(0);
  });

  it("breaks ties on recency, so the pick is deterministic", () => {
    // Rank alone is not enough: two runs can share a status. Without a tiebreak
    // the database may return either, and the report changes between refreshes.
    const picks = VARIANCE.match(/ORDER BY \$\{runRankSql\("r"\)\}, r\.created_at DESC\s+LIMIT 1/g) ?? [];
    expect(picks).toHaveLength(2);
  });

  it("excludes cancelled runs case-insensitively", () => {
    // Statuses are not stored in a consistent case; a lowercase-only exclusion
    // would admit a 'CANCELLED' run as the canonical pick for the month.
    const excludes = VARIANCE.match(/UPPER\(r\.status\) NOT IN \('CANCELLED'\)/g) ?? [];
    expect(excludes).toHaveLength(2);
  });
});
