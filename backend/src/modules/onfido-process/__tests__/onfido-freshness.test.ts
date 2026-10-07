import { describe, expect, it, vi } from "vitest";

const { query, state } = vi.hoisted(() => ({
  query: vi.fn(),
  state: { inflight: 0, max: 0 },
}));
vi.mock("../../../db/onfidoDb.js", () => ({
  getOnfidoPool: async () => ({ query }),
}));

import {
  findGapMonths,
  getDataFreshness,
  FRESHNESS_SOURCES,
} from "../onfido-freshness.service";

describe("getDataFreshness", () => {
  it("runs the latest-date probe and the gap scan together and returns the same rows", async () => {
    query.mockImplementation(async (sql: string) => {
      state.inflight += 1;
      state.max = Math.max(state.max, state.inflight);
      await new Promise((r) => setTimeout(r, 5));
      state.inflight -= 1;
      return [
        /MAX\(/.test(sql)
          ? [{ d: "2026-09-28" }]
          : [{ m: "2026-07" }, { m: "2026-09" }],
      ];
    });
    const out = await getDataFreshness();
    expect(out).toHaveLength(FRESHNESS_SOURCES.length);
    expect(out[0].latestDate).toBe("2026-09-28");
    expect(out[0].gapMonths).toEqual(["2026-08"]);
    // every source fires 2 statements at once
    expect(state.max).toBe(FRESHNESS_SOURCES.length * 2);
  });
});

describe("findGapMonths", () => {
  it("finds a month with no data between two months that have data", () => {
    expect(findGapMonths(["2026-07", "2026-09"])).toEqual(["2026-08"]);
  });

  it("handles a year boundary and several gaps", () => {
    expect(findGapMonths(["2025-11", "2026-02"])).toEqual([
      "2025-12",
      "2026-01",
    ]);
  });

  it("reports nothing for contiguous months or fewer than two", () => {
    expect(findGapMonths(["2026-07", "2026-08", "2026-09"])).toEqual([]);
    expect(findGapMonths(["2026-09"])).toEqual([]);
    expect(findGapMonths([])).toEqual([]);
  });
});
