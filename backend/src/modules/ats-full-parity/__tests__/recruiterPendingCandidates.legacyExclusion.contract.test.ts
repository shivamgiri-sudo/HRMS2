import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The recruiter's "My Candidates" pending queue must not count legacy employee records.
 *
 * `ats_candidate` holds ~29,926 rows bulk-imported from the employee roster, tagged
 * `record_type = 'legacy_employee'`. Migration 999's blanket `status = 'Waiting'` backfill
 * (for rows with no explicit status) sweeps many of these into exactly the predicate
 * `getMyPendingCandidates`/`getOtherRecruitersPendingCandidates` match on, inflating the
 * "Pending" badge on the recruiter's My Candidates page well above the real queue size.
 *
 * ~20 other call sites already guard against this via the shared helper
 * `excludeEmployeeShapedCandidatesSql()` (backend/src/modules/ats/ats-reporting-scope.ts).
 * These two functions were the gap.
 *
 * Why source-inspection rather than behavioural: no harness in this repo runs ATS SQL
 * against a live database; asserting on the query text is the strongest check available.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const SERVICE = "src/modules/ats-full-parity/recruiterInterview.service.ts";

/** Pull one exported function body out of the module source. */
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  if (start === -1) return "";
  const next = src.indexOf("\nexport async function ", start + 1);
  return src.slice(start, next === -1 ? src.length : next);
}

describe("recruiter pending-candidate queues exclude legacy employee records", () => {
  const src = read(SERVICE);

  it("imports the shared exclusion helper", () => {
    expect(src).toMatch(/import\s*\{[^}]*excludeEmployeeShapedCandidatesSql[^}]*\}/);
  });

  it("getMyPendingCandidates applies the exclusion", () => {
    const body = functionBody(src, "getMyPendingCandidates");
    expect(body, "getMyPendingCandidates() must exist").toBeTruthy();
    expect(
      body,
      "Without excludeEmployeeShapedCandidatesSql, this feeds the recruiter's My Candidates " +
        "'Pending Queue' badge, which is a raw .length of this query's result.",
    ).toContain("excludeEmployeeShapedCandidatesSql");
  });

  it("getOtherRecruitersPendingCandidates applies the exclusion", () => {
    const body = functionBody(src, "getOtherRecruitersPendingCandidates");
    expect(body, "getOtherRecruitersPendingCandidates() must exist").toBeTruthy();
    expect(body).toContain("excludeEmployeeShapedCandidatesSql");
  });

  it("uses the alias the queries actually declare", () => {
    // Both queries are `FROM ats_candidate` with no alias — a mismatched alias string would
    // be an ER_BAD_FIELD_ERROR at runtime, not a silent no-op.
    const myBody = functionBody(src, "getMyPendingCandidates");
    const otherBody = functionBody(src, "getOtherRecruitersPendingCandidates");
    expect(myBody).toMatch(/excludeEmployeeShapedCandidatesSql\(\s*["']ats_candidate["']\s*\)/);
    expect(otherBody).toMatch(/excludeEmployeeShapedCandidatesSql\(\s*["']ats_candidate["']\s*\)/);
  });
});

/**
 * Owner ruling 2026-09-22: "if the form has been submitted by recruiter [...] there should be no
 * pendency". `status`/`current_stage` is what these two queries actually filter on, and two write
 * paths can close a candidate out without ever touching either column (see
 * excludeResolvedInterviewCandidatesSql's own header for the live evidence: 10 of a 145-candidate
 * pending queue already had a completed/no_show queue token with status still 'Waiting'). This is
 * the read-side fix: exclude by the presence of a submission or a closed queue token, so a
 * candidate the recruiter already actioned cannot outlive that action in the pending count.
 */
describe("recruiter pending-candidate queues exclude candidates already resolved", () => {
  const src = read(SERVICE);

  it("imports the shared exclusion helper", () => {
    expect(src).toMatch(/import\s*\{[^}]*excludeResolvedInterviewCandidatesSql[^}]*\}/);
  });

  it("getMyPendingCandidates applies the exclusion", () => {
    const body = functionBody(src, "getMyPendingCandidates");
    expect(body).toContain("excludeResolvedInterviewCandidatesSql");
  });

  it("getOtherRecruitersPendingCandidates applies the exclusion", () => {
    const body = functionBody(src, "getOtherRecruitersPendingCandidates");
    expect(body).toContain("excludeResolvedInterviewCandidatesSql");
  });

  it("uses the alias the queries actually declare", () => {
    const myBody = functionBody(src, "getMyPendingCandidates");
    const otherBody = functionBody(src, "getOtherRecruitersPendingCandidates");
    expect(myBody).toMatch(/excludeResolvedInterviewCandidatesSql\(\s*["']ats_candidate["']\s*\)/);
    expect(otherBody).toMatch(/excludeResolvedInterviewCandidatesSql\(\s*["']ats_candidate["']\s*\)/);
  });
});
