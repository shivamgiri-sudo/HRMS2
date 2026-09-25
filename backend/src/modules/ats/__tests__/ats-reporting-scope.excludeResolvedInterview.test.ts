import { describe, expect, it } from "vitest";
import { excludeResolvedInterviewCandidatesSql } from "../ats-reporting-scope.js";

describe("excludeResolvedInterviewCandidatesSql", () => {
  const sql = excludeResolvedInterviewCandidatesSql("ats_candidate");

  it("excludes a candidate whose interview submission is not older than its last update", () => {
    expect(sql).toMatch(
      /NOT EXISTS\s*\(\s*SELECT 1 FROM ats_interview_submission ais\s*WHERE ais\.candidate_id = ats_candidate\.id\s*AND ais\.submitted_at >= DATE_SUB\(ats_candidate\.updated_at, INTERVAL \d+ MINUTE\)\s*\)/,
    );
  });

  it("does not exclude a candidate re-opened after their submission (updated_at moved past it)", () => {
    // Live 2026-09-25: PARIKSHIT KAUSHIK was Rejected 09-18, re-opened to Waiting / Round 2 on
    // 09-25, and stayed hidden from RAKHI's My Candidates because any submission row excluded him.
    expect(sql).toContain("ais.submitted_at >= DATE_SUB(");
    expect(sql).not.toMatch(/ais\.candidate_id = ats_candidate\.id\s*\)/);
  });

  it("does not exclude on a no-show queue token — the candidate stays until their status is closed", () => {
    // Live 2026-09-25: ~25 candidates still Waiting had a queue token marked no_show (button or auto
    // sweep, which never touches ats_candidate) and disappeared from five recruiters' My Candidates.
    // Owner: they must stay until the status is closed — Selected, Rejected, Hold, No Show, anything.
    expect(sql).not.toMatch(/no_show/);
    expect(sql).not.toContain("ats_queue_token");
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
    expect(aliased).not.toContain("ats_candidate.id");
  });
});
