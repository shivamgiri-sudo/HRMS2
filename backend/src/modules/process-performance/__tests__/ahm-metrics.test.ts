import { describe, it, expect } from "vitest";
import { ahmMetricRows } from "../ahm-metrics.service.js";

const by = (rows: ReturnType<typeof ahmMetricRows>) => Object.fromEntries(rows.map((r) => [r.metricKey, r]));

describe("ahmMetricRows", () => {
  it("writes nothing for a day with no orders", () => {
    expect(ahmMetricRows("2026-10-02", { orders: 0 })).toEqual([]);
  });

  it("keeps percent parts scaled so SUM(num)/SUM(den) is the period rate", () => {
    const m = by(ahmMetricRows("2026-10-02", { orders: 50, outlets: 40, order_qty: 200, sales_qty: 150, order_value: 12345.5, delivered: 20, survey_taken: 45, telesales_agents: 5 }));
    expect(m.AHM_DELIVERED_PCT).toMatchObject({ value: 40, numerator: 2000, denominator: 50 });
    expect(m.AHM_FILL_RATE_PCT).toMatchObject({ value: 75, numerator: 15000, denominator: 200 });
    expect(m.AHM_SURVEY_TAKEN_PCT).toMatchObject({ value: 90 });
    expect(m.AHM_ORDERS_PER_AGENT).toMatchObject({ value: 10, numerator: 50, denominator: 5 });
    expect(m.AHM_ORDER_VALUE.value).toBe(12345.5);
  });

  it("skips fill rate and per-agent metrics when their denominator is zero rather than writing 0", () => {
    const m = by(ahmMetricRows("2026-10-02", { orders: 3, outlets: 3, order_qty: 0, sales_qty: 0, order_value: 0, delivered: 0, survey_taken: 0, telesales_agents: 0 }));
    expect(m.AHM_FILL_RATE_PCT).toBeUndefined();
    expect(m.AHM_TELESALES_AGENTS).toBeUndefined();
    expect(m.AHM_ORDERS_PER_AGENT).toBeUndefined();
    expect(m.AHM_DELIVERED_PCT.value).toBe(0);
  });
});
