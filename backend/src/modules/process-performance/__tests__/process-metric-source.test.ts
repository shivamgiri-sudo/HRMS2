import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Client-supplied process metrics — the figures no internal pipeline measures.
 *
 * The property under protection is the one this whole dashboard rests on: a
 * metric nobody has supplied reads as absent, never as zero. A zero here would
 * be indistinguishable from a measured zero and would score a process red for
 * a number that was simply never sent.
 */
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const src = await import("../process-metric-source.js");

describe("fetchProcessMetricValues", () => {
  beforeEach(() => execute.mockReset());

  it("returns no entry for a metric with no rows, rather than a zero", async () => {
    execute.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[], []]);
    const out = await src.fetchProcessMetricValues("p1", ["abc_roi"], "2026-08-01", "2026-08-31");
    expect(out.get("abc_roi")).toBeUndefined();
  });

  it("averages rate metrics and carries a monthly trend", async () => {
    execute
      .mockResolvedValueOnce([[{ metric_key: "abc_prepaid_pct", value: "82.5", n: 3 }], []])
      .mockResolvedValueOnce([[
        { metric_key: "abc_prepaid_pct", period: "2026-08", value: "82.5" },
      ], []]);
    const out = await src.fetchProcessMetricValues("p1", ["abc_prepaid_pct"], "2026-08-01", "2026-08-31");
    expect(out.get("abc_prepaid_pct")).toEqual({
      value: 82.5,
      count: 3,
      trend: [{ period: "2026-08", value: 82.5 }],
    });
  });

  it("treats a row whose value was left blank as no reading", async () => {
    // COUNT(actual_value) skips NULLs, so a row entered with an empty value
    // cell reports n=0 and must not surface as a reading.
    execute
      .mockResolvedValueOnce([[{ metric_key: "abc_roi", value: null, n: 0 }], []])
      .mockResolvedValueOnce([[], []]);
    const out = await src.fetchProcessMetricValues("p1", ["abc_roi"], "2026-08-01", "2026-08-31");
    expect(out.get("abc_roi")).toBeUndefined();
  });

  it("scopes every query to the process it was asked for", async () => {
    execute.mockResolvedValue([[], []]);
    await src.fetchProcessMetricValues("p-target", ["m1"], "2026-08-01", "2026-08-31");
    expect(execute.mock.calls.length).toBeGreaterThan(0);
    for (const call of execute.mock.calls) {
      expect(call[1]).toContain("p-target");
    }
  });

  it("does not query at all when asked for no metrics", async () => {
    const out = await src.fetchProcessMetricValues("p1", [], "2026-08-01", "2026-08-31");
    expect(out.size).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });
});
