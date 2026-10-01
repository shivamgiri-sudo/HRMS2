import { describe, it, expect, vi, beforeEach } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../process-pnl.service.js", () => ({ processPnlService: { invalidateCaches: vi.fn() } }));
vi.mock("../../workforce-mandate/workforce.mandate.routes.js", () => ({ clearCapacityCache: vi.fn() }));

import { syncProcessSeats } from "../seat-mandate-sync.service.js";

/** Routes each SELECT by table name; UPDATEs are recorded. */
function wire(rowsByTable: Record<string, unknown[]>) {
  execute.mockReset();
  execute.mockImplementation(async (sql: string) => {
    if (/^\s*UPDATE/i.test(sql)) return [{ affectedRows: 1 }];
    for (const [table, rows] of Object.entries(rowsByTable)) if (sql.includes(table)) return [rows];
    return [[]];
  });
}
const updates = () => execute.mock.calls.map((c) => String(c[0])).filter((s) => /^\s*UPDATE/i.test(s));

describe("syncProcessSeats", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pushes a WFM mandate to the single revenue rule, plan and cost centre", async () => {
    wire({
      process_revenue_rule: [{ id: "r1", mandated_seats: 10 }],
      process_monthly_plan: [{ id: "p1", contracted_seats: 10 }],
      cost_centre_master: [{ id: "c1", mandated_seats: "10" }],
    });
    const r = await syncProcessSeats({ processId: "P", seats: 31, source: "wfm_mandate", actorId: "u" });
    expect(r.updated.map((u) => u.target).sort()).toEqual(["cost_centre", "monthly_plan", "revenue_rule"]);
    expect(updates()).toHaveLength(3);
  });

  it("never splits a number across several rows — skips and reports", async () => {
    wire({
      workforce_mandate: [{ id: "a", mandated_hc: 5 }, { id: "b", mandated_hc: 6 }],
      process_revenue_rule: [{ id: "r1" }, { id: "r2" }],
    });
    const r = await syncProcessSeats({ processId: "P", seats: 20, source: "monthly_plan", actorId: "u" });
    expect(r.updated).toEqual([]);
    expect(r.skipped.map((s) => s.target)).toEqual(expect.arrayContaining(["wfm_mandate", "revenue_rule"]));
    expect(updates()).toHaveLength(0);
  });

  it("does not write when the target already holds the value", async () => {
    wire({ workforce_mandate: [{ id: "a", mandated_hc: 31 }] });
    const r = await syncProcessSeats({ processId: "P", seats: 31, source: "revenue_rule", actorId: "u" });
    expect(r.updated).toEqual([]);
    expect(updates()).toHaveLength(0);
  });

  it("rounds to a whole number for the WFM headcount", async () => {
    wire({ workforce_mandate: [{ id: "a", mandated_hc: 5 }] });
    await syncProcessSeats({ processId: "P", seats: 12.5, source: "revenue_rule", actorId: "u" });
    const wfm = execute.mock.calls.find((c) => /UPDATE workforce_mandate/i.test(String(c[0])));
    expect(wfm?.[1]?.[0]).toBe(13);
  });

  it("ignores a negative or non-numeric value", async () => {
    wire({});
    expect((await syncProcessSeats({ processId: "P", seats: -1, source: "wfm_mandate", actorId: "u" })).updated).toEqual([]);
    expect((await syncProcessSeats({ processId: "P", seats: Number.NaN, source: "wfm_mandate", actorId: "u" })).updated).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
});
