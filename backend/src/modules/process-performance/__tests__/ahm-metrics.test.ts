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

  it("derives lines cut and lines per order from the line count (alias is not the reserved word LINES)", () => {
    const m = by(ahmMetricRows("2026-10-02", { orders: 50, outlets: 40, order_qty: 200, sales_qty: 150, order_value: 1, delivered: 1, survey_taken: 1, telesales_agents: 5, line_count: 175 }));
    expect(m.AHM_LINES_CUT.value).toBe(175);
    expect(m.AHM_LINES_PER_ORDER).toMatchObject({ value: 3.5, numerator: 175, denominator: 50 });
  });

  it("skips fill rate and per-agent metrics when their denominator is zero rather than writing 0", () => {
    const m = by(ahmMetricRows("2026-10-02", { orders: 3, outlets: 3, order_qty: 0, sales_qty: 0, order_value: 0, delivered: 0, survey_taken: 0, telesales_agents: 0 }));
    expect(m.AHM_FILL_RATE_PCT).toBeUndefined();
    expect(m.AHM_TELESALES_AGENTS).toBeUndefined();
    expect(m.AHM_ORDERS_PER_AGENT).toBeUndefined();
    expect(m.AHM_DELIVERED_PCT.value).toBe(0);
  });
});

import { ahmCallMetricRows } from "../ahm-metrics.service.js";
import { classifyCall, parseDurationSec } from "../../bulk-upload/ahm-call-log-bulk.service.js";

describe("ahmCallMetricRows", () => {
  it("uses only classified calls as each rate's denominator", () => {
    const m = by(ahmCallMetricRows("2026-10-02", { calls: 100, connected: 60, connected_known: 80, productive: 20, productive_known: 80, incoming: 0, incoming_known: 0 }));
    expect(m.AHM_EC_PCT).toMatchObject({ value: 75, numerator: 6000, denominator: 80 });
    expect(m.AHM_PC_PCT).toMatchObject({ value: 25 });
    expect(m.AHM_INCOMING_PCT).toBeUndefined();
    expect(m.AHM_CALLS.value).toBe(100);
  });
});

describe("classifyCall", () => {
  const base = { status: null, disposition: null, durationSec: null, callType: null, productiveFlag: null };
  it("reads status text, with not-connected winning over connected", () => {
    expect(classifyCall({ ...base, status: "Connected" }).isConnected).toBe(1);
    expect(classifyCall({ ...base, status: "Not Connected" }).isConnected).toBe(0);
    expect(classifyCall({ ...base, status: "No Answer" }).isConnected).toBe(0);
  });
  it("falls back to talk time, and stays unknown with no evidence", () => {
    expect(classifyCall({ ...base, durationSec: 40 }).isConnected).toBe(1);
    expect(classifyCall({ ...base, durationSec: 0 }).isConnected).toBe(0);
    expect(classifyCall(base)).toEqual({ isConnected: null, isProductive: null, isIncoming: null });
  });
  it("marks productive from disposition, never for a call that did not connect", () => {
    expect(classifyCall({ ...base, status: "Connected", disposition: "Survey Taken" }).isProductive).toBe(1);
    expect(classifyCall({ ...base, status: "Connected", disposition: "Not Interested" }).isProductive).toBe(0);
    expect(classifyCall({ ...base, status: "Switched Off", disposition: "Survey Taken" }).isProductive).toBe(0);
  });
  it("reads direction from the call type", () => {
    expect(classifyCall({ ...base, callType: "Inbound" }).isIncoming).toBe(1);
    expect(classifyCall({ ...base, callType: "Outbound" }).isIncoming).toBe(0);
  });
});

describe("parseDurationSec", () => {
  it("accepts seconds, mm:ss, h:mm:ss and Excel day fractions", () => {
    expect(parseDurationSec("85")).toBe(85);
    expect(parseDurationSec("1:25")).toBe(85);
    expect(parseDurationSec("0:01:25")).toBe(85);
    expect(parseDurationSec("0.000984")).toBe(85);
    expect(parseDurationSec("")).toBeNull();
  });
});
