import { describe, expect, it } from "vitest";
import { excludeResolvedInterviewCandidatesSql } from "../ats-reporting-scope.js";

describe("excludeResolvedInterviewCandidatesSql", () => {
  const sql = excludeResolvedInterviewCandidatesSql("ats_candidate");

  it("excludes a candidate with any interview submission row", () => {
    expect(sql).toMatch(
      /NOT EXISTS\s*\(\s*SELECT 1 FROM ats_interview_submission ais WHERE ais\.candidate_id = ats_candidate\.id\s*\)/,
    );
  });

  it("excludes a candidate whose queue token is already completed or no-show", () => {
    expect(sql).toMatch(
      /NOT EXISTS\s*\(\s*SELECT 1 FROM ats_queue_token aqt\s*WHERE aqt\.candidate_id = ats_candidate\.id AND aqt\.queue_status IN \('completed', 'no_show'\)\s*\)/,
    );
  });

  it("does not exclude on a still-open queue token (waiting/called/in_interview)", () => {
    // The predicate names only the two terminal statuses — asserting the exact list guards
    // against someone widening it to swallow candidates still genuinely mid-interview.
    expect(sql).not.toMatch(/'waiting'|'called'|'in_interview'/);
  });

  it("uses whatever alias the caller passes, not a hardcoded table name", () => {
    const aliased = excludeResolvedInterviewCandidatesSql("c");
    expect(aliased).toContain("ais.candidate_id = c.id");
    expect(aliased).toContain("aqt.candidate_id = c.id");
    expect(aliased).not.toContain("ats_candidate.id");
  });
});
