/**
 * The upstream `apr` table (read-only, db_bill's dialler feed) carries literal duplicate rows for
 * some employee/dates -- same UserID+ReportDate+Net_Login inserted more than once. Confirmed live
 * 2026-09-07: 5,240 employee/date combos in August alone. A plain `SUM(TIME_TO_SEC(Net_Login))`
 * over those doubles apr_minutes and manufactures a false mismatch against a correctly-recorded
 * attendance_daily_record row -- this accounted for effectively all of a 3,202-row false-positive
 * blocker on the August payroll run.
 *
 * Both readiness checks that read the `apr` table (APR_MISSING_ATTENDANCE_DAILY_RECORD and
 * APR_ATTENDANCE_DAILY_RECORD_MISMATCH) must dedupe before summing: SELECT DISTINCT
 * UserID/ReportDate/Net_Login in a subquery, then SUM/GROUP BY over that. This guard fails if
 * either check reverts to summing the raw table directly.
 *
 * This is a source-text assertion, not a DB-backed test, matching this module's existing pattern
 * for SQL-shape regressions (see branch-readiness-process-scope.contract.test.ts) -- the SQL's
 * actual correctness against real data is verified separately and was confirmed live on
 * 2026-09-07/08 (APR_ATTENDANCE_DAILY_RECORD_MISMATCH dropped from 3,202 to 2,557 once the
 * companion apr_bulk tag fix landed; the dedup fix here addresses the remaining duplicate-row
 * cause of that count).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "payroll-governance.service.ts"), "utf8");

/**
 * Every `FROM apr ... GROUP BY UserID, ReportDate` aggregation block in the source, returned as
 * the full subquery text from `SELECT UserID` through the matching `GROUP BY` line.
 */
function aprAggregationBlocks(src: string): string[] {
  const out: string[] = [];
  const re = /SELECT UserID, ReportDate AS report_date[\s\S]*?GROUP BY UserID, ReportDate/g;
  for (const m of src.matchAll(re)) out.push(m[0]);
  return out;
}

describe("apr readiness checks dedupe the upstream table before summing", () => {
  const blocks = aprAggregationBlocks(source);

  it("finds at least one apr aggregation block to check", () => {
    expect(blocks.length).toBeGreaterThan(0);
  });

  it.each(blocks.map((b, i) => [i, b] as const))(
    "aggregation block %i sums over a DISTINCT-deduped subquery, not the raw apr table",
    (_i, block) => {
      // The block must not aggregate straight off `FROM apr` -- it must go through an inner
      // SELECT DISTINCT ... FROM apr subquery first.
      expect(block, `block did not dedupe before summing:\n${block}`).toMatch(
        /FROM\s*\(\s*SELECT\s+DISTINCT\s+UserID,\s*ReportDate,\s*Net_Login\s+FROM\s+apr\b/i,
      );
      // And the outer aggregation must still be summing Net_Login via TIME_TO_SEC, not silently
      // dropped during the rewrite.
      expect(block).toMatch(/SUM\(TIME_TO_SEC\(Net_Login\)\)/);
    },
  );

  it("both known apr checks are present (regression guard against one being deleted)", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(2);
  });
});
