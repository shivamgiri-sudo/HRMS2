import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { query: (...a: unknown[]) => query(...a) } }));
const listBranchProcesses = vi.fn();
vi.mock("../processes.js", () => ({
  listBranchProcesses: (...a: unknown[]) => listBranchProcesses(...a),
  masCostCentreSql: (a: string) => `(${a}.company_name LIKE '%mascallnet%')`,
}));

import { buildDataHealth } from "../dataHealth.js";

const bp = (id: string, extra: any = {}) => ({ processId: id, processCode: id, billingMirror: false, ...extra });

beforeEach(() => {
  query.mockReset();
  listBranchProcesses.mockReset();
  listBranchProcesses.mockResolvedValue({ active: [], unmapped: [] });
});

function route(o: { noProc?: number; seats?: any[]; metrics?: any[] }) {
  query.mockImplementation(async (sql: string) => {
    if (sql.includes("COUNT(*) AS n")) return [[{ n: o.noProc ?? 0 }]];
    if (sql.includes("mandated_seats")) return [o.seats ?? []];
    if (sql.includes("process_metric_actual")) return [o.metrics ?? []];
    return [[]];
  });
}

describe("buildDataHealth", () => {
  it("empty branch list is empty and runs no query", async () => {
    const r = await buildDataHealth([], "2026-10-15");
    expect(r.status).toBe("empty");
    expect(query).not.toHaveBeenCalled();
  });

  it("non-numeric mandated_seats such as 'o' is ignored, not NaN", async () => {
    route({
      noProc: 2,
      seats: [
        { id: "1", cc_code: "CC-O", mandated_seats: "o", headcount: 5 },
        { id: "2", cc_code: "CC-OK", mandated_seats: "10", headcount: 10 },
        { id: "3", cc_code: "CC-OVER", mandated_seats: "10", headcount: 13 },
        { id: "4", cc_code: "CC-ZERO", mandated_seats: "0", headcount: 3 },
      ],
    });
    listBranchProcesses.mockResolvedValue({ active: [], unmapped: [bp("u1"), bp("u2")] });
    const r = await buildDataHealth(["b1"], "2026-10-15");
    expect(r.status).toBe("ok");
    expect(r.data).toEqual({
      unmappedProcesses: 2, costCentresWithoutProcess: 2,
      overMandate: [{ costCentre: "CC-OVER", seats: 10, headcount: 13 }], staleProcesses: 0,
    });
    expect(JSON.stringify(r)).not.toContain("NaN");
  });

  it("stale processes counted from active non-mirror, 14 vs 15 days", async () => {
    listBranchProcesses.mockResolvedValue({ active: [bp("a"), bp("b"), bp("m", { billingMirror: true })], unmapped: [] });
    route({
      metrics: [
        { process_id: "a", metric_key: "AHT", actual_value: "1", score_date: "2026-10-01" },
        { process_id: "b", metric_key: "AHT", actual_value: "1", score_date: "2026-09-30" },
        { process_id: "m", metric_key: "AHT", actual_value: "1", score_date: "2026-09-01" },
      ],
    });
    const r = await buildDataHealth(["b1"], "2026-10-15");
    expect(r.data?.staleProcesses).toBe(1);
  });

  it("both cost-centre queries carry the company predicate and the active-link check", async () => {
    route({});
    await buildDataHealth(["b1"], "2026-10-15");
    const sqls = query.mock.calls.map((c) => String(c[0])).filter((s) => s.includes("cost_centre_master"));
    expect(sqls).toHaveLength(2);
    for (const s of sqls) expect(s).toContain("LIKE '%mascallnet%'");
    expect(sqls.find((s) => s.includes("cost_centre_process_link"))).toContain("l.active_status = 1");
  });

  it("uses supplied process groups without listing again", async () => {
    route({});
    await buildDataHealth(["b1"], "2026-10-15", { active: [], unmapped: [bp("u")] } as any);
    expect(listBranchProcesses).not.toHaveBeenCalled();
  });
});
