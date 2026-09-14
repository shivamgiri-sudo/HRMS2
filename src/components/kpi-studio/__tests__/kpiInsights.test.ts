import { describe, expect, it } from "vitest";
import {
  computeMovement,
  findAttentionItems,
  formatKpiValue,
  splitMovements,
  type KpiLike,
} from "../kpiInsights";

/**
 * These functions decide what the dashboard TELLS somebody about their own performance, so the risk
 * is not a crash — it is confidently saying the opposite of the truth.
 *
 * The specific trap is direction. For handle time or error rate, a FALLING number is an improvement;
 * for sales or quality, a RISING one is. Get that backwards and the dashboard congratulates an agent
 * for a metric that deteriorated, which no amount of code review reliably catches and which the
 * person being measured will believe.
 */

function kpi(overrides: Partial<KpiLike> = {}): KpiLike {
  return {
    metric_id: "m1",
    metric_code: "AHT",
    metric_name: "Handle time",
    unit: "seconds",
    direction: "lower_is_better",
    target_value: 240,
    min_threshold: null,
    actual_value: 250,
    score_pct: 96,
    trend_data: [],
    ...overrides,
  };
}

describe("computeMovement — direction decides what 'better' means", () => {
  it("calls a falling number an improvement when lower is better", () => {
    const movement = computeMovement(
      kpi({
        direction: "lower_is_better",
        trend_data: [
          { date: "2026-08-20", value: 300 },
          { date: "2026-08-21", value: 260 },
        ],
      }),
    );
    expect(movement?.improved).toBe(true);
    expect(movement?.change).toBe(-40);
  });

  it("calls the same falling number a decline when higher is better", () => {
    // Identical numbers, opposite verdict. This pair is the whole point of the test.
    const movement = computeMovement(
      kpi({
        direction: "higher_is_better",
        trend_data: [
          { date: "2026-08-20", value: 300 },
          { date: "2026-08-21", value: 260 },
        ],
      }),
    );
    expect(movement?.improved).toBe(false);
    expect(movement?.change).toBe(-40);
  });

  it("calls a rising number an improvement when higher is better", () => {
    const movement = computeMovement(
      kpi({
        direction: "higher_is_better",
        metric_code: "QUALITY_SCORE",
        trend_data: [
          { date: "2026-08-20", value: 80 },
          { date: "2026-08-21", value: 92 },
        ],
      }),
    );
    expect(movement?.improved).toBe(true);
    expect(movement?.changePct).toBeCloseTo(15, 5);
  });

  it("compares the last two days WITH DATA, not the last two calendar days", () => {
    // An agent on week-off has no row for that day. Comparing across the gap answers "am I doing
    // better than last time I worked", and reporting both dates makes what was compared visible.
    const movement = computeMovement(
      kpi({
        trend_data: [
          { date: "2026-08-18", value: 300 },
          { date: "2026-08-21", value: 250 },
        ],
      }),
    );
    expect(movement?.previousDate).toBe("2026-08-18");
    expect(movement?.latestDate).toBe("2026-08-21");
  });

  it("sorts unordered points before comparing", () => {
    const movement = computeMovement(
      kpi({
        trend_data: [
          { date: "2026-08-21", value: 250 },
          { date: "2026-08-20", value: 300 },
        ],
      }),
    );
    expect(movement?.previous).toBe(300);
    expect(movement?.latest).toBe(250);
  });

  it("reports nothing when there is only one reading", () => {
    expect(computeMovement(kpi({ trend_data: [{ date: "2026-08-21", value: 250 }] }))).toBeNull();
  });

  it("reports nothing when there are no readings", () => {
    expect(computeMovement(kpi({ trend_data: [] }))).toBeNull();
  });

  it("treats no change as neither an improvement nor a decline", () => {
    // Listing a flat metric under "moved the right way" would pad the list with non-events and make
    // the real movements harder to see.
    const movement = computeMovement(
      kpi({
        trend_data: [
          { date: "2026-08-20", value: 250 },
          { date: "2026-08-21", value: 250 },
        ],
      }),
    );
    expect(movement).toBeNull();
  });

  it("reports a null percentage rather than dividing by zero", () => {
    const movement = computeMovement(
      kpi({
        direction: "higher_is_better",
        trend_data: [
          { date: "2026-08-20", value: 0 },
          { date: "2026-08-21", value: 12 },
        ],
      }),
    );
    expect(movement?.changePct).toBeNull();
    expect(movement?.improved).toBe(true);
  });
});

