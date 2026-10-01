import { describe, it, expect } from "vitest";
import { DEFAULT_RATING_BANDS, isEffective, normaliseWeights, pickWinners, ratingFor, type ResolveCandidate } from "../kpi-catalogue.resolve.js";

const c = (o: Partial<ResolveCandidate> & Pick<ResolveCandidate, "metricKey" | "tier">): ResolveCandidate =>
  ({ target: 10, weight: 50, effectiveFrom: "2026-01-01", effectiveTo: null, ...o });

describe("pickWinners - one resolution order", () => {
  it("employee beats role_process beats process beats department beats designation", () => {
    const winners = pickWinners([
      c({ metricKey: "aht", tier: "designation", target: 1 }),
      c({ metricKey: "aht", tier: "department", target: 2 }),
      c({ metricKey: "aht", tier: "process", target: 3 }),
      c({ metricKey: "aht", tier: "role_process", target: 4 }),
      c({ metricKey: "aht", tier: "employee", target: 5 }),
    ], "2026-10-01");
    expect(winners).toHaveLength(1);
    expect(winners[0]).toMatchObject({ tier: "employee", target: 5 });
  });

  it("ignores rows that are not effective on the date", () => {
    const winners = pickWinners([
      c({ metricKey: "aht", tier: "employee", target: 5, effectiveFrom: "2026-11-01" }),
      c({ metricKey: "aht", tier: "employee", target: 6, effectiveTo: "2026-06-30" }),
      c({ metricKey: "aht", tier: "process", target: 7 }),
    ], "2026-10-01");
    expect(winners[0]).toMatchObject({ tier: "process", target: 7 });
  });

  it("within a tier the later effective_from wins (superseding rows)", () => {
    const winners = pickWinners([
      c({ metricKey: "aht", tier: "process", target: 80, effectiveFrom: "2026-01-01" }),
      c({ metricKey: "aht", tier: "process", target: 95, effectiveFrom: "2026-09-01" }),
    ], "2026-10-01");
    expect(winners[0].target).toBe(95);
  });

  it("resolves each metric independently", () => {
    const winners = pickWinners([
      c({ metricKey: "aht", tier: "employee" }),
      c({ metricKey: "qa", tier: "department" }),
    ], "2026-10-01");
    expect(winners.map((w) => `${w.metricKey}:${w.tier}`).sort()).toEqual(["aht:employee", "qa:department"]);
  });
});

describe("normaliseWeights", () => {
  it("scales weights to sum to exactly 100", () => {
    const out = normaliseWeights([
      { metricKey: "a", tier: "process", target: 1, weight: null, rawWeight: 100 },
      { metricKey: "b", tier: "process", target: 1, weight: null, rawWeight: 100 },
      { metricKey: "c", tier: "process", target: 1, weight: null, rawWeight: 100 },
    ]);
    expect(out.reduce((s, i) => s + (i.weight ?? 0), 0)).toBeCloseTo(100, 5);
  });
  it("340 of defaulted 100s becomes a real 100 split", () => {
    const items = Array.from({ length: 3 }, (_, i) => ({ metricKey: `m${i}`, tier: "process" as const, target: 1, weight: null, rawWeight: 100 }));
    const out = normaliseWeights(items);
    expect(out.map((i) => i.weight)).toEqual([33.34, 33.33, 33.33]);
  });
  it("leaves unweighted KPIs null and does not scale when nothing is weighted", () => {
    const out = normaliseWeights([
      { metricKey: "a", tier: "process", target: 1, weight: null, rawWeight: null },
      { metricKey: "b", tier: "process", target: 1, weight: null, rawWeight: 0 },
    ]);
    expect(out.every((i) => i.weight === null)).toBe(true);
  });
});

describe("ratingFor - one rating scale", () => {
  it("uses S/A/B/C/D at 100/90/75/60/0", () => {
    expect(ratingFor(120, DEFAULT_RATING_BANDS)).toBe("S");
    expect(ratingFor(95, DEFAULT_RATING_BANDS)).toBe("A");
    expect(ratingFor(75, DEFAULT_RATING_BANDS)).toBe("B");
    expect(ratingFor(60, DEFAULT_RATING_BANDS)).toBe("C");
    expect(ratingFor(10, DEFAULT_RATING_BANDS)).toBe("D");
  });
  it("a missing score has no rating (never a band)", () => {
    expect(ratingFor(null, DEFAULT_RATING_BANDS)).toBeNull();
    expect(ratingFor(undefined, DEFAULT_RATING_BANDS)).toBeNull();
  });
});

describe("isEffective", () => {
  it("is inclusive at both ends", () => {
    expect(isEffective(c({ metricKey: "x", tier: "process", effectiveFrom: "2026-10-01", effectiveTo: "2026-10-01" }), "2026-10-01")).toBe(true);
  });
});
