/**
 * ats_candidate (37,562 rows) contains 29,926 rows whose candidate_code exactly
 * matches a real employees.employee_code — confirmed live. This is legacy data (the
 * employee roster was bulk-imported into this table at some point); no current
 * application code path sources ats_candidate from employees. Every dashboard/funnel/
 * conversion/source-effectiveness query that counted ats_candidate rows without
 * excluding these overstated its numbers by roughly 4x.
 *
 * excludeEmployeeShapedCandidatesSql() (ats-reporting-scope.ts) is the shared fix.
 * This test asserts both the helper's own correctness and that it's actually wired
 * into every live call site identified in the audit — source-inspection style,
 * matching this repo's established contract-test pattern.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { excludeEmployeeShapedCandidatesSql } from "../ats-reporting-scope.js";

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

describe("excludeEmployeeShapedCandidatesSql", () => {
  it("builds a NOT EXISTS fragment keyed off the caller's alias", () => {
    expect(excludeEmployeeShapedCandidatesSql("c")).toBe(
      "NOT EXISTS (SELECT 1 FROM employees e2 WHERE e2.employee_code = c.candidate_code)",
    );
  });

  it("uses a fixed e2 alias so it's safe next to an existing `employees e` join", () => {
    expect(excludeEmployeeShapedCandidatesSql("ats_candidate")).toContain(" e2 ");
    expect(excludeEmployeeShapedCandidatesSql("ats_candidate")).not.toMatch(/\be\./);
  });
});

describe("live call sites are wired to the exclusion helper", () => {
  /**
   * analytics.unified.service.ts USED to be asserted here, at all 13 of its sites. It is the
   * cleanest implementation in the module — and it has zero importers. Nothing routes to it,
   * nothing imports it dynamically; the only references anywhere in backend/src are the file
   * itself and this test. So that assertion guarded code no user can reach, while the
   * surfaces that ARE reachable were asserted nowhere.
   *
   * A test that protects an unimportable file is worse than no test: it reports the module as
   * covered. The assertions below deliberately name only surfaces that are reachable from a
   * mounted route.
   */
  it("analytics.unified.service.ts is still dead — if it gains an importer, assert it too", () => {
    const importers = [
      "src/modules/ats/ats.routes.ts",
      "src/modules/ats/ats.controller.ts",
      "src/modules/ats-extensions/ats-ext.routes.ts",
      "src/modules/ats-full-parity/atsFullParity.routes.ts",
    ].filter((f) => {
      try { return read(f).includes("analytics.unified"); } catch { return false; }
    });
    expect(
      importers,
      "analytics.unified.service.ts has become reachable. Add a usage assertion for it here, " +
        "because its exclusions now matter.",
    ).toEqual([]);
  });

  it("command-centre.service.ts uses it at all 13 verified live sites", () => {
    const source = read("src/modules/ats/command-centre.service.ts");
    expect(source).toContain("excludeEmployeeShapedCandidatesSql");
    const usages = (source.match(/\$\{EXCLUDE_EMPLOYEE_SHAPED(_C)?\}/g) ?? []).length;
    // Was 11. Two sites were added deliberately, and the exact count is what forced them to
    // be noticed rather than absorbed:
    //   - employees_joined_this_month, which read ats_candidate_stage_log alone, so a stage
    //     row belonging to a legacy employee record counted as a joiner;
    //   - the pending_approvals subquery, which selected ids from ats_candidate unfiltered.
    expect(usages).toBe(13);
  });

  it("getStageDistribution excludes on both the numerator and the denominator subquery", () => {
    const source = read("src/modules/ats/command-centre.service.ts");
    const fn = source.match(/export async function getStageDistribution[\s\S]*?\n\}/);
    expect(fn, "getStageDistribution not found").toBeTruthy();
    const usages = (fn![0].match(/\$\{EXCLUDE_EMPLOYEE_SHAPED\}/g) ?? []).length;
    expect(usages, "both the outer COUNT(*) and the inner denominator subquery must exclude, or the percentage column desyncs").toBe(2);
  });

  it("ats.service.ts getDashboardStats excludes at all 4 edit points", () => {
    const source = read("src/modules/ats/ats.service.ts");
    const fn = source.match(/async getDashboardStats\([\s\S]*?\n {2}\},/);
    expect(fn, "getDashboardStats not found").toBeTruthy();
    const usages = (fn![0].match(/excludeEmployeeShapedCandidatesSql/g) ?? []).length;
    // 1 in the shared `conds` array (covers 4 SELECTs) + 3 separate hardcoded queries.
    expect(usages).toBe(4);
  });

  it("recruitment.executor.ts's recruitmentPipeline excludes inside the LEFT JOIN ON clause", () => {
    const source = read("src/modules/reporting/executors/recruitment.executor.ts");
    const fn = source.match(/export async function recruitmentPipeline[\s\S]*?\n\}/);
    expect(fn, "recruitmentPipeline not found").toBeTruthy();
    expect(fn![0]).toMatch(/LEFT JOIN ats_candidate c[\s\S]*?ON[\s\S]*?excludeEmployeeShapedCandidatesSql\("c"\)[\s\S]*?WHERE/);
  });

  it("report-suite.routes.ts's ats-pipeline-summary case excludes", () => {
    const source = read("src/modules/reporting/report-suite.routes.ts");
    const caseBlock = source.match(/case "ats-pipeline-summary": \{[\s\S]*?\n {4}\}/);
    expect(caseBlock, "ats-pipeline-summary case not found").toBeTruthy();
    expect(caseBlock![0]).toContain("excludeEmployeeShapedCandidatesSql");
  });

  /**
   * The named metrics leadership actually reads. Both aggregate ats_candidate directly and
   * neither excluded, so both were roughly 4x inflated.
   */
  it("recruitment.executor.ts's sourceEffectiveness excludes", () => {
    const source = read("src/modules/reporting/executors/recruitment.executor.ts");
    const fn = source.match(/export async function sourceEffectiveness[\s\S]*?\n\}/);
    expect(fn, "sourceEffectiveness not found").toBeTruthy();
    expect(fn![0]).toContain("excludeEmployeeShapedCandidatesSql");
  });

  it("recruitment.executor.ts's recruiterProductivity excludes", () => {
    const source = read("src/modules/reporting/executors/recruitment.executor.ts");
    const fn = source.match(/export async function recruiterProductivity[\s\S]*?\n\}/);
    expect(fn, "recruiterProductivity not found").toBeTruthy();
    expect(fn![0]).toContain("excludeEmployeeShapedCandidatesSql");
  });

  it("sourceEffectiveness applies a restricted PROCESS scope, not only a branch one", () => {
    // It threw on processScope "none" but never emitted a predicate for "restricted", so a
    // process-restricted viewer read every process inside their branches.
    const source = read("src/modules/reporting/executors/recruitment.executor.ts");
    const fn = source.match(/export async function sourceEffectiveness[\s\S]*?\n\}/)![0];
    expect(fn).toMatch(/processScope\.mode === "restricted"/);
    expect(fn).toMatch(/applied_for_process IN \(SELECT process_name/);
  });

  it("recruiterProductivity counts candidates distinctly, so the employees join cannot inflate it", () => {
    // The join is on user_id, which is not unique among active rows: one user_id currently
    // carries 50 active employees rows, which multiplied that recruiter's totals by 50.
    const source = read("src/modules/reporting/executors/recruitment.executor.ts");
    const fn = source.match(/export async function recruiterProductivity[\s\S]*?\n\}/)![0];
    expect(fn).toContain("COUNT(DISTINCT c.id) AS total_candidates");
    expect(fn).not.toMatch(/COUNT\(\*\) AS total_candidates/);
    // The two measures beside it must be distinct-counted for the same reason.
    expect(fn).toMatch(/COUNT\(DISTINCT CASE[\s\S]*?END\) AS offers_made/);
    expect(fn).toMatch(/COUNT\(DISTINCT CASE[\s\S]*?END\) AS joinings/);
  });

  it("the ATS Command Center's web-data feed excludes", () => {
    const source = read("src/modules/ats-full-parity/atsFullParity.service.ts");
    expect(source).toContain("excludeEmployeeShapedCandidatesSql");
  });

  it("ats-ext's sourcing funnel excludes and filters inactive rows", () => {
    const source = read("src/modules/ats-extensions/ats-ext.service.ts");
    const fn = source.match(/async getFunnel\([\s\S]*?\n {2}\}/);
    expect(fn, "getFunnel not found").toBeTruthy();
    expect(fn![0]).toContain("excludeEmployeeShapedCandidatesSql");
    expect(fn![0], "it started from 1=1 and counted inactive rows too").toContain("active_status = 1");
  });
});
