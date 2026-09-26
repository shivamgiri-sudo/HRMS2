import { describe, expect, it } from "vitest";
import { buildOverviewKpis, latestPoint } from "../onfidoKpi";
import type { Matrix, ManpowerSection } from "../onfidoReportShared";

const matrix = (buckets: string[], ...rows: (number | null)[][]): Matrix => ({
  buckets,
  rows: rows.map((values, i) => ({ label: `row${i}`, values })),
});

const manpower = (over: Partial<ManpowerSection> = {}): ManpowerSection => ({
  approvedHc: 200,
  requiredHc: 240,
  activeHc: 199,
  bufferPct: -0.5,
  shortfall: 41,
  asOf: "2026-08-31",
  planEffectiveFrom: null,
  approvedMissingFor: [],
  queues: [],
  ...over,
});

describe("latestPoint", () => {
  it("returns the most recent non-null value with its bucket label", () => {
    expect(
      latestPoint(matrix(["Jul-26", "Aug-26", "Sep-26"], [1.5, 2.5, null])),
    ).toEqual({
      value: 2.5,
      bucket: "Aug-26",
    });
  });

  it("reads the requested row", () => {
    expect(latestPoint(matrix(["a", "b"], [1, 2], [9, 8]), 1)).toEqual({
      value: 8,
      bucket: "b",
    });
  });

  it("is null for a missing matrix, a missing row, or a row with no values", () => {
    expect(latestPoint(null)).toBeNull();
    expect(latestPoint(undefined)).toBeNull();
    expect(latestPoint(matrix(["a"], [1]), 3)).toBeNull();
    expect(latestPoint(matrix(["a", "b"], [null, null]))).toBeNull();
  });

  it("treats zero as a real value, not as missing", () => {
    expect(latestPoint(matrix(["a", "b"], [5, 0]))).toEqual({
      value: 0,
      bucket: "b",
    });
  });
});

describe("buildOverviewKpis", () => {
  const trends = {
    attrition: matrix(["Jul-26", "Aug-26"], [3.2, 4.15]),
    shrinkage: matrix(["Jul-26", "Aug-26"], [12.5, 13.75]),
    docAht: matrix(["Jul-26", "Aug-26"], [130, 139.4]),
    poaAht: matrix(["Jul-26", "Aug-26"], [200, 210.8]),
  };

  it("produces the eight headline tiles in a fixed order", () => {
    const kpis = buildOverviewKpis({ manpower: manpower(), ...trends });
    expect(kpis.map((k) => k.key)).toEqual([
      "activeHc",
      "approvedHc",
      "buffer",
      "shortfall",
      "attrition",
      "shrinkage",
      "docAht",
      "poaAht",
    ]);
  });

  it("formats real figures the way the tables do", () => {
    const byKey = Object.fromEntries(
      buildOverviewKpis({ manpower: manpower(), ...trends }).map((k) => [
        k.key,
        k,
      ]),
    );
    expect(byKey.activeHc.value).toBe("199");
    expect(byKey.approvedHc.value).toBe("200");
    expect(byKey.shortfall.value).toBe("41");
    expect(byKey.attrition.value).toBe("4.2%");
    expect(byKey.docAht.value).toBe("139s");
    expect(byKey.poaAht.value).toBe("211s");
  });

  it("labels a trend tile with the period it came from", () => {
    const attrition = buildOverviewKpis({
      manpower: manpower(),
      ...trends,
    }).find((k) => k.key === "attrition");
    expect(attrition?.sub).toBe("Aug-26");
  });

  it("shows a dash, never a made-up number, when a figure has no source", () => {
    const kpis = buildOverviewKpis({
      manpower: manpower({
        approvedHc: null,
        requiredHc: null,
        bufferPct: null,
        shortfall: null,
      }),
      attrition: null,
      shrinkage: undefined,
      docAht: matrix(["a"], [null]),
      poaAht: null,
    });
    const byKey = Object.fromEntries(kpis.map((k) => [k.key, k]));
    for (const key of [
      "approvedHc",
      "buffer",
      "shortfall",
      "attrition",
      "shrinkage",
      "docAht",
      "poaAht",
    ]) {
      expect(byKey[key].value).toBe("-");
    }
    expect(byKey.activeHc.value).toBe("199");
  });

  it("still returns dashes for every tile when there is no manpower section at all", () => {
    const kpis = buildOverviewKpis({
      manpower: null,
      attrition: null,
      shrinkage: null,
      docAht: null,
      poaAht: null,
    });
    expect(kpis).toHaveLength(8);
    expect(kpis.every((k) => k.value === "-")).toBe(true);
  });

  it("flags a negative buffer with a warning tone and a positive one with a healthy tone", () => {
    const tone = (bufferPct: number | null) =>
      buildOverviewKpis({ manpower: manpower({ bufferPct }), ...trends }).find(
        (k) => k.key === "buffer",
      )?.tone;
    expect(tone(-3)).toBe("rose");
    expect(tone(4)).toBe("emerald");
    expect(tone(null)).toBe("emerald");
  });
});
