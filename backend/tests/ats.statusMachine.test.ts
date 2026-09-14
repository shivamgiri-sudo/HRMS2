/**
 * Guards ats.status-machine.ts against two regressions.
 *
 * The audit finding this closes: the guard's vocabulary (Applied, Screening,
 * HR Interview, Selected, Offered, Joined...) had zero overlap with what the
 * live recruiter flow actually writes to current_stage (Arrival,
 * Round 1- HR Screening, ..., Selection Discussion). Because the source stage
 * was never recognised, `allowed` was undefined and the guard was skipped —
 * any transition committed, including moving a candidate whose outcome was
 * already 'Rejected' to a terminal stage.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn() },
}));

import { db } from "../src/db/mysql.js";
import { transitionCandidateState } from "../src/modules/ats/ats.status-machine.js";

function candidateRow(current_stage: string, status: string) {
  return [[{ id: "cand-1", current_stage, status }], []];
}

describe("transitionCandidateState", () => {
  beforeEach(() => vi.clearAllMocks());

  it("TC-SM-01: refuses to move a Rejected candidate, regardless of target stage", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce(candidateRow("Selection Discussion", "Rejected") as never);

    const result = await transitionCandidateState("cand-1", "Onboarded", "actor-1");

    expect(result.success, "a Rejected candidate was moved anyway").toBe(false);
    expect(result.message).toMatch(/already "Rejected"/i);
    // Only the SELECT should have run — no UPDATE, no stage-log INSERT.
    expect(vi.mocked(db.execute)).toHaveBeenCalledTimes(1);
  });

  it("TC-SM-02: the real live vocabulary is recognised and progresses normally", async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce(candidateRow("Round 1- HR Screening", "Waiting") as never)
      .mockResolvedValueOnce([{}, []] as never) // UPDATE
      .mockResolvedValueOnce([{}, []] as never); // stage log INSERT

    const result = await transitionCandidateState("cand-1", "Round 2- Op's", "actor-1");

    expect(result.success, result.message).toBe(true);
    expect(result.fromStage).toBe("Round 1- HR Screening");
    expect(result.toStage).toBe("Round 2- Op's");
  });

  it("TC-SM-03: an unrecognised source stage fails closed instead of allowing anything", async () => {
    // "Interview" is stray legacy data seen in production, not a real stage.
    vi.mocked(db.execute).mockResolvedValueOnce(candidateRow("Interview", "Waiting") as never);

    const result = await transitionCandidateState("cand-1", "Onboarded", "actor-1");

    expect(result.success, "an unrecognised stage silently allowed the transition").toBe(false);
    expect(result.message).toMatch(/not a recognised stage/i);
    expect(vi.mocked(db.execute)).toHaveBeenCalledTimes(1);
  });

  it("TC-SM-04: Selection Discussion is terminal for this machine — outcome lives on status", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce(candidateRow("Selection Discussion", "Waiting") as never);

    const result = await transitionCandidateState("cand-1", "Onboarded", "actor-1");

    expect(result.success, "Selection Discussion should not itself advance current_stage").toBe(false);
  });

  it("TC-SM-05: a skip-ahead jump is refused even with a legitimate outcome", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce(candidateRow("Applied", "Waiting") as never);

    const result = await transitionCandidateState("cand-1", "Round 3- Client", "actor-1");

    expect(result.success, "Applied -> Round 3- Client skipped every intermediate round").toBe(false);
    expect(result.message).toMatch(/not allowed/i);
  });

  it("TC-SM-06: Onboarded is terminal — nothing moves a converted candidate further", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce(candidateRow("Onboarded", "Waiting") as never);

    const result = await transitionCandidateState("cand-1", "Applied", "actor-1");

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/terminal stage/i);
  });
});
