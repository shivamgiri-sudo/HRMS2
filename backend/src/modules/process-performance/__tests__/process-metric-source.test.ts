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

/**
 * The first query that reads DATA, skipping the INFORMATION_SCHEMA probe
 * fetchProcessMetricValues runs to see whether 1685's columns are present.
 * Index-based assertions would otherwise be inspecting the probe.
 */
function firstDataQuery(): [string, unknown[]] {
  const call = execute.mock.calls.find(([sql]) => !String(sql).includes("INFORMATION_SCHEMA"));
  if (!call) throw new Error("no data query was issued");
  return call as [string, unknown[]];
}

describe("fetchProcessMetricValues", () => {
  beforeEach(() => {
    execute.mockReset();
    // fetchProcessMetricValues probes for 1685's columns before its own queries.
    // Answering "absent" here keeps these tests on the averaging path they were
    // written for, and leaves each test's own mocks in the order it queued them.
    src.resetExactRatioProbe();
    execute.mockResolvedValueOnce([[{ n: 0 }], []]);
  });

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
      // No day carried the numbers behind its rate, so this is the mean of the
      // daily values and says so. See the exact-ratio tests below.
      exactRatio: false,
      // Null, not absent: the reading always reports whether it holds the
      // counts behind the rate, and these rows carry no rollup parts.
      ratioNumerator: null,
      ratioDenominator: null,
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
    // The 1685 capability probe reads INFORMATION_SCHEMA and takes no
    // parameters, so it is excluded — every query that touches DATA must scope.
    const dataQueries = execute.mock.calls.filter(
      ([sql]) => !String(sql).includes("INFORMATION_SCHEMA"),
    );
    expect(dataQueries.length).toBeGreaterThan(0);
    for (const call of dataQueries) {
      expect(call[1]).toContain("p-target");
    }
  });

  it("does not query at all when asked for no metrics", async () => {
    const out = await src.fetchProcessMetricValues("p1", [], "2026-08-01", "2026-08-31");
    expect(out.size).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("metric_code aliases", () => {
  beforeEach(() => {
    execute.mockReset();
    // Same as above: answer the 1685 capability probe before each test's own mocks.
    src.resetExactRatioProbe();
    execute.mockResolvedValueOnce([[{ n: 0 }], []]);
  });

  it("finds a value stored under the Studio metric_code and reports it under the registry key", async () => {
    // KPI Studio writes process_metric_actual keyed by kpi_metric_master.metric_code;
    // a hand-entered figure is keyed by the registry's own metricKey. The caller
    // asks for the registry key and must get an answer either way.
    execute
      .mockResolvedValueOnce([[{ metric_key: "GS1_EMAIL_TAT_SEC", value: "3100", n: 4 }], []])
      .mockResolvedValueOnce([[{ metric_key: "GS1_EMAIL_TAT_SEC", period: "2026-08", value: "3100" }], []]);

    const out = await src.fetchProcessMetricValues(
      "p1", ["gs1_email_tat_sec"], "2026-08-01", "2026-08-31", [],
      { gs1_email_tat_sec: "GS1_EMAIL_TAT_SEC" },
    );

    expect(out.get("gs1_email_tat_sec")).toEqual({
      value: 3100,
      count: 4,
      trend: [{ period: "2026-08", value: 3100 }],
      exactRatio: false,
      // Null, not absent: the reading always reports whether it holds the
      // counts behind the rate, and these rows carry no rollup parts.
      ratioNumerator: null,
      ratioDenominator: null,
    });
    expect(out.get("GS1_EMAIL_TAT_SEC")).toBeUndefined();
  });

  it("queries for both spellings", async () => {
    execute.mockResolvedValue([[], []]);
    await src.fetchProcessMetricValues(
      "p1", ["gs1_email_tat_sec"], "2026-08-01", "2026-08-31", [],
      { gs1_email_tat_sec: "GS1_EMAIL_TAT_SEC" },
    );
    const params = firstDataQuery()[1] as unknown[];
    expect(params).toContain("gs1_email_tat_sec");
    expect(params).toContain("GS1_EMAIL_TAT_SEC");
  });

  it("ignores an alias identical to the key rather than double-listing it", async () => {
    execute.mockResolvedValue([[], []]);
    await src.fetchProcessMetricValues(
      "p1", ["same_key"], "2026-08-01", "2026-08-31", [], { same_key: "same_key" },
    );
    const params = firstDataQuery()[1] as unknown[];
    expect(params.filter((p) => p === "same_key")).toHaveLength(1);
  });
});

/**
 * A period's rate, done properly.
 *
 * The mean of daily rates is not the period's rate whenever daily volumes
 * differ. Where each day recorded the two numbers its ratio was built from,
 * SUM(numerator)/SUM(denominator) recovers the real figure — and where any day
 * did not, the average stands and must be labelled as such rather than passed
 * off as exact.
 */
describe("exact period ratio", () => {
  beforeEach(() => {
    execute.mockReset();
    src.resetExactRatioProbe();
  });

  /** The capability probe, then the headline row, then the trend row. */
  function withColumns(present: boolean, headline: Record<string, unknown>) {
    execute
      .mockResolvedValueOnce([[{ n: present ? 2 : 0 }], []])
      .mockResolvedValueOnce([[headline], []])
      .mockResolvedValueOnce([[], []]);
  }

  it("asks for SUM(numerator)/SUM(denominator) when the columns exist", async () => {
    withColumns(true, { metric_key: "inbound_al_pct", value: "97.96", n: 6, exact_ratio: 1 });
    const out = await src.fetchProcessMetricValues("p1", ["inbound_al_pct"], "2026-08-01", "2026-08-31");
    const sql = String(execute.mock.calls[1][0]);
    expect(sql).toContain("SUM(rollup_numerator) / SUM(rollup_denominator)");
    // Only when EVERY counted day has parts — a partial numerator over a partial
    // denominator is a number belonging to neither method.
    expect(sql).toContain("COUNT(rollup_denominator) = COUNT(actual_value)");
    expect(out.get("inbound_al_pct")?.exactRatio).toBe(true);
    expect(out.get("inbound_al_pct")?.value).toBeCloseTo(97.96);
  });

  it("falls back to the average, and says it is not exact, when a day lacks its parts", async () => {
    withColumns(true, { metric_key: "inbound_al_pct", value: "98.20", n: 6, exact_ratio: 0 });
    const out = await src.fetchProcessMetricValues("p1", ["inbound_al_pct"], "2026-08-01", "2026-08-31");
    expect(out.get("inbound_al_pct")?.exactRatio).toBe(false);
    expect(out.get("inbound_al_pct")?.value).toBeCloseTo(98.2);
  });

  it("never names the columns on a database that does not have them", async () => {
    withColumns(false, { metric_key: "inbound_al_pct", value: "98.20", n: 6 });
    const out = await src.fetchProcessMetricValues("p1", ["inbound_al_pct"], "2026-08-01", "2026-08-31");
    const sql = String(execute.mock.calls[1][0]);
    expect(sql).not.toContain("rollup_numerator");
    expect(sql).not.toContain("rollup_denominator");
    expect(out.get("inbound_al_pct")?.exactRatio).toBe(false);
  });
});

/**
 * A ratio is never a sum, whatever its unit says.
 *
 * The unit describes what a number MEANS, not how it was derived. "Average
 * minutes on shift" is a duration that happens to carry the unit `count`, and
 * treating counts as volumes summed two daily averages into 1,223 minutes — 20
 * hours in a shift, on a dashboard, with nothing marking it as wrong.
 */
describe("volume rule versus stored ratio", () => {
  beforeEach(() => {
    execute.mockReset();
    src.resetExactRatioProbe();
  });

  it("divides the parts even when the metric is named as a volume to sum", async () => {
    execute
      .mockResolvedValueOnce([[{ n: 2 }], []])
      .mockResolvedValueOnce([[{ metric_key: "shift_minutes_avg", value: "601", n: 3, exact_ratio: 1 }], []])
      .mockResolvedValueOnce([[], []]);
    await src.fetchProcessMetricValues(
      "p1", ["shift_minutes_avg"], "2026-06-01", "2026-06-30", ["shift_minutes_avg"],
    );
    const sql = String(execute.mock.calls[1][0]);
    const ratioAt = sql.indexOf("SUM(rollup_numerator)");
    const sumAt = sql.indexOf("THEN SUM(actual_value)");
    expect(ratioAt).toBeGreaterThan(-1);
    expect(sumAt).toBeGreaterThan(-1);
    // Ordering is the fix: the ratio branch has to be reached first.
    expect(ratioAt).toBeLessThan(sumAt);
  });

  it("still sums a genuine volume that recorded no parts", async () => {
    execute
      .mockResolvedValueOnce([[{ n: 2 }], []])
      .mockResolvedValueOnce([[{ metric_key: "pan_submission_count", value: "120", n: 3, exact_ratio: 0 }], []])
      .mockResolvedValueOnce([[], []]);
    const out = await src.fetchProcessMetricValues(
      "p1", ["pan_submission_count"], "2026-08-01", "2026-08-31", ["pan_submission_count"],
    );
    expect(String(execute.mock.calls[1][0])).toContain("THEN SUM(actual_value)");
    expect(out.get("pan_submission_count")?.value).toBe(120);
  });
});