describe("splitMovements", () => {
  it("separates and ranks by relative change, not absolute", () => {
    // 40 seconds on a 4,000-second total is noise; 40 on a 200 average is a fifth of the metric.
    // Ranking by absolute change would put every large-magnitude KPI on top regardless of whether
    // the move mattered.
    const big = kpi({
      metric_id: "big",
      metric_code: "TOTAL_SECONDS",
      direction: "lower_is_better",
      trend_data: [
        { date: "2026-08-20", value: 4000 },
        { date: "2026-08-21", value: 3960 },
      ],
    });
    const small = kpi({
      metric_id: "small",
      metric_code: "AHT",
      direction: "lower_is_better",
      trend_data: [
        { date: "2026-08-20", value: 200 },
        { date: "2026-08-21", value: 160 },
      ],
    });

    const { improved } = splitMovements([big, small]);
    expect(improved.map((movement) => movement.metric_id)).toEqual(["small", "big"]);
  });

  it("puts each metric on exactly one side", () => {
    const better = kpi({
      metric_id: "better",
      direction: "lower_is_better",
      trend_data: [
        { date: "2026-08-20", value: 300 },
        { date: "2026-08-21", value: 250 },
      ],
    });
    const worse = kpi({
      metric_id: "worse",
      direction: "lower_is_better",
      trend_data: [
        { date: "2026-08-20", value: 250 },
        { date: "2026-08-21", value: 300 },
      ],
    });

    const { improved, declined } = splitMovements([better, worse]);
    expect(improved.map((movement) => movement.metric_id)).toEqual(["better"]);
    expect(declined.map((movement) => movement.metric_id)).toEqual(["worse"]);
  });

  it("returns empty lists rather than failing on metrics with no trend", () => {
    const { improved, declined } = splitMovements([kpi({ trend_data: [] })]);
    expect(improved).toEqual([]);
    expect(declined).toEqual([]);
  });
});

