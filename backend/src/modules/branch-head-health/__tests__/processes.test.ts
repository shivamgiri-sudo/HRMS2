import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { query: (...a: unknown[]) => query(...a) } }));

import { coverageTier, getProcessDrilldown, listBranchProcesses } from "../processes.js";

type Row = Record<string, unknown>;
function route(r: { cc?: Row[]; proc?: Row[]; metrics?: Row[]; drill?: Row[]; owns?: Row[] }) {
  query.mockImplementation(async (sql: string) => {
    if (sql.includes("LIMIT 1")) return [r.owns ?? []];
    if (sql.includes("FROM process_metric_actual")) return [r.metrics ?? []];
    if (sql.includes("cost_centre_master cc")) return [r.cc ?? []];
    if (sql.includes("FROM employees e") && sql.includes("e.first_name")) return [r.drill ?? []];
    if (sql.includes("FROM process_master p")) return [r.proc ?? []];
    return [[]];
  });
}
beforeEach(() => { query.mockReset(); });

describe("coverageTier", () => {
  it("full / inbound_quality / outbound_sale / baseline / not_wired", () => {
    expect(coverageTier(["FUNNEL_CONNECT", "RISK_X", "QA_SCORE"])).toBe("full");
    expect(coverageTier(["FUNNEL_CONNECT", "QA_SCORE"])).toBe("full");
    expect(coverageTier(["INBOUND_SL_PCT", "QA_SCORE"])).toBe("inbound_quality");
    expect(coverageTier(["AHT", "QA_SCORE"])).toBe("inbound_quality");
    expect(coverageTier(["FUNNEL_CONNECT"])).toBe("outbound_sale");
    expect(coverageTier(["SHRINKAGE_PCT", "PROCESS_JOINERS"])).toBe("baseline");
    expect(coverageTier([])).toBe("not_wired");
  });
});

describe("listBranchProcesses", () => {
  const p = (id: string, code: string, hc = 0) => ({ id, process_code: code, process_name: code + " name", headcount: hc });

  it("link-only process is active with viaLink true", async () => {
    route({
      cc: [{ cc_id: "c1", cc_code: "CC1", mandated_seats: "10", process_id: "p1", via_link: 1 }],
      proc: [p("p1", "P1")],
      metrics: [{ process_id: "p1", metric_key: "SHRINKAGE_PCT", latest: "2026-10-14" }],
    });
    const g = await listBranchProcesses(["b1"]);
    expect(g.active).toHaveLength(1);
    expect(g.active[0]).toMatchObject({ processId: "p1", viaLink: true, mandatedSeats: 10, tier: "baseline", latestMetricDate: "2026-10-14", costCentres: ["CC1"] });
    expect(g.unmapped).toHaveLength(0);
  });

  it("no cost centre and 0 headcount goes to unmapped", async () => {
    route({ proc: [p("p2", "P2")] });
    const g = await listBranchProcesses(["b1"]);
    expect(g.active).toHaveLength(0);
    expect(g.unmapped[0]).toMatchObject({ processId: "p2", tier: "not_wired", mandatedSeats: null });
  });

  it("process with headcount but no cost centre is active", async () => {
    route({ proc: [p("p3", "P3", 4)] });
    const g = await listBranchProcesses(["b1"]);
    expect(g.active[0]).toMatchObject({ processId: "p3", headcount: 4, viaLink: false });
  });

  it("process reached through two branches appears once, seats numeric-only", async () => {
    route({
      cc: [
        { cc_id: "c1", cc_code: "CC1", mandated_seats: "10", process_id: "p1", via_link: 0 },
        { cc_id: "c2", cc_code: "CC2", mandated_seats: "o", process_id: "p1", via_link: 0 },
        { cc_id: "c1", cc_code: "CC1", mandated_seats: "10", process_id: "p1", via_link: 0 },
      ],
      proc: [p("p1", "P1", 2), p("p1", "P1", 2)],
    });
    const g = await listBranchProcesses(["b1", "b2"]);
    expect(g.active).toHaveLength(1);
    expect(g.active[0].mandatedSeats).toBe(10);
    expect(g.active[0].costCentres).toEqual(["CC1", "CC2"]);
  });

  it("non-numeric-only seats give null", async () => {
    route({ cc: [{ cc_id: "c1", cc_code: "CC1", mandated_seats: "o", process_id: "p1", via_link: 0 }], proc: [p("p1", "P1")] });
    const g = await listBranchProcesses(["b1"]);
    expect(g.active[0].mandatedSeats).toBeNull();
  });

  it("BSS process with headcount is listed standalone, not a mirror", async () => {
    route({ proc: [p("p9", "BSS_CC1", 3)] });
    const g = await listBranchProcesses(["b1"]);
    expect(g.active[0]).toMatchObject({ processCode: "BSS_CC1", billingMirror: false });
  });

  it("idle BSS that is primary of an active cost centre is active with billingMirror", async () => {
    route({
      cc: [{ cc_id: "c1", cc_code: "CC1", mandated_seats: "5", process_id: "p9", via_link: 0 }],
      proc: [p("p9", "BSS_CC1")],
    });
    const g = await listBranchProcesses(["b1"]);
    expect(g.active).toHaveLength(1);
    expect(g.active[0]).toMatchObject({ billingMirror: true, costCentres: ["CC1"] });
  });

  it("idle BSS without a cost centre goes to unmapped", async () => {
    route({ proc: [p("p9", "BSS_X")] });
    const g = await listBranchProcesses(["b1"]);
    expect(g.active).toHaveLength(0);
    expect(g.unmapped[0].processCode).toBe("BSS_X");
  });

  it("applies the MAS gate to every branch alias", async () => {
    route({});
    await listBranchProcesses(["b1"]);
    for (const [sql] of query.mock.calls as [string][]) {
      if (sql.includes("branch_master")) expect(sql).toContain("%mascallnet%");
    }
    expect(query.mock.calls.some(([s]) => String(s).includes("b.close_date IS NULL"))).toBe(true);
  });

  it("empty branch list returns empty groups without querying", async () => {
    const g = await listBranchProcesses([]);
    expect(g).toEqual({ active: [], unmapped: [] });
    expect(query).not.toHaveBeenCalled();
  });
});

describe("getProcessDrilldown", () => {
  it("returns [] when the process is not reachable from the branch", async () => {
    route({ owns: [] });
    expect(await getProcessDrilldown("b1", "p1", "AHT")).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("reachability covers link-only processes and the MAS gate", async () => {
    route({ owns: [{ id: "p1" }], drill: [] });
    await getProcessDrilldown("b1", "p1", "AHT");
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("cost_centre_process_link");
    expect(sql).toContain("%mascallnet%");
    expect(sql).toContain("e0.branch_id = ?");
  });
  it("returns only branch employees, names included, value null when no metric row", async () => {
    route({
      owns: [{ id: "p1" }],
      drill: [{ employee_code: "E1", first_name: "A", last_name: "B", value: "12.5" }, { employee_code: "E2", first_name: "C", last_name: null, value: null }],
    });
    const rows = await getProcessDrilldown("b1", "p1", "AHT");
    expect(rows).toEqual([
      { employeeCode: "E1", name: "A B", value: 12.5, metric: "AHT" },
      { employeeCode: "E2", name: "C", value: null, metric: "AHT" },
    ]);
    const [sql, params] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain("e.branch_id = ?");
    expect(params).toContain("b1");
  });
});
