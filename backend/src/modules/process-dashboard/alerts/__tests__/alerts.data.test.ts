import { describe, expect, it, vi } from "vitest";
vi.mock("../../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
const { alertAsOf, anomaliesAt, lastDates, metricSeries } = await import("../alerts.data.js");
import type { NormRow } from "../../pd.metrics.js";

const row = (date: string, agent: string, o: Partial<NormRow> = {}): NormRow => ({ date, agent_code: agent, agent_name: null, tl_name: null, lob: null, hour: null, calls: null, login_sec: null, talk_sec: null, wait_sec: null, dispo_sec: null,
  break_sec: null, connected: null, ptp: null, sales_count: null, amount: null, handled: null, offered: null, abandoned: null, ...o });
const mapped = new Set(["calls", "talk_sec", "dispo_sec"]);

describe("metricSeries uses the dashboard's metric code (computeMetrics)", () => {
  const rows = [row("2026-09-01", "A", { calls: 10, talk_sec: 1000, dispo_sec: 200 }), row("2026-09-01", "B", { calls: 10, talk_sec: 2000, dispo_sec: 200 }), row("2026-09-02", "A", { calls: 20, talk_sec: 4000, dispo_sec: 400 })];
  it("aht per day = (talk+dispo)/calls over the day's rows", () => {
    const s = metricSeries(rows, [], mapped, "aht", 1, ["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect(s[0].value).toBeCloseTo(3400 / 20); expect(s[1].value).toBeCloseTo(4400 / 20); expect(s[2].value).toBeNull(); // no rows -> null, never 0
  });
  it("a window aggregates the trailing days before computing the ratio", () => {
    const s = metricSeries(rows, [], mapped, "aht", 2, ["2026-09-02"]);
    expect(s[0].value).toBeCloseTo(7800 / 40);
  });
  it("an unmapped or unknown metric is null on every day", () => {
    expect(metricSeries(rows, [], mapped, "utilization", 1, ["2026-09-01"])[0].value).toBeNull();
    expect(metricSeries(rows, [], mapped, "nope", 1, ["2026-09-01"])[0].value).toBeNull();
  });
});

describe("anomaliesAt", () => {
  it("null (no data) when the as-of day has no rows", () => { expect(anomaliesAt([row("2026-09-01", "A")], [], "2026-09-05", "anomaly:any").count).toBeNull(); });
  it("counts zero-calls-while-logged-in via the shared detector", () => {
    const rows = [row("2026-09-05", "A", { calls: 0, login_sec: 7200 }), row("2026-09-05", "B", { calls: 5, login_sec: 7200 })];
    expect(anomaliesAt(rows, [], "2026-09-05", "anomaly:zero_calls_while_logged_in")).toMatchObject({ count: 1 });
    expect(anomaliesAt(rows, [], "2026-09-05", "anomaly:aht_spike").count).toBe(0);
    expect(anomaliesAt(rows, [], "2026-09-05", "anomaly:any").count).toBe(1);
  });
});

describe("lastDates", () => { it("is ascending and ends on asOf", () => { expect(lastDates("2026-03-02", 3)).toEqual(["2026-02-28", "2026-03-01", "2026-03-02"]); }); });

describe("alertAsOf: a rule is judged on the latest complete day", () => {
  it("never on today's partial day", () => {
    expect(alertAsOf("2026-09-30", "2026-09-30")).toBe("2026-09-29");
    expect(alertAsOf("2026-10-01", "2026-09-30")).toBe("2026-09-29");
    expect(alertAsOf("2026-09-29", "2026-09-30")).toBe("2026-09-29");
    expect(alertAsOf("2026-09-20", "2026-09-30")).toBe("2026-09-20");
    expect(alertAsOf("2026-03-01", "2026-03-01")).toBe("2026-02-28");
  });
});
