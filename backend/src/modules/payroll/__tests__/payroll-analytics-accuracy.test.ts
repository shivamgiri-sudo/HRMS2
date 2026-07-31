/**
 * Regression tests for the payroll analytics accuracy fixes.
 *
 * These assert on the SQL the route builds. The defect they lock down was not a
 * syntax error — both endpoints ran fine — it was that they silently disagreed
 * about which payroll run a month's figures come from.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "../payroll.routes.ts"), "utf8");

function block(marker: string, length = 1800): string {
  const index = source.indexOf(marker);
  expect(index, `marker not found: ${marker}`).toBeGreaterThan(-1);
  return source.slice(index, index + length);
}

describe("payroll analytics run selection", () => {
  it("defines the run ranking exactly once and shares it", () => {
    // Duplicated copies of this ordering are how the endpoints drifted apart.
    // One definition, reused by every caller — including the per-employee
    // payslip history, which must resolve a month to the same run.
    const rankDefinitions = source.match(/WHEN 'DISBURSED'\s+THEN 2/g) ?? [];
    expect(rankDefinitions).toHaveLength(1);
    expect(source).toMatch(/function runRankSql/);
    expect(source).toMatch(/const RUN_RANK_SQL = runRankSql\(\)/);
    expect(source).toMatch(/runRankSql\("spr"\)/);
  });

  it("ranks FINALIZED first and compares status case-insensitively", () => {
    // Production stores 'FINALIZED' (51 of 67 runs) next to lowercase statuses.
    // A case-sensitive CASE sent every FINALIZED run to the ELSE branch, so for
    // 2026-03 the canonical pick was a 226-line partial worth ₹19.7L instead of
    // the real 1,140-line payroll worth ₹1.77Cr.
    const rank = block("function runRankSql", 900);
    expect(rank).toMatch(/CASE UPPER\(\$\{col\}\)/);
    expect(rank).toMatch(/WHEN 'FINALIZED'\s+THEN 1/);
    // Every arm must be upper-case, or it can never match UPPER(status).
    const arms = rank.match(/WHEN '([A-Za-z]+)'/g) ?? [];
    expect(arms.length).toBeGreaterThanOrEqual(7);
    for (const arm of arms) {
      const value = arm.replace(/WHEN '|'/g, "");
      expect(value, `${value} must be upper-case to match UPPER(status)`).toBe(value.toUpperCase());
    }
  });

  it("filters run status case-insensitively everywhere", () => {
    // A lowercase-only `status NOT IN ('cancelled')` would silently admit a
    // 'CANCELLED' run, which is exactly the class of bug the ranking had.
    expect(source).not.toMatch(/status NOT IN \('cancelled'\)/);
    expect(source).not.toMatch(/status NOT IN \('draft','cancelled'\)/);
    expect(source).toMatch(/UPPER\(status\) NOT IN \('CANCELLED'\)/);
    expect(source).toMatch(/UPPER\(status\) NOT IN \('DRAFT','CANCELLED'\)/);
  });

  it("resolves one canonical run per month in the trends endpoint", () => {
    // Previously this summed EVERY non-cancelled run for a month, so a month
    // with a re-run reported a higher total in the trend chart than in the KPI
    // cards directly above it.
    // The ranking lives in the shared CTE; the endpoint composes it and takes rn = 1.
    expect(block("const CANONICAL_RUNS_CTE")).toMatch(/ROW_NUMBER\(\) OVER \(PARTITION BY run_month/);
    const trends = block("/analytics/trends");
    expect(trends).toMatch(/WITH \$\{CANONICAL_RUNS_CTE\}/);
    expect(trends).toMatch(/WHERE rn = 1/);
  });

  it("uses the shared ranking in the single-month endpoint too", () => {
    const analytics = block("const pickRun =");
    expect(analytics).toMatch(/ORDER BY \$\{RUN_RANK_SQL\}, created_at DESC/);
  });

  it("selects the latest N months with data rather than a calendar window", () => {
    // `run_month >= CURDATE() - INTERVAL 6 MONTH` yields SEVEN months (the
    // current one plus six) beneath a "Six-Month Trend" heading.
    const trends = block("/analytics/trends");
    expect(trends).not.toMatch(/DATE_SUB\(CURDATE\(\), INTERVAL \? MONTH\)/);
    expect(trends).toMatch(/ORDER BY run_month DESC LIMIT \$\{months\}/);
  });

  it("excludes cancelled runs when building the canonical set", () => {
    expect(block("const CANONICAL_RUNS_CTE")).toMatch(/WHERE UPPER\(status\) NOT IN \('CANCELLED'\)/);
  });

  it("returns run provenance so a draft is distinguishable from a disbursed run", () => {
    expect(source).toMatch(/isProvisional:\s*\["draft", "processing"\]\.includes/);
    expect(source).toMatch(/otherRunsInMonth/);
  });
});

describe("payroll analytics figures", () => {
  it("derives avg_net from the same denominator the dimension table uses", () => {
    // AVG(net_salary) and total ÷ distinct-employees are the same only while
    // there is exactly one line per employee. Deriving it explicitly means the
    // KPI card and the ledger cannot disagree about what "average" means.
    expect(source).toMatch(/SUM\(spl\.net_salary\) \/ NULLIF\(COUNT\(DISTINCT spl\.employee_id\),0\)/);
    // AVG() over lines is only equal to per-employee average while there is
    // exactly one line per employee — an assumption the card should not carry.
    expect(source).not.toMatch(/ROUND\(AVG\(spl\.net_salary\),2\)/);
  });

  it("computes allowances as everything in gross that is not basic", () => {
    // hra + special_allowance omitted incentive_total and overtime_pay, so
    // basic + allowances did not reconcile to gross.
    expect(source).toMatch(/GREATEST\(spl\.gross_salary - spl\.basic, 0\)/);
    expect(source).not.toMatch(/COALESCE\(spl\.hra,0\)\+COALESCE\(spl\.special_allowance,0\)/);
  });

  it("keeps cancelled lines out of every aggregate", () => {
    const occurrences = source.match(/spl\.status != 'cancelled'/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(3);
  });
});