describe("findAttentionItems", () => {
  const TODAY = new Date("2026-08-21T09:00:00Z");

  it("flags a breach on the correct side for a lower-is-better KPI", () => {
    // AHT 400s against a 360s ceiling is a breach. Comparing the other way would flag everybody
    // performing well.
    const items = findAttentionItems(
      [kpi({ direction: "lower_is_better", min_threshold: 360, actual_value: 400, trend_data: [{ date: "2026-08-21", value: 400 }] })],
      TODAY,
    );
    expect(items[0].kind).toBe("breached");
    expect(items[0].message).toContain("past the 360 limit");
  });

  it("does not flag a lower-is-better KPI comfortably inside its ceiling", () => {
    const items = findAttentionItems(
      [kpi({ direction: "lower_is_better", min_threshold: 360, actual_value: 200, score_pct: 100, trend_data: [{ date: "2026-08-21", value: 200 }] })],
      TODAY,
    );
    expect(items).toEqual([]);
  });

  it("flags a breach on the correct side for a higher-is-better KPI", () => {
    const items = findAttentionItems(
      [
        kpi({
          metric_code: "ATTENDANCE_PCT",
          metric_name: "Attendance",
          direction: "higher_is_better",
          min_threshold: 85,
          target_value: 95,
          actual_value: 70,
          trend_data: [{ date: "2026-08-21", value: 70 }],
        }),
      ],
      TODAY,
    );
    expect(items[0].kind).toBe("breached");
    expect(items[0].message).toContain("below the 85 minimum");
  });

  it("flags a KPI whose data has stopped arriving, rather than judging the stale figure", () => {
    // The case that catches a broken source or a mis-mapped column. Without it, a week-old average
    // is presented as current performance.
    const items = findAttentionItems(
      [kpi({ actual_value: 250, score_pct: 96, trend_data: [{ date: "2026-08-14", value: 250 }] })],
      TODAY,
    );
    expect(items[0].kind).toBe("stale");
    expect(items[0].message).toContain("7 days");
    expect(items[0].message).toContain("2026-08-14");
  });

  it("does not call yesterday's data stale", () => {
    const items = findAttentionItems(
      [kpi({ actual_value: 250, score_pct: 96, trend_data: [{ date: "2026-08-20", value: 250 }] })],
      TODAY,
    );
    expect(items).toEqual([]);
  });

  it("distinguishes 'nothing recorded' from a bad score", () => {
    // A KPI configured but never fed is a configuration gap, not a performance problem, and must not
    // read as one.
    const items = findAttentionItems([kpi({ actual_value: null, score_pct: 0, trend_data: [] })], TODAY);
    expect(items[0].kind).toBe("never");
    expect(items[0].scorePct).toBeNull();
  });

  it("flags a score well below target", () => {
    const items = findAttentionItems(
      [kpi({ actual_value: 600, score_pct: 40, trend_data: [{ date: "2026-08-21", value: 600 }] })],
      TODAY,
    );
    expect(items[0].kind).toBe("far_below");
    expect(items[0].message).toContain("40% of target");
  });

  it("does not flag a score of 60, only below it", () => {
    // 60 is the bottom of the acceptable rating band in this system. Flagging it would contradict
    // the rating scale.
    expect(
      findAttentionItems([kpi({ actual_value: 300, score_pct: 60, trend_data: [{ date: "2026-08-21", value: 300 }] })], TODAY),
    ).toEqual([]);
    expect(
      findAttentionItems([kpi({ actual_value: 300, score_pct: 59, trend_data: [{ date: "2026-08-21", value: 300 }] })], TODAY)[0].kind,
    ).toBe("far_below");
  });

  it("catches a KPI sliding three readings in a row while still on target", () => {
    // Worth catching early: by the time the score drops it is already a problem.
    const items = findAttentionItems(
      [
        kpi({
          direction: "lower_is_better",
          actual_value: 230,
          score_pct: 100,
          min_threshold: null,
          trend_data: [
            { date: "2026-08-19", value: 200 },
            { date: "2026-08-20", value: 215 },
            { date: "2026-08-21", value: 230 },
          ],
        }),
      ],
      TODAY,
    );
    expect(items[0].kind).toBe("declining");
    expect(items[0].message).toContain("still on target");
  });

  it("does not call an improving series a decline", () => {
    const items = findAttentionItems(
      [
        kpi({
          direction: "lower_is_better",
          actual_value: 200,
          score_pct: 100,
          trend_data: [
            { date: "2026-08-19", value: 230 },
            { date: "2026-08-20", value: 215 },
            { date: "2026-08-21", value: 200 },
          ],
        }),
      ],
      TODAY,
    );
    expect(items).toEqual([]);
  });

  it("orders a breach above a stale reading above a slide", () => {
    const items = findAttentionItems(
      [
        kpi({ metric_id: "slide", direction: "lower_is_better", actual_value: 230, score_pct: 100, trend_data: [
          { date: "2026-08-19", value: 200 },
          { date: "2026-08-20", value: 215 },
          { date: "2026-08-21", value: 230 },
        ] }),
        kpi({ metric_id: "stale", actual_value: 250, score_pct: 96, trend_data: [{ date: "2026-08-01", value: 250 }] }),
        kpi({ metric_id: "breach", direction: "lower_is_better", min_threshold: 360, actual_value: 400, trend_data: [{ date: "2026-08-21", value: 400 }] }),
      ],
      TODAY,
    );
    expect(items.map((item) => item.metric_id)).toEqual(["breach", "stale", "slide"]);
  });

  it("reports at most one reason per KPI", () => {
    // A KPI that is breached AND declining is one problem to act on, not two lines in the list.
    const items = findAttentionItems(
      [
        kpi({
          direction: "lower_is_better",
          min_threshold: 360,
          actual_value: 400,
          score_pct: 30,
          trend_data: [
            { date: "2026-08-19", value: 300 },
            { date: "2026-08-20", value: 350 },
            { date: "2026-08-21", value: 400 },
          ],
        }),
      ],
      TODAY,
    );
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("breached");
  });
});

describe("formatKpiValue", () => {
  it("renders seconds as minutes and seconds", () => {
    expect(formatKpiValue(250, "seconds")).toBe("4m 10s");
    expect(formatKpiValue(45, "seconds")).toBe("45s");
  });

  it("renders percentages to one decimal", () => {
    expect(formatKpiValue(92.44, "percent")).toBe("92.4%");
  });

  it("renders currency with a rupee symbol and separators", () => {
    expect(formatKpiValue(50000, "currency")).toContain("₹");
  });

  it("renders hours", () => {
    expect(formatKpiValue(7.55, "hours")).toBe("7.6h");
  });

  it("renders a missing value as a dash rather than zero", () => {
    // The distinction the whole feature rests on: absent is not zero.
    expect(formatKpiValue(null, "seconds")).toBe("—");
    expect(formatKpiValue(0, "seconds")).toBe("0s");
  });
});
