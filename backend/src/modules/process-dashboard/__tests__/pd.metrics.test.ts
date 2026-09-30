import { describe, expect, it } from "vitest";
import {
  addQa, addRow, availableMetrics, computeMetrics, emptyAcc, kpiStatus, newStats, normalizeRow, parseHms, pctDelta, rankBy, toHour, toNumber, toSeconds, totalAcc, type NormRow,
} from "../pd.metrics.js";

const row = (o: Partial<NormRow> = {}): NormRow => ({
  date: "2026-09-01", agent_code: "A1", agent_name: null, tl_name: null, lob: null, hour: null, calls: null, login_sec: null, talk_sec: null, wait_sec: null, dispo_sec: null,
  break_sec: null, connected: null, ptp: null, sales_count: null, amount: null, handled: null, offered: null, abandoned: null, ...o,
});
const m = (rows: NormRow[]) => { const a = emptyAcc(); rows.forEach((r) => addRow(a, r)); return computeMetrics(a); };

describe("time units", () => {
  it("sec passes numbers and numeric strings through", () => { expect(toSeconds(90, "sec")).toBe(90); expect(toSeconds("90", "sec")).toBe(90); expect(toSeconds("1,200", "sec")).toBe(1200); });
  it("day_fraction is multiplied by 86400", () => { expect(toSeconds(0.5, "day_fraction")).toBe(43200); expect(toSeconds("0.25", "day_fraction")).toBe(21600); });
  it("hhmmss parses clocks, including > 24h and 2-part H:MM", () => {
    expect(toSeconds("01:02:03", "hhmmss")).toBe(3723); expect(toSeconds("36:00:00", "hhmmss")).toBe(129600); expect(toSeconds("2:30", "hhmmss")).toBe(9000);
    expect(toSeconds("01:02:03.500", "hhmmss")).toBe(3723);
  });
  it("a clock string is honoured under any unit (TIME columns)", () => { expect(toSeconds("00:10:00", "sec")).toBe(600); expect(toSeconds("00:10:00", "day_fraction")).toBe(600); });
  it("a bare number under hhmmss is NOT guessed", () => expect(toSeconds(3723, "hhmmss")).toBeNull());
  it("blank / garbage -> null", () => { expect(toSeconds("", "sec")).toBeNull(); expect(toSeconds(null, "sec")).toBeNull(); expect(toSeconds("abc", "sec")).toBeNull(); expect(parseHms("1:99x")).toBeNull(); });
  it("toNumber handles %, commas, rejects text", () => { expect(toNumber("12.5%")).toBe(12.5); expect(toNumber("1,234")).toBe(1234); expect(toNumber("12abc")).toBeNull(); expect(toNumber(NaN)).toBeNull(); expect(toNumber("")).toBeNull(); });
  it("toHour", () => { expect(toHour(9)).toBe(9); expect(toHour("09:15:00")).toBe(9); expect(toHour("2026-09-01 14:05:00")).toBe(14); expect(toHour(24)).toBeNull(); expect(toHour("x")).toBeNull(); });
});

describe("normalizeRow", () => {
  it("uppercases agent code, converts times, counts bad values", () => {
    const st = newStats();
    const n = normalizeRow({ agent_code: " mas1 ", date: "2026-09-01", calls: "x", login_sec: "01:00:00", talk_sec: 10 }, "sec", st)!;
    expect(n.agent_code).toBe("MAS1"); expect(n.login_sec).toBe(3600); expect(n.talk_sec).toBe(10); expect(n.calls).toBeNull();
    expect(st.badValues.calls).toBe(1); expect(st.badSamples.calls).toEqual(["x"]);
  });
  it("drops rows without agent or a YYYY-MM-DD date", () => {
    expect(normalizeRow({ agent_code: "", date: "2026-09-01" }, "sec")).toBeNull();
    expect(normalizeRow({ agent_code: "A", date: "01/09/2026" }, "sec")).toBeNull();
  });
});

