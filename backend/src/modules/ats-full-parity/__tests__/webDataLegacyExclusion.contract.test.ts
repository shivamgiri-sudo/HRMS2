import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The ATS Command Center's ten tabs must not count legacy employee records.
 *
 * `ats_candidate` holds 37,686 rows, of which 29,926 are legacy EMPLOYEE records whose
 * `candidate_code` matches a real `employees.employee_code`, and only 7,760 are genuine
 * candidates (measured against production 2026-08-11). "Applied" reads 34,923 with them and
 * 5,056 without — a 6.9x inflation on the top of the funnel.
 *
 * Every tab of NativeATSFullParityCommandCenter — Cover, Dashboard, Trends, Rejections,
 * Recruiters, Sourcing, Live Queue, Journey — is rendered from one call to
 * `/api/ats-full-parity/web-data`, which is `atsFullParityService.webData()`. So a single
 * missing predicate there is the whole dashboard.
 *
 * Why this test is source-inspection rather than behavioural: every figure on that dashboard
 * is computed in JavaScript over the rows this query returns, and the repo has no harness
 * that runs ATS analytics SQL against a database. Asserting on the query is the strongest
 * check available without inventing one.
 *
 * NOTE ON SCOPE — the exclusion belongs to the aggregate, not to the row fetcher.
 * candidateSelect() is shared with single-candidate lookups (`c.id = ?`) and with
 * candidateJourney()'s search. Both must still find an ex-employee's record, so pushing the
 * predicate down into candidateSelect would be a regression dressed as a fix.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const SERVICE = "src/modules/ats-full-parity/atsFullParity.service.ts";

/** Pull one method body out of the exported service object. */
function methodBody(src: string, name: string): string {
  const start = src.indexOf(`async ${name}(`);
  if (start === -1) return "";
  const next = src.indexOf("\n  async ", start + 1);
  return src.slice(start, next === -1 ? src.length : next);
}

/** Pull a top-level `async function name(` body out of the module. */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`async function ${name}(`);
  if (start === -1) return "";
  const next = src.indexOf("\nasync function ", start + 1);
  return src.slice(start, next === -1 ? src.length : next);
}

describe("web-data excludes legacy employee records", () => {
  const src = read(SERVICE);

  it("imports the shared exclusion helper rather than hand-rolling the predicate", () => {
    // A second, hand-written NOT EXISTS would drift from the canonical one; there are already
    // four rival funnel implementations in this module family.
    expect(src).toMatch(/import\s*\{\s*excludeEmployeeShapedCandidatesSql\s*\}/);
  });

  /**
   * The WHERE clause moved into buildCandidateFilters() when commandCenterData() was added,
   * so the exclusion is asserted where it now lives — and, more importantly, both aggregate
   * paths are asserted to go through it. Two aggregates over ats_candidate that build their
   * own predicates is exactly how one of them ends up counting 29,926 employee records.
   */
  it("the shared filter builder applies the exclusion", () => {
    const body = fnBody(src, "buildCandidateFilters");
    expect(body, "buildCandidateFilters() must exist").toBeTruthy();
    expect(
      body,
      "buildCandidateFilters feeds every tab of the ATS Command Center. Without " +
        "excludeEmployeeShapedCandidatesSql the dashboard counts 29,926 employee records as " +
        "candidates.",
    ).toContain("excludeEmployeeShapedCandidatesSql");
  });

  it("uses the alias the query actually declares", () => {
    // The query is `FROM ats_candidate c`, so the predicate must be built for "c" — a
    // mismatched alias is an ER_BAD_FIELD_ERROR at runtime, not a silent no-op, but it would
    // only surface when the dashboard is opened.
    const body = fnBody(src, "buildCandidateFilters");
    expect(body).toMatch(/excludeEmployeeShapedCandidatesSql\(\s*["']c["']\s*\)/);
  });

  it.each(["webData", "commandCenterData"])(
    "%s builds its WHERE clause with the shared builder rather than its own",
    (method) => {
      const body = methodBody(src, method);
      expect(body, `${method}() must exist`).toBeTruthy();
      expect(
        body,
        `${method} must call buildCandidateFilters. A locally rebuilt WHERE clause would drift ` +
          "from the legacy exclusion and the scope predicate, and the two dashboards would " +
          "answer the same question with different numbers.",
      ).toContain("buildCandidateFilters(filters)");
      expect(
        body,
        `${method} must not hand-roll the exclusion it gets from the shared builder.`,
      ).not.toContain("excludeEmployeeShapedCandidatesSql");
    },
  );

  it("does NOT push the exclusion into candidateSelect, which serves lookups too", () => {
    const start = src.indexOf("async function candidateSelect");
    const body = src.slice(start, src.indexOf("\n}", start));
    expect(
      body,
      "candidateSelect is used for `c.id = ?` lookups and candidateJourney's search; both " +
        "must still find an ex-employee record.",
    ).not.toContain("excludeEmployeeShapedCandidatesSql");
  });
});

describe("web-data reports truncation instead of hiding it", () => {
  const src = read(SERVICE);

  it.each(["webData", "commandCenterData"])("%s returns a truncation flag alongside the numbers", (method) => {
    const body = methodBody(src, method);
    // Genuine candidates already number 7,760, so the old implicit 5,000 cap was reached in
    // normal operation and every total silently described a subset.
    expect(body).toMatch(/truncated/);
    expect(body).toMatch(/rowsLoaded/);
  });

  it("the aggregate cap is above the current genuine-candidate population", () => {
    const m = /const WEB_DATA_ROW_LIMIT = (\d+)/.exec(src);
    expect(m, "WEB_DATA_ROW_LIMIT must be declared").toBeTruthy();
    expect(Number(m![1])).toBeGreaterThan(7760);
  });

  it("webData passes the explicit limit rather than relying on the default", () => {
    const body = methodBody(src, "webData");
    // Not [^)]* — the argument list contains conds.join(" AND "), so the first ")" is inside it.
    expect(body).toMatch(/candidateSelect\([\s\S]{0,140}?WEB_DATA_ROW_LIMIT/);
  });
});
