import { describe, it, expect } from "vitest";
import { deriveAtsStageSnapshot, buildRecruitmentFunnel } from "../dashboard-data-contracts";

/**
 * by_stage's keys are the literal current_stage values a candidate is sitting in right
 * now, taken verbatim from production 2026-08-27 — not a normalized vocabulary, and
 * casing is genuinely inconsistent (Title Case from the candidate web form, snake_case
 * from later ATS workflow stages sitting in the same object).
 *
 * buildRecruitmentFunnel previously did exact-key lookups like byStage["hr_round"],
 * byStage["skill_test"] and byStage["offered"] (lowercase) against this — none of which
 * exist verbatim — so 9 of its 12 bars always evaluated to 0 and the Recruiter Dashboard
 * showed "Recruitment funnel source unavailable" over a real, populated pipeline.
 */
const REAL_BY_STAGE = {
  "Applied": 34902,
  "Offered": 1249,
  "Round1-HRScreening": 875,
  "Round2-Op's": 496,
  "Arrival": 221,
  "Interview-SkillTest": 150,
  "Arrived": 84,
  "Round3-Client": 71,
  "SelectionDiscussion": 34,
  "Onboarded": 28,
  "offer_approved": 26,
  "Screening": 21,
  "converted": 16,
  "selected": 7,
  "payroll_validated": 4,
  "New": 3,
  "Interview": 3,
};

describe("deriveAtsStageSnapshot", () => {
  it("matches real, mixed-case production stage names, not just a normalized vocabulary", () => {
    const snapshot = deriveAtsStageSnapshot(REAL_BY_STAGE, 38191);
    expect(snapshot.applications).toBe(38191);
    // "Round1-HRScreening" (875) + "Screening" (21) = 896
    expect(snapshot.screened).toBe(896);
    // "Round2-Op's" (496) + "Interview-SkillTest" (150) + "Round3-Client" (71) + "Interview" (3) = 720
    expect(snapshot.interviewed).toBe(720);
    // "Offered" (1249) + "offer_approved" (26) = 1275
    expect(snapshot.offered).toBe(1275);
    // "Onboarded" (28) + "converted" (16) + "payroll_validated" (4) = 48
    expect(snapshot.joined).toBe(48);
  });

  it("none of the five stages silently zero out on real data", () => {
    // The previous implementation's failure mode was not "wrong numbers" but "every
    // number is 0" — this is the regression that failure mode must never reproduce.
    const snapshot = deriveAtsStageSnapshot(REAL_BY_STAGE, 38191);
    for (const [key, value] of Object.entries(snapshot)) {
      expect(value, `${key} resolved to 0/null against real production stage names`).not.toBe(0);
      expect(value, `${key} resolved to 0/null against real production stage names`).not.toBeNull();
    }
  });

  it("returns null, not 0, for a stage with no matching rows — distinct from a real zero", () => {
    const snapshot = deriveAtsStageSnapshot({ Applied: 10 }, 10);
    expect(snapshot.offered).toBeNull();
  });

  it("is disjoint by design: a later stage can exceed an earlier one without being wrong", () => {
    // Offered (1275) exceeding Interviewed (720) is not a contradiction here — these are
    // current-stage snapshots, not sequential pass-through counts. A caller must not
    // treat this shape as a bug.
    const snapshot = deriveAtsStageSnapshot(REAL_BY_STAGE, 38191);
    expect(snapshot.offered!).toBeGreaterThan(snapshot.interviewed!);
  });
});

describe("buildRecruitmentFunnel", () => {
  it("returns five honest, non-zero stages against the real payload shape", () => {
    const stages = buildRecruitmentFunnel({ total_candidates: 38191, by_stage: REAL_BY_STAGE });
    expect(stages.map((s) => s.label)).toEqual([
      "Applications", "Screened", "Interviewed", "Offered", "Joined",
    ]);
    expect(stages.every((s) => s.value > 0)).toBe(true);
    expect(stages.find((s) => s.label === "Offered")!.value).toBe(1275);
  });
});