describe("derived metrics", () => {
  const full = row({ calls: 100, login_sec: 28800, talk_sec: 10000, wait_sec: 6000, dispo_sec: 2000, connected: 40, ptp: 10, sales_count: 8, amount: 1234.5, handled: 90, offered: 100, abandoned: 10 });
  it("matches the documented formulas", () => {
    const x = m([full]);
    expect(x.utilization).toBe(62.5);           // (10000+6000+2000)/28800
    expect(x.occupancy).toBe(66.67);            // (10000+2000)/18000
    expect(x.aht).toBe(120);                    // (10000+2000)/100
    expect(x.calls_per_login_hr).toBe(12.5);    // 100 / 8h
    expect(x.connect_rate).toBe(40); expect(x.ptp_rate).toBe(25); expect(x.conversion).toBe(20); // sales/connected
    expect(x.answer_rate).toBe(90); expect(x.abandon_rate).toBe(10); expect(x.amount).toBe(1234.5); expect(x.login_hours).toBe(8);
  });
  it("sums across rows before dividing (not an average of ratios)", () => {
    const x = m([row({ calls: 10, talk_sec: 100, dispo_sec: 0 }), row({ calls: 90, talk_sec: 900, dispo_sec: 0, agent_code: "B" })]);
    expect(x.aht).toBe(10); expect(x.agents).toBe(2);
  });
  it("conversion falls back to calls when connected is not mapped", () => expect(m([row({ calls: 50, sales_count: 5 })]).conversion).toBe(10));
  it("conversion uses connected when mapped, even if calls exist", () => expect(m([row({ calls: 50, connected: 20, sales_count: 5 })]).conversion).toBe(25));
  it("zero denominators give null, never 0 / NaN / Infinity", () => {
    const x = m([row({ calls: 0, login_sec: 0, talk_sec: 0, wait_sec: 0, dispo_sec: 0, connected: 0, ptp: 5, sales_count: 3, handled: 0, offered: 0, abandoned: 0 })]);
    for (const k of ["utilization", "occupancy", "aht", "calls_per_login_hr", "connect_rate", "conversion", "ptp_rate", "answer_rate", "abandon_rate"]) expect(x[k]).toBeNull();
    expect(x.calls).toBe(0); // a real zero stays zero
  });
  it("an unmapped input makes the metric null (utilization needs talk+wait+dispo+login)", () => {
    expect(m([row({ login_sec: 100, talk_sec: 50, wait_sec: 10 })]).utilization).toBeNull();
    expect(m([row({ talk_sec: 50, wait_sec: 10, dispo_sec: 5 })]).utilization).toBeNull();
    expect(m([row({ calls: 10, talk_sec: 50 })]).aht).toBeNull(); // dispo missing
  });
  it("null field values are skipped, not counted as 0", () => {
    const x = m([row({ calls: 10, talk_sec: 100, dispo_sec: 0 }), row({ agent_code: "B", calls: null, talk_sec: null, dispo_sec: null })]);
    expect(x.aht).toBe(10);
  });
  it("qa_score is the mean of audit percentages; null with no audits", () => {
    const a = emptyAcc(); addRow(a, row({ calls: 1 }));
    expect(computeMetrics(a).qa_score).toBeNull();
    addQa(a, { agentCode: "A1", date: "2026-09-01", n: 2, sum: 170, fatal: 1 }); addQa(a, { agentCode: "A1", date: "2026-09-02", n: 1, sum: 70, fatal: 0 });
    const x = computeMetrics(a); expect(x.qa_score).toBe(80); expect(x.audits).toBe(3); expect(x.fatal).toBe(1);
  });
  it("totalAcc only counts qa of agents that appear in the rows", () => {
    const a = totalAcc([row({ agent_code: "A1", calls: 1 })], [{ agentCode: "A1", date: "d", n: 1, sum: 90, fatal: 0 }, { agentCode: "OTHER", date: "d", n: 1, sum: 10, fatal: 0 }]);
    expect(computeMetrics(a).qa_score).toBe(90);
  });
  it("availableMetrics reflects mapping", () => {
    const av = availableMetrics(new Set(["agent_code", "date", "calls", "sales_count"]));
    expect(av.calls).toBe(true); expect(av.conversion).toBe(true); expect(av.utilization).toBe(false); expect(av.qa_score).toBe(true); expect(av.ptp_rate).toBe(false);
    expect(availableMetrics(new Set(["sales_count"])).conversion).toBe(false);
  });
});

describe("status / delta / rank", () => {
  it("pctDelta null-safe", () => { expect(pctDelta(110, 100)).toBe(10); expect(pctDelta(5, 0)).toBeNull(); expect(pctDelta(null, 5)).toBeNull(); expect(pctDelta(50, -100)).toBe(150); });
  it("target drives status, direction-aware", () => {
    expect(kpiStatus(85, 80, null, "higher")).toEqual({ status: "good", basis: "target" });
    expect(kpiStatus(75, 80, null, "higher").status).toBe("warn");
    expect(kpiStatus(50, 80, null, "higher").status).toBe("bad");
    expect(kpiStatus(100, 120, null, "lower").status).toBe("good");
    expect(kpiStatus(140, 120, null, "lower").status).toBe("bad");
  });
  it("without a target it uses the previous period, else nodata", () => {
    expect(kpiStatus(100, null, 100, "higher")).toEqual({ status: "good", basis: "trend" });
    expect(kpiStatus(95, null, 100, "higher").status).toBe("warn");
    expect(kpiStatus(70, null, 100, "higher").status).toBe("bad");
    expect(kpiStatus(130, null, 100, "lower").status).toBe("bad");
    expect(kpiStatus(100, null, null, "higher")).toEqual({ status: "nodata", basis: "none" });
    expect(kpiStatus(null, 80, 1, "higher").status).toBe("nodata");
  });
  it("rankBy: direction-aware, ties share, nulls unranked", () => {
    const r = rankBy([{ key: "a", value: 10 }, { key: "b", value: 20 }, { key: "c", value: 20 }, { key: "d", value: null }], "higher");
    expect(r.get("b")).toBe(1); expect(r.get("c")).toBe(1); expect(r.get("a")).toBe(3); expect(r.has("d")).toBe(false);
    expect(rankBy([{ key: "a", value: 10 }, { key: "b", value: 20 }], "lower").get("a")).toBe(1);
  });
});
