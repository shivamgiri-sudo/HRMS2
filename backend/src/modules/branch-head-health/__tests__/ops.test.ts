import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { query: (...a: unknown[]) => query(...a) } }));
const getInboundProjects = vi.fn();
vi.mock("../../call-master/inbound-projects.js", () => ({ getInboundProjects: (...a: unknown[]) => getInboundProjects(...a) }));
const getKPIs = vi.fn();
const getQualityTrend = vi.fn();
const getCXParameters = vi.fn();
const getFatalAgentSummary = vi.fn();
vi.mock("../../call-master/call-master.service.js", () => ({
  getKPIs: (...a: unknown[]) => getKPIs(...a),
  getQualityTrend: (...a: unknown[]) => getQualityTrend(...a),
  getCXParameters: (...a: unknown[]) => getCXParameters(...a),
  getFatalAgentSummary: (...a: unknown[]) => getFatalAgentSummary(...a),
}));

import { buildOpsSections, clientIdsForProcesses, isStale } from "../ops.js";

const proc = (id: string, tier: any = "full", extra: any = {}) => ({
  processId: id, processCode: id.toUpperCase(), processName: `${id} name`, costCentres: [], viaLink: false,
  mandatedSeats: null, headcount: 1, tier, latestMetricDate: null, billingMirror: false, branchIds: ["b1"], ...extra,
});
const range = { startDate: "2026-10-01", endDate: "2026-10-15" };

beforeEach(() => {
  [query, getInboundProjects, getKPIs, getQualityTrend, getCXParameters, getFatalAgentSummary].forEach((m) => m.mockReset());
  query.mockResolvedValue([[]]);
  getInboundProjects.mockResolvedValue([]);
  getKPIs.mockResolvedValue({ inbound: { total: 5 } });
  getQualityTrend.mockResolvedValue([{ period: "2026-10-01", quality: 80, calls: 3, fatal: 0 }]);
  getCXParameters.mockResolvedValue([{ key: "x", value: 1 }]);
  getFatalAgentSummary.mockResolvedValue([]);
});

describe("clientIdsForProcesses", () => {
  it("ignores projects without processId and non-numeric ids, dedupes", async () => {
    getInboundProjects.mockResolvedValue([
      { key: "a", processId: "p1", clientId: "409", fcrClientId: 475 },
      { key: "b", processId: "p1", clientId: "409" },
      { key: "c", clientId: "999" },
      { key: "d", processId: "p2", clientId: "abc", fcrClientId: 12 },
      { key: "e", processId: "other", clientId: "777" },
    ]);
    const ids = await clientIdsForProcesses(["p1", "p2"]);
    expect(ids.sort((a, b) => a - b)).toEqual([12, 409, 475]);
    expect(getInboundProjects).toHaveBeenCalledWith({ includeDbOnly: true });
  });
});

describe("isStale", () => {
  it("14 days is fresh, 15 days is stale", () => {
    expect(isStale("2026-10-01", "2026-10-15")).toBe(false);
    expect(isStale("2026-09-30", "2026-10-15")).toBe(true);
  });
});

