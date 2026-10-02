import { describe, expect, it, vi } from "vitest";
import { listPendingCells, parsePendingCellsQuery, PENDING_CELLS_LIMIT } from "../roster-requests.pending-cells.js";

describe("parsePendingCellsQuery", () => {
  it("accepts a valid range with optional filters", () => {
    expect(parsePendingCellsQuery({ from: "2026-10-01", to: "2026-10-07", processId: "p1", branchId: "b1" }))
      .toEqual({ from: "2026-10-01", to: "2026-10-07", processId: "p1", branchId: "b1" });
    expect(parsePendingCellsQuery({ from: "2026-10-01", to: "2026-10-01" }))
      .toEqual({ from: "2026-10-01", to: "2026-10-01", processId: null, branchId: null });
  });

  it.each([
    [{}],
    [{ from: "2026-10-01" }],
    [{ from: "2026/10/01", to: "2026-10-07" }],
    [{ from: "2026-02-30", to: "2026-03-07" }],
    [{ from: "2026-10-07", to: "2026-10-01" }],
    [{ from: ["2026-10-01"], to: "2026-10-07" }],
  ])("rejects %o", (q) => {
    expect(parsePendingCellsQuery(q as any)).toBeNull();
  });
});

describe("listPendingCells", () => {
  const rows = [
    { employee_id: "e1", date: "2026-10-02", kind: "swap", id: "s1" },
    { employee_id: "e2", date: "2026-10-02", kind: "swap", id: "s1" },
    { employee_id: "e3", date: "2026-10-03", kind: "dispute", id: "d1" },
  ];

  it("unions the four kinds in range, applies filters and scope, caps at the limit", async () => {
    const exec = { execute: vi.fn(async () => [rows, []]) };
    const out = await listPendingCells(
      { from: "2026-10-01", to: "2026-10-07", processId: "p1", branchId: "b1" },
      { sql: "e.branch_id = ?", params: ["bX"] },
      exec as any,
    );
    expect(out).toEqual([
      { employeeId: "e1", date: "2026-10-02", kind: "swap", id: "s1" },
      { employeeId: "e2", date: "2026-10-02", kind: "swap", id: "s1" },
      { employeeId: "e3", date: "2026-10-03", kind: "dispute", id: "d1" },
    ]);
    const [sql, params] = (exec.execute.mock.calls[0] as any);
    for (const t of ["wfm_roster_swap_request", "wfm_roster_assignment", "roster_daily_assignment", "wfm_roster_conflict_log"]) {
      expect(sql).toContain(t);
    }
    expect((sql.match(/UNION ALL/g) ?? []).length).toBe(3);
    expect(sql).toContain(`LIMIT ${PENDING_CELLS_LIMIT}`);
    expect(sql).toContain("s.status = 'pending'");
    expect(sql).toContain("'pending_manager_action'");
    expect(sql).toContain("dispute_resolved_at IS NULL");
    expect(sql).toContain("c.resolved = 0");
    // per branch: from, to, processId, branchId, scope param
    expect(params).toEqual(Array(4).fill(["2026-10-01", "2026-10-07", "p1", "b1", "bX"]).flat());
  });

  it("omits the optional filters when absent", async () => {
    const exec = { execute: vi.fn(async () => [[], []]) };
    await listPendingCells({ from: "2026-10-01", to: "2026-10-07", processId: null, branchId: null }, { sql: "1=1", params: [] }, exec as any);
    const [sql, params] = (exec.execute.mock.calls[0] as any);
    expect(sql).not.toContain("e.process_id = ?");
    expect(params).toEqual(Array(4).fill(["2026-10-01", "2026-10-07"]).flat());
  });
});
