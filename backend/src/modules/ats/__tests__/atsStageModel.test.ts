import { describe, expect, it } from "vitest";
import {
  canonicalStage,
  buildCanonicalFunnel,
  CANONICAL_STAGE_ORDER,
} from "../ats-stage-model.js";

/**
 * The stage vocabulary in ats_candidate.current_stage is free text carrying three rival
 * conventions. These are the exact values and counts measured on production 2026-08-11, so
 * the mapping is tested against reality rather than against an idealised list.
 */
const PRODUCTION_BUCKETS = [
  { stage: "Applied", count: 34923 },
  { stage: "Offered", count: 1250 },
  { stage: "Round 1- HR Screening", count: 685 },
  { stage: "Round 2- Op's", count: 359 },
  { stage: "Arrival", count: 150 },
  { stage: "Interview - Skill Test", count: 118 },
  { stage: "Arrived", count: 46 },
  { stage: "Round 3- Client", count: 40 },
  { stage: "Selection Discussion", count: 34 },
  { stage: "Onboarded", count: 28 },
  { stage: "Screening", count: 21 },
  { stage: "converted", count: 16 },
  { stage: "selected", count: 7 },
  { stage: "New", count: 3 },
  { stage: "Interview", count: 3 },
  { stage: "payroll_validated", count: 2 },
  { stage: "offer_approved", count: 1 },
];

describe("canonicalStage", () => {
  it("maps every stage value observed in production", () => {
    const unmapped = PRODUCTION_BUCKETS.filter((b) => canonicalStage(b.stage) === null);
    expect(unmapped.map((b) => b.stage)).toEqual([]);
  });

  it("merges Arrival and Arrived, which are one stage recorded two ways", () => {
    expect(canonicalStage("Arrival")).toBe("arrived");
    expect(canonicalStage("Arrived")).toBe("arrived");
  });

  it("folds machine states into the stage they represent", () => {
    expect(canonicalStage("converted")).toBe("onboarded");
    expect(canonicalStage("payroll_validated")).toBe("onboarded");
    expect(canonicalStage("offer_approved")).toBe("offered");
  });

  it("is insensitive to the casing drift between call sites", () => {
    // command-centre matches lowercase, ats-full-parity TitleCase, ats.service hedges both.
    expect(canonicalStage("SELECTED")).toBe("selected");
    expect(canonicalStage("  offered  ")).toBe("offered");
    expect(canonicalStage("Round 1-  HR   Screening")).toBe("screening");
  });

  it("returns null for an unknown value instead of defaulting it to Applied", () => {
    // The old COALESCE(NULLIF(current_stage,''),'Applied') is precisely how ~30k rows piled
    // onto the top of the funnel.
    expect(canonicalStage("Some New Stage")).toBeNull();
    expect(canonicalStage("")).toBeNull();
    expect(canonicalStage(null)).toBeNull();
  });
});

describe("buildCanonicalFunnel", () => {
  const funnel = buildCanonicalFunnel(PRODUCTION_BUCKETS);

  it("is monotonically non-increasing — a funnel cannot widen", () => {
    const reached = funnel.steps.map((s) => s.reached);
    for (let i = 1; i < reached.length; i++) {
      expect(reached[i]).toBeLessThanOrEqual(reached[i - 1]);
    }
  });

  it("counts each candidate once: the widest step equals the total", () => {
    const total = PRODUCTION_BUCKETS.reduce((n, b) => n + b.count, 0);
    expect(funnel.steps[0].reached).toBe(total);
  });

  it("treats later stages as having passed the earlier ones", () => {
    // Someone currently at "Offered" necessarily passed screening. The old code compared
    // disjoint GROUP BY buckets, so this relationship did not hold at all.
    const onboarded = funnel.steps.find((s) => s.stage === "onboarded")!;
    expect(onboarded.reached).toBe(28 + 16 + 2); // Onboarded + converted + payroll_validated
    const arrived = funnel.steps.find((s) => s.stage === "arrived")!;
    expect(arrived.reached).toBe(150 + 46 + onboarded.reached);
  });

  it("conversion is a ratio of consecutive survivors, never above 1", () => {
    for (const step of funnel.steps) {
      if (step.conversion_from_previous == null) continue;
      expect(step.conversion_from_previous).toBeGreaterThanOrEqual(0);
      expect(step.conversion_from_previous).toBeLessThanOrEqual(1);
    }
  });

  it("reports no conversion for the first step rather than inventing one", () => {
    expect(funnel.steps[0].conversion_from_previous).toBeNull();
  });

  it("returns null, not 0, when nobody reached the previous stage", () => {
    // 0/0 must not render as a confident "0% converted".
    const empty = buildCanonicalFunnel([{ stage: "Onboarded", count: 5 }]);
    const applied = empty.steps.find((s) => s.stage === "applied")!;
    expect(applied.reached).toBe(5);
    const screening = empty.steps.find((s) => s.stage === "screening")!;
    expect(screening.conversion_from_previous).toBe(1);
  });

  it("surfaces unrecognised stages instead of absorbing them", () => {
    const out = buildCanonicalFunnel([
      { stage: "Applied", count: 10 },
      { stage: "Mystery Stage", count: 4 },
    ]);
    expect(out.unmapped).toEqual([{ stage: "Mystery Stage", count: 4 }]);
    // and it must not have been silently counted as Applied
    expect(out.steps[0].reached).toBe(10);
  });

  it("orders the steps by pipeline position, not by volume", () => {
    // The defect this replaces: getStageWise walked rows ordered by COUNT(*) DESC, so the
    // stage pairs it reported changed as the data moved.
    expect(funnel.steps.map((s) => s.stage)).toEqual([...CANONICAL_STAGE_ORDER]);
  });
});