describe("buildOpsSections", () => {
  it("operations: latest per metric, tier, stale flag, mirror excluded, grouped single query", async () => {
    query.mockResolvedValue([[
      { process_id: "p1", metric_key: "AHT", actual_value: "300", score_date: "2026-10-01" },
      { process_id: "p1", metric_key: "AHT", actual_value: "280", score_date: "2026-10-10" },
      { process_id: "p1", metric_key: "QA_QUALITY_PCT", actual_value: "90", score_date: "2026-10-10" },
      { process_id: "p2", metric_key: "QA_QUALITY_PCT", actual_value: "70", score_date: "2026-09-30" },
    ]]);
    const r = await buildOpsSections([proc("p1"), proc("p2", "inbound_quality"), proc("m", "baseline", { billingMirror: true })], range);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1][0]).toEqual(["p1", "p2"]);
    const rows = r.operations.data as any[];
    expect(rows.map((x) => x.processCode)).toEqual(["P1", "P2"]);
    expect(rows[0]).toMatchObject({ tier: "full", latestDate: "2026-10-10", stale: false });
    expect(rows[0].metrics.AHT).toBe(280);
    expect(rows[0].metrics.SHRINKAGE_PCT).toBeNull();
    expect(rows[1]).toMatchObject({ stale: true, latestDate: "2026-09-30" });
  });

  it("quality: only full/inbound_quality, ascending, QA only, limited to 10", async () => {
    const procs = Array.from({ length: 12 }, (_, i) => proc(`q${i}`));
    procs.push(proc("ob", "outbound_sale"));
    query.mockResolvedValue([[
      ...procs.map((p, i) => ({ process_id: p.processId, metric_key: "QA_QUALITY_PCT", actual_value: String(50 + i), score_date: "2026-10-14" })),
      { process_id: "ob", metric_key: "QA_QUALITY_PCT", actual_value: "1", score_date: "2026-10-14" },
    ]]);
    const r = await buildOpsSections(procs, range);
    const q = r.quality.data as any[];
    expect(q).toHaveLength(10);
    expect(q[0].processCode).toBe("Q0");
    expect(q.map((x) => x.QA_QUALITY_PCT)).toEqual([50, 51, 52, 53, 54, 55, 56, 57, 58, 59]);
    expect(q.some((x) => x.processCode === "OB")).toBe(false);
    expect(Object.keys(q[0]).includes("AHT")).toBe(false);
  });

  it("no processes: operations, quality, callmaster all empty and nothing queried", async () => {
    const r = await buildOpsSections([], range);
    expect(r.operations.status).toBe("empty");
    expect(r.quality.status).toBe("empty");
    expect(r.callmaster.status).toBe("empty");
    expect(query).not.toHaveBeenCalled();
    expect(getKPIs).not.toHaveBeenCalled();
  });

  it("empty client list: callmaster empty and service never called", async () => {
    getInboundProjects.mockResolvedValue([{ key: "a", processId: "zzz", clientId: "1" }]);
    const r = await buildOpsSections([proc("p1")], range);
    expect(r.callmaster.status).toBe("empty");
    for (const m of [getKPIs, getQualityTrend, getCXParameters, getFatalAgentSummary]) expect(m).not.toHaveBeenCalled();
  });

  it("callmaster passes month range + clientIds; fatal is counts only", async () => {
    getInboundProjects.mockResolvedValue([{ key: "a", processId: "p1", clientId: "409" }]);
    getFatalAgentSummary.mockResolvedValue([
      { date: "2026-10-02", agent: "Asha Rao", client: "GNC", total_calls: 10, fatal_calls: 2, fatal_rate: 20, avg_quality: 70 },
      { date: "2026-10-03", agent: "Asha Rao", client: "GNC", total_calls: 10, fatal_calls: 1, fatal_rate: 10, avg_quality: 70 },
      { date: "2026-10-03", agent: "Ben", client: "GNC", total_calls: 10, fatal_calls: 0, fatal_rate: 0, avg_quality: 90 },
    ]);
    const r = await buildOpsSections([proc("p1")], range);
    expect(getKPIs).toHaveBeenCalledWith({ startDate: "2026-10-01", endDate: "2026-10-15", clientIds: [409] });
    expect(getQualityTrend.mock.calls[0][0]).toEqual({ startDate: "2026-10-01", endDate: "2026-10-15", clientIds: [409] });
    const cm = r.callmaster.data as any;
    expect(cm.fatal.data).toEqual({ totalFatalCalls: 3, agentsWithFatals: 1, truncated: false });
    expect(getFatalAgentSummary.mock.calls[0][1]).toBe(5000);
    const json = JSON.stringify(cm.fatal);
    expect(json).not.toMatch(/Asha|"agent"|"name"/);
  });

  it("fatal section flags truncation when the row limit is hit", async () => {
    getInboundProjects.mockResolvedValue([{ key: "a", processId: "p1", clientId: "409" }]);
    getFatalAgentSummary.mockResolvedValue(Array.from({ length: 5000 }, (_, i) => ({ date: "d", agent: `A${i}`, client: "C", fatal_calls: 1 })));
    const r = await buildOpsSections([proc("p1")], range);
    const f = (r.callmaster.data as any).fatal.data;
    expect(f).toEqual({ totalFatalCalls: 5000, agentsWithFatals: 5000, truncated: true });
    expect(JSON.stringify(f)).not.toMatch(/"agent"|"name"|"code"/);
  });

  it("a failing sub-section becomes error while the others stay ok", async () => {
    getInboundProjects.mockResolvedValue([{ key: "a", processId: "p1", clientId: "409" }]);
    getCXParameters.mockRejectedValue(new Error("boom"));
    const r = await buildOpsSections([proc("p1")], range);
    const cm = r.callmaster.data as any;
    expect(r.callmaster.status).toBe("ok");
    expect(cm.cx.status).toBe("error");
    expect(cm.kpis.status).toBe("ok");
    expect(cm.fatal.status).toBe("ok");
  });

  it("metric query failure isolates to operations/quality error, callmaster unaffected", async () => {
    query.mockRejectedValue(new Error("db down"));
    getInboundProjects.mockResolvedValue([{ key: "a", processId: "p1", clientId: "409" }]);
    const r = await buildOpsSections([proc("p1")], range);
    expect(r.operations.status).toBe("error");
    expect(r.quality.status).toBe("error");
    expect(r.callmaster.status).toBe("ok");
  });
});
