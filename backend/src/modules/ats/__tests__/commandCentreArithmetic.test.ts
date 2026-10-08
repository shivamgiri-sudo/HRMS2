import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Two arithmetic defects on the ATS command-centre dashboard, both of which produced numbers
 * that cannot be right regardless of the data.
 *
 * 1. getDashboardMetrics divided `selected` by `total`, but only `total` required
 *    active_status = 1. A numerator that is not a subset of its denominator can exceed it, so
 *    conversion_rate could be reported above 100%.
 *
 * 2. getBranchMetrics LEFT JOINs ats_queue_token (one row per token issued today) and then
 *    used SUM(CASE ... THEN 1) for selected_count and pending_interviews, while
 *    total_candidates used COUNT(DISTINCT c.id). A candidate with three tokens counted three
 *    times in the SUMs and once in the total — so selected_count could exceed
 *    total_candidates for the same branch.
 *
 * Both are asserted against the SQL text because the repo has no harness that executes ATS
 * analytics SQL against a database; there is no behavioural route to these numbers.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const SERVICE = "src/modules/ats/command-centre.service.ts";

function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  if (start === -1) return "";
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? src.length : next);
}

describe("getDashboardMetrics conversion rate", () => {
  const body = fnBody(read(SERVICE), "getDashboardMetrics");

  it("counts the numerator over the same population as the denominator", () => {
    expect(body, "getDashboardMetrics not found").toBeTruthy();

    // Each of the three counts rendered together must carry the same population filter.
    const selected = /as selected FROM ats_candidate[\s\S]*?`/.exec(body)?.[0] ?? "";
    const rejected = /as rejected FROM ats_candidate[\s\S]*?`/.exec(body)?.[0] ?? "";
    const total = /as total FROM ats_candidate[\s\S]*?`/.exec(body)?.[0] ?? "";

    expect(total).toContain("active_status = 1");
    expect(
      selected,
      "conversion_rate = selected / total; if only total filters on active_status the rate " +
        "can exceed 100%",
    ).toContain("active_status = 1");
    expect(rejected).toContain("active_status = 1");
  });

  it("still excludes legacy employee records everywhere it counts candidates", () => {
    const counts = body.match(/FROM ats_candidate/g) ?? [];
    const excludes = body.match(/EXCLUDE_EMPLOYEE_SHAPED/g) ?? [];
    expect(counts.length).toBeGreaterThan(0);
    expect(excludes.length).toBeGreaterThanOrEqual(counts.length);
  });

  it("employees_joined_this_month excludes legacy rows via a join to ats_candidate", () => {
    // It read ats_candidate_stage_log alone, so a stage row belonging to one of the 29,926
    // legacy employee records counted as a joiner.
    const joined = /as joined[\s\S]*?`/.exec(body)?.[0] ?? "";
    expect(joined).toContain("JOIN ats_candidate c");
    expect(joined).toContain("EXCLUDE_EMPLOYEE_SHAPED_C");
  });
});

describe("getBranchMetrics fan-out", () => {
  const body = fnBody(read(SERVICE), "getBranchMetrics");

  it("joins ats_queue_token, so every measure must be distinct-counted", () => {
    expect(body).toContain("LEFT JOIN ats_queue_token");
    expect(body).toContain("COUNT(DISTINCT c.id) as total_candidates");
  });

  it("selected_count and pending_interviews cannot be inflated by duplicate token rows", () => {
    expect(
      body,
      "SUM(CASE ... THEN 1) over a fanned-out join counts a candidate once per token; " +
        "selected_count could then exceed total_candidates.",
    ).not.toMatch(/SUM\(CASE WHEN c\.current_stage[\s\S]*?\) as (selected_count|pending_interviews)/);

    expect(body).toMatch(/COUNT\(DISTINCT CASE WHEN c\.current_stage[\s\S]*?END\) as selected_count/);
    expect(body).toMatch(/COUNT\(DISTINCT CASE WHEN c\.current_stage[\s\S]*?END\) as pending_interviews/);
  });
});

describe("report-suite ATS date bounds and exclusion", () => {
  const src = read("src/modules/reporting/report-suite.routes.ts");

  it("candidate-source-analysis excludes legacy employee records", () => {
    const block = /case "candidate-source-analysis": \{[\s\S]*?\n    \}/.exec(src)?.[0] ?? "";
    expect(block, "case not found").toBeTruthy();
    expect(block).toContain("excludeEmployeeShapedCandidatesSql");
  });

  it("the ATS report date range includes the final day", () => {
    // `to` defaults to a bare YYYY-MM-DD, which MySQL coerces to midnight against a DATETIME,
    // so BETWEEN dropped everything recorded during the last day of the range — 15 candidate
    // rows as of 2026-08-11, and a full day's worth by any evening.
    for (const code of ["candidate-source-analysis", "ats-pipeline-summary"]) {
      const block = new RegExp(`case "${code}": \\{[\\s\\S]*?\\n    \\}`).exec(src)?.[0] ?? "";
      expect(block, `${code} not found`).toBeTruthy();
      expect(block, `${code} must not pass a bare date as the BETWEEN upper bound`).toMatch(
        /params\.push\(from, endOfDayParam\(to\)\)/,
      );
    }
  });

  it("endOfDayParam exists and produces an end-of-day timestamp", () => {
    expect(src).toMatch(/function endOfDayParam\(date: string\): string \{[\s\S]*?23:59:59/);
  });
});
