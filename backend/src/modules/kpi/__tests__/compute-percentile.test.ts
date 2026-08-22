import { describe, it, expect } from "vitest";
import { computePercentile } from "../kpi-master.service.js";

describe("computePercentile", () => {
  it("returns null with fewer than 2 peers — no meaningful comparison possible", () => {
    expect(computePercentile(50, [], true)).toBeNull();
    expect(computePercentile(50, [40], true)).toBeNull();
  });

  it("for a lower_is_better metric, a LOWER value than peers scores a HIGH percentile", () => {
    // AHT: I average 100s, peers average 150/200/250 — I'm the fastest (best).
    const percentile = computePercentile(100, [150, 200, 250], true);
    expect(percentile).toBe(100);
  });

  it("for a lower_is_better metric, a HIGHER value than peers scores a LOW percentile", () => {
    // ACW: I average 300s, peers average 50/60/70 — I'm the slowest (worst).
    const percentile = computePercentile(300, [50, 60, 70], true);
    expect(percentile).toBe(0);
  });

  it("for a higher_is_better metric, a HIGHER value than peers scores a HIGH percentile", () => {
    // Quality score: I score 90, peers score 60/70/80 — I'm the best.
    const percentile = computePercentile(90, [60, 70, 80], false);
    expect(percentile).toBe(100);
  });

  it("for a higher_is_better metric, a LOWER value than peers scores a LOW percentile", () => {
    const percentile = computePercentile(40, [60, 70, 80], false);
    expect(percentile).toBe(0);
  });

  it("handles a mid-pack result proportionally", () => {
    // Higher-is-better, I score 70 among peers 50/60/80/90 — I beat/tie 2 of 4.
    const percentile = computePercentile(70, [50, 60, 80, 90], false);
    expect(percentile).toBe(50);
  });

  it("a perfect zero on a lower_is_better metric (e.g. 0 fatal errors) scores 100th percentile", () => {
    const percentile = computePercentile(0, [0.5, 1, 2], true);
    expect(percentile).toBe(100);
  });
});
