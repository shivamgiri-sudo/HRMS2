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
  it("analytics.unified.service.ts uses it at all 13 verified live sites", () => {
    const source = read("src/modules/ats/analytics.unified.service.ts");
    expect(source).toContain("excludeEmployeeShapedCandidatesSql");
    const usages = (source.match(/\$\{EXCLUDE_EMPLOYEE_SHAPED\}/g) ?? []).length;
    expect(usages).toBe(13);
  });

  it("command-centre.service.ts uses it at all 11 verified live sites", () => {
    const source = read("src/modules/ats/command-centre.service.ts");
    expect(source).toContain("excludeEmployeeShapedCandidatesSql");
    const usages = (source.match(/\$\{EXCLUDE_EMPLOYEE_SHAPED(_C)?\}/g) ?? []).length;
    expect(usages).toBe(11);
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
    const fn = source.match(/async getDashboardStats\([\s\S]*?\n  \},/);
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
    const caseBlock = source.match(/case "ats-pipeline-summary": \{[\s\S]*?\n    \}/);
    expect(caseBlock, "ats-pipeline-summary case not found").toBeTruthy();
    expect(caseBlock![0]).toContain("excludeEmployeeShapedCandidatesSql");
  });
});
