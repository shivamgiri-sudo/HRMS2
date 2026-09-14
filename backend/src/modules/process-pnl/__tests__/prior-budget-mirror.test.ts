import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reading last month's budget out of the db_bill mirror.
 *
 * The mirror is not a drop-in copy of a workspace budget, and each of its three quirks produces a
 * plausible-looking wrong number rather than an error. All three are pinned here because the
 * output is a budget figure a branch head plans against.
 */

const { execute, tableExists } = vi.hoisted(() => ({ execute: vi.fn(), tableExists: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists, queryRows: vi.fn() }));
vi.mock("../branch-budget-allocation.service.js", () => ({
  computeLineAllocations: vi.fn(), getLineAllocations: vi.fn(), replaceLineAllocations: vi.fn(),
}));

const sqlOf = () => String(execute.mock.calls[0][0]).replace(/\s+/g, " ");

beforeEach(() => {
  execute.mockReset();
  tableExists.mockReset();
  tableExists.mockResolvedValue(true);
  execute.mockResolvedValue([[], []]);
});

describe("prior budget from the db_bill mirror", () => {
  it("counts each amount once, not twice", async () => {
    // Every budget line is mirrored under BOTH expense_type 'CostCenter' and 'Particular' --
    // July holds 101 rows and Rs 81.52 lakh under each. Without the filter the branch head is
    // shown double their real budget.
    const { getPriorBudgetFromMirror } = await import("../branch-budget.service.js");
    await getPriorBudgetFromMirror("2026-07", "branch-1");
    expect(sqlOf()).toContain("l.expense_type = 'CostCenter'");
  });

  it("qualifies both head joins by head_type", async () => {
    /*
     * head_id and sub_head_id come from separate id sequences that collide: bill_source_id
     * '000001' is the head "Communication & Connectivity" AND the sub-head "Performance
     * Incentives". Unqualified, every row fans out threefold and heads pair with unrelated
     * sub-heads -- live output showed "Tea, Coffee & Refreshment / Office Rent" at exactly the
     * same Rs 21.61 lakh as "Office Rent / Office Rent".
     */
    const { getPriorBudgetFromMirror } = await import("../branch-budget.service.js");
    await getPriorBudgetFromMirror("2026-07", "branch-1");
    const sql = sqlOf();
    expect(sql).toContain("hh.head_type = 'head'");
    expect(sql).toContain("sh.head_type = 'subhead'");
  });

  it("filters to the caller's branch rather than joining outward from the mirror", async () => {
    // branch_master holds three Head Office rows ("HEAD OFFICE" twice plus "Head Office"), so a
    // join out of the mirror triples that branch. Filtering by bm.id keeps it at one.
    const { getPriorBudgetFromMirror } = await import("../branch-budget.service.js");
    await getPriorBudgetFromMirror("2026-07", "branch-1");
    expect(sqlOf()).toContain("bm.id = ?");
    expect(execute.mock.calls[0][1]).toEqual(["2026-07", "branch-1"]);
  });

  it("returns nothing rather than throwing when the mirror is not installed", async () => {
    tableExists.mockResolvedValue(false);
    const { getPriorBudgetFromMirror } = await import("../branch-budget.service.js");
    expect(await getPriorBudgetFromMirror("2026-07", "branch-1")).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a malformed period or a missing branch without querying", async () => {
    const { getPriorBudgetFromMirror } = await import("../branch-budget.service.js");
    expect(await getPriorBudgetFromMirror("Jul-26", "branch-1")).toEqual([]);
    expect(await getPriorBudgetFromMirror("2026-07", "")).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("maps a row to head, sub-head and amount", async () => {
    execute.mockResolvedValue([[
      { head: "Office Rent", sub_head: "Office Rent", amount: "2161000.00" },
      { head: "Staff Welfare", sub_head: null, amount: "267000.00" },
    ], []]);
    const { getPriorBudgetFromMirror } = await import("../branch-budget.service.js");
    const rows = await getPriorBudgetFromMirror("2026-07", "branch-1");
    expect(rows).toEqual([
      { head: "Office Rent", subHead: "Office Rent", amount: 2161000 },
      // A null sub-head becomes "" so the workspace's `head|subhead` key still matches.
      { head: "Staff Welfare", subHead: "", amount: 267000 },
    ]);
  });
});
