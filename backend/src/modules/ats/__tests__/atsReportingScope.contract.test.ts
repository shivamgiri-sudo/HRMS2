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
import { excludeEmployeeShapedCandidatesSql, recordTypeDriftSql } from "../ats-reporting-scope.js";

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

describe("excludeEmployeeShapedCandidatesSql", () => {
  /**
   * This used to emit a correlated NOT EXISTS against employees, which ~20 call sites each
   * re-ran over 30k rows. Migration 1130 added ats_candidate.record_type and the backfill
   * populated it (29,926 legacy_employee / 7,770 candidate, applied 2026-08-11).
   *
   * Equivalence was measured on production before the switch: 7,770 rows included under both
   * predicates, ZERO row-by-row disagreements, byte-identical funnel output, and count latency
   * down from 18,783ms to 4,428ms.
   */
  it("filters on the indexed provenance column, keyed off the caller's alias", () => {
    expect(excludeEmployeeShapedCandidatesSql("c")).toBe("c.record_type = 'candidate'");
    expect(excludeEmployeeShapedCandidatesSql("ats_candidate")).toBe(
      "ats_candidate.record_type = 'candidate'",
    );
  });

  it("introduces no join, so it stays safe to append to any query", () => {
    // The old fragment carried its own `employees e2` subquery and had to avoid colliding with
    // an existing `employees e` join. A bare column predicate cannot collide with anything.
    const frag = excludeEmployeeShapedCandidatesSql("ats_candidate");
    expect(frag).not.toMatch(/SELECT|JOIN|EXISTS/i);
  });

  it("selects candidates, not legacy rows — the polarity is easy to invert", () => {
    // A fragment reading record_type = 'legacy_employee' would compile, run, and return
    // precisely the 29,926 rows this exists to remove.
    expect(excludeEmployeeShapedCandidatesSql("c")).toContain("'candidate'");
    expect(excludeEmployeeShapedCandidatesSql("c")).not.toContain("legacy_employee");
  });

  it("ships the drift check, because the column is a snapshot of a join", () => {
    // New rows default to 'candidate'. Another bulk load of employee-shaped rows would arrive
    // labelled 'candidate' and silently rejoin the counts, so the check has to be runnable.
    const sql = recordTypeDriftSql();
    expect(sql).toContain("legacy_mislabelled");
    expect(sql).toContain("genuine_mislabelled");
    expect(sql).toContain("e.employee_code = ac.candidate_code");
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
    // 1 in the shared `conds` array (covers 4 SELECTs) + 2 separate hardcoded queries.
    //
    // Was 3 hardcoded until 1f0d801c. That commit replaced the open-positions query — a
    // COUNT(DISTINCT applied_for_process) over ats_candidate, used as a pipeline proxy — with a
    // SUM of unfilled headcount over job_requisition, which is the actual open demand. The
    // exclusion left with the query it belonged to, correctly: job_requisition holds
    // requisitions, not candidates, so there are no employee-shaped rows to exclude.
    //
    // Counting call sites is a proxy for "every ats_candidate read is scoped", and the proxy
    // goes stale whenever a read is legitimately removed. The assertion below is the one that
    // actually matters, so check it first if this number ever disagrees again: adding a
    // redundant exclusion to make this equal 4 would satisfy the count and scope nothing.
    expect(usages).toBe(3);

    // The real invariant: no ats_candidate read inside this function is left unscoped. Every
    // FROM ats_candidate must either sit behind the shared `where` (built from `conds`) or
    // carry its own exclusion.
    const candidateReads = (fn![0].match(/FROM ats_candidate/g) ?? []).length;
    const scopedReads = (fn![0].match(/FROM ats_candidate[\s\S]{0,400}?(\$\{where\}|excludeEmployeeShapedCandidatesSql)/g) ?? []).length;
    expect(scopedReads, "an ats_candidate read in getDashboardStats is not scoped — it would count the ~29,926 legacy employee rows").toBe(candidateReads);
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
   * management.service.ts — the CEO/management dashboards. Missed by the original sweep and
   * caught by the 2026-08-14 delta-audit. Measured live 2026-08-15 before the fix:
   * open_candidates reported 37,815 against a true 7,889, a 379% overstatement, because every
   * legacy employee row sits in stage 'Applied' and none of these queries' NOT IN lists
   * exclude it.
   */
  it("management.service.ts's open hiring pipeline excludes", () => {
    const source = read("src/modules/management/management.service.ts");
    const block = source.match(/COUNT\(\*\) AS open_candidates[\s\S]*?`\s*\)/);
    expect(block, "open_candidates query not found").toBeTruthy();
    expect(block![0]).toContain("excludeEmployeeShapedCandidatesSql");
  });

  it("management.service.ts's candidate stage distribution excludes", () => {
    const source = read("src/modules/management/management.service.ts");
    const block = source.match(/AS stage, COUNT\(\*\) AS value[\s\S]*?ORDER BY value DESC`/);
    expect(block, "stage distribution query not found").toBeTruthy();
    expect(block![0]).toContain("excludeEmployeeShapedCandidatesSql");
  });

  it("management.service.ts's training_stage_candidates excludes", () => {
    const source = read("src/modules/management/management.service.ts");
    const block = source.match(/FROM ats_candidate[\s\S]{0,320}?AS training_stage_candidates/);
    expect(block, "training_stage_candidates subquery not found").toBeTruthy();
    expect(block![0]).toContain("excludeEmployeeShapedCandidatesSql");
  });

  /**
   * The deliberate exception, pinned so it reads as a decision rather than a miss. The module
   * UNION reports how many ROWS each module's table holds — it sits beside salary_prep_run and
   * leave_request row counts — so the legacy rows belong in it. Filtering there would make
   * "ATS records" disagree with the table it names.
   */
  it("management.service.ts's module row-count UNION deliberately does NOT exclude", () => {
    const source = read("src/modules/management/management.service.ts");
    const block = source.match(/'ATS' AS module_name[\s\S]*?FROM ats_candidate/);
    expect(block, "module row-count UNION not found").toBeTruthy();
    expect(block![0]).not.toContain("excludeEmployeeShapedCandidatesSql");
    // The reasoning must travel with it, or a later reader "fixes" it.
    expect(source).toMatch(/Deliberately NOT filtered by record_type/);
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
