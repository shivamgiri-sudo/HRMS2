import { describe, expect, it } from "vitest";
import { excludeResolvedInterviewCandidatesSql } from "../ats-reporting-scope.js";

describe("excludeResolvedInterviewCandidatesSql", () => {
  const sql = excludeResolvedInterviewCandidatesSql("ats_candidate");

  it("excludes a candidate with any interview submission row", () => {
    expect(sql).toMatch(
      /NOT EXISTS\s*\(\s*SELECT 1 FROM ats_interview_submission ais WHERE ais\.candidate_id = ats_candidate\.id\s*\)/,
    );
  });

  it("excludes a candidate whose queue token is no-show", () => {
    expect(sql).toMatch(
      /NOT EXISTS\s*\(\s*SELECT 1 FROM ats_queue_token aqt\s*WHERE aqt\.candidate_id = ats_candidate\.id AND aqt\.queue_status = 'no_show'\s*\)/,
    );
  });

  it("does not exclude on a completed queue token — the desk closes it before the recruiter's form is filled", () => {
    // Live 2026-09-24: recruiters MEHAR and KHUSHI MISHRA saw an empty queue because every
    // Waiting candidate's token had been marked 'completed' at the walk-in desk, with no
    // interview submission yet. Only a submission row proves the recruiter actioned it.
    expect(sql).not.toMatch(/'completed'/);
  });

  it("does not exclude on a still-open queue token (waiting/called/in_interview)", () => {
    expect(sql).not.toMatch(/'waiting'|'called'|'in_interview'/);
  });

  it("uses whatever alias the caller passes, not a hardcoded table name", () => {
    const aliased = excludeResolvedInterviewCandidatesSql("c");
    expect(aliased).toContain("ais.candidate_id = c.id");
    expect(aliased).toContain("aqt.candidate_id = c.id");
    expect(aliased).not.toContain("ats_candidate.id");
  });
});
