import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit item 16: the CEO focus panel's budget left out header-level top-ups that budgetByBranch()
 * adds for every branch. A top-up names no cost centre, so it is attributed to a focus only when
 * its budget funds nothing else — never pro-rated.
 *
 * 2026-09-23: computed over the shared budget reader (pnl-budget-source.ts), so a mirror budget for
 * a branch that has an ACTIVE HRMS budget that month contributes no top-up at all.
 */

const { execute, tableExists } = vi.hoisted(() => ({ execute: vi.fn(), tableExists: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists }));

const line = (billId: number, budget: number, code: string, branch = "NOIDA") =>
  ({ bill_source_id: billId, budget_source_id: budget, expense_type_name: code, amount: 1000, branch_name: branch, branch_id: `b-${branch}`, cost_centre_id: null });
const topUp = (budget: number, amount: number, branch = "NOIDA") =>
  ({ bill_source_id: budget, reopen_additional_amount: amount, branch_name: branch, branch_id: `b-${branch}` });

function mockMirror(opts: { lines: unknown[]; topUps: unknown[]; hrmsHeaders?: unknown[] }) {
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("FROM finance_budget_header h") && !q.includes("JOIN finance_budget_line l")) return [opts.hrmsHeaders ?? [], []];
    if (q.includes("FROM finance_budget_header h")) return [[], []];
    if (q.includes("FROM finance_budget_line_snapshot l")) return [opts.lines, []];
    if (q.includes("reopen_additional_amount <> 0")) return [opts.topUps, []];
    return [[], []];
  });
}

beforeEach(() => {
  execute.mockReset();
  tableExists.mockReset();
  tableExists.mockResolvedValue(true);
});

describe("focusBudgetTopUps", () => {
  it("attributes a top-up whole when every cost-centre line of its budget is in scope, reports shared ones apart", async () => {
    mockMirror({
      lines: [
        line(1, 1, "BSS/IB/Noida/534"), line(2, 1, "BSS/BO/Noida/999"), line(3, 1, "BSS/IB/Noida/534"),
        line(4, 2, "BSS/IB/Noida/534"), line(5, 2, "X/1"), line(6, 2, "X/2"), line(7, 2, "X/3"),
        line(8, 3, "bss/ib/noida/534 "), line(9, 3, "BSS/BO/Noida/999"),
        line(10, 4, "X/9"),
      ],
      topUps: [topUp(1, 36500), topUp(2, 50000), topUp(3, 1500), topUp(4, 7777)],
    });
    const { focusBudgetTopUps } = await import("../budget-top-up-attribution.js");
    const out = await focusBudgetTopUps("2026-08", ["BSS/IB/Noida/534", "BSS/BO/Noida/999"]);
    // Budget 4 funds none of the scope, so its top-up is neither attributable nor shared.
    expect(out).toEqual({ attributable: 38000, shared: 50000 });

    const mirrorLines = execute.mock.calls.map(([s]) => String(s)).find((s) => s.includes("finance_budget_line_snapshot"))!;
    expect(mirrorLines).toContain("b.active_status = 1 AND b.is_rejected = 0");
    expect(mirrorLines).toContain("l.expense_type = 'CostCenter'");
  });

  it("drops mirror top-ups for a branch whose budget comes from HRMS that month", async () => {
    mockMirror({
      lines: [line(1, 1, "BSS/IB/Noida/534")],
      topUps: [topUp(1, 36500)],
      hrmsHeaders: [{ id: "h1", branch_id: "hrms-noida", branch_name: " noida " }],
    });
    const { focusBudgetTopUps } = await import("../budget-top-up-attribution.js");
    expect(await focusBudgetTopUps("2026-08", ["BSS/IB/Noida/534"])).toEqual({ attributable: 0, shared: 0 });
  });

  it("asks nothing for an empty code list or a malformed period", async () => {
    const { focusBudgetTopUps } = await import("../budget-top-up-attribution.js");
    expect(await focusBudgetTopUps("2026-08", [])).toEqual({ attributable: 0, shared: 0 });
    expect(await focusBudgetTopUps("Aug-26", ["X"])).toEqual({ attributable: 0, shared: 0 });
    expect(execute).not.toHaveBeenCalled();
  });
});
