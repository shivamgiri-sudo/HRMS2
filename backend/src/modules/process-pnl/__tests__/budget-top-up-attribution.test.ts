import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit item 16: the CEO focus panel's budget left out header-level top-ups that budgetByBranch()
 * adds for every branch. A top-up names no cost centre, so it is attributed to a focus only when
 * its budget funds nothing else — never pro-rated.
 */

const { execute, tableExists } = vi.hoisted(() => ({ execute: vi.fn(), tableExists: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists }));

beforeEach(() => {
  execute.mockReset();
  tableExists.mockReset();
  tableExists.mockResolvedValue(true);
});

describe("focusBudgetTopUps", () => {
  it("attributes a top-up whole when every cost-centre line of its budget is in scope, reports shared ones apart", async () => {
    execute.mockResolvedValue([[
      { bill_source_id: "B1", top_up: 36500, in_scope_lines: 3, cost_centre_lines: 3 },
      { bill_source_id: "B2", top_up: 50000, in_scope_lines: 1, cost_centre_lines: 4 },
      { bill_source_id: "B3", top_up: 1500, in_scope_lines: 2, cost_centre_lines: 2 },
    ], []]);
    const { focusBudgetTopUps } = await import("../budget-top-up-attribution.js");
    const out = await focusBudgetTopUps("2026-08", ["BSS/IB/Noida/534", "BSS/BO/Noida/999"]);
    expect(out).toEqual({ attributable: 38000, shared: 50000 });

    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toContain("b.active_status = 1 AND b.is_rejected = 0");
    expect(String(sql)).toContain("l.expense_type = 'CostCenter'");
    expect(params).toEqual(["BSS/IB/Noida/534", "BSS/BO/Noida/999", "2026-08"]);
  });

  it("asks nothing for an empty code list or a malformed period", async () => {
    const { focusBudgetTopUps } = await import("../budget-top-up-attribution.js");
    expect(await focusBudgetTopUps("2026-08", [])).toEqual({ attributable: 0, shared: 0 });
    expect(await focusBudgetTopUps("Aug-26", ["X"])).toEqual({ attributable: 0, shared: 0 });
    expect(execute).not.toHaveBeenCalled();
  });
});
