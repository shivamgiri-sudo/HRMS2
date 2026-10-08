import { describe, expect, it } from "vitest";
import { addDays, detectAnomalies, mean, stdev, zScore } from "../pd.anomalies.js";
import type { NormRow } from "../pd.metrics.js";

const R = (date: string, o: Partial<NormRow> = {}): NormRow => ({
  date, agent_code: "A1", agent_name: "Asha", tl_name: null, lob: null, hour: null, calls: 100, login_sec: 28800, talk_sec: 6000, wait_sec: 9000, dispo_sec: 2000,
  break_sec: null, connected: null, ptp: null, sales_count: null, amount: null, handled: null, offered: null, abandoned: null, ...o,
});
const history = (n: number, o: Partial<NormRow> = {}) => Array.from({ length: n }, (_, i) => R(addDays("2026-09-20", -(i + 1)), o));

describe("stats helpers", () => {
  it("mean/stdev/zScore", () => {
    expect(mean([1, 2, 3])).toBe(2); expect(stdev([2, 2, 2])).toBe(0);
    expect(zScore(10, [10])).toBeNull();
    expect(zScore(5, [10, 10, 10, 10])).toBeLessThan(-4); // spread floored at 10% of mean, so a flat baseline still yields a finite z
  });
  it("addDays crosses month ends", () => expect(addDays("2026-09-01", -1)).toBe("2026-08-31"));
});

describe("detectAnomalies", () => {
  const asOf = "2026-09-20";
  it("flags a login drop vs the agent's own baseline", () => {
    const out = detectAnomalies([...history(10), R(asOf, { login_sec: 7200 })], [], asOf);
    const a = out.find((x) => x.type === "login_drop")!; expect(a.agentCode).toBe("A1"); expect(a.severity).toBe("bad"); expect(a.name).toBe("Asha");
  });
  it("does not flag a normal day or a thin baseline", () => {
    expect(detectAnomalies([...history(10), R(asOf, { login_sec: 27000 })], [], asOf)).toEqual([]);
    expect(detectAnomalies([...history(3), R(asOf, { login_sec: 100 })], [], asOf).some((x) => x.type === "login_drop")).toBe(false);
  });
  it("flags an AHT spike", () => {
    const out = detectAnomalies([...history(10), R(asOf, { talk_sec: 30000 })], [], asOf);
    expect(out.some((x) => x.type === "aht_spike")).toBe(true);
  });
  it("flags zero calls while logged in (even with no baseline)", () => {
    const out = detectAnomalies([R(asOf, { calls: 0 })], [], asOf);
    expect(out.map((x) => x.type)).toEqual(["zero_calls_while_logged_in"]);
    expect(detectAnomalies([R(asOf, { calls: 0, login_sec: 300 })], [], asOf)).toEqual([]);
  });
  it("flags fatal QA in the last 7 days only", () => {
    const qa = [{ agentCode: "A1", date: "2026-09-18", n: 1, sum: 20, fatal: 1 }, { agentCode: "A1", date: "2026-09-01", n: 1, sum: 20, fatal: 1 }];
    const out = detectAnomalies([R(asOf)], qa, asOf);
    expect(out.filter((x) => x.type === "qa_fatal")).toHaveLength(1);
  });
  it("ignores agents with no row on the as-of date and caps the list", () => {
    expect(detectAnomalies(history(10), [], asOf)).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => R(asOf, { agent_code: `X${i}`, calls: 0 }));
    expect(detectAnomalies(many, [], asOf, 10)).toHaveLength(10);
  });
});
