import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `fundedElsewhere`/`fundingSources`, added 2026-08-29 to budgetCostCentreUtilizationService.
 *
 * Every P&L-facing query in process-pnl was found to read `grn_cost_allocation.cost_centre_id`
 * (who incurred a GRN's cost) and none of them read `funding_cost_centre_id` (whose budget line
 * actually paid, migration 1630) — not a double-count, since each row is still summed once, but a
 * real loss of the one fact that column exists to preserve. This is additive on the one report
 * best positioned to show it: the cost centre's own reserved/consumed totals are asserted
 * unchanged with or without a cross-centre spill, and the new fields report the SAME money's
 * source, never a new number.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute } }));

const { budgetCostCentreUtilizationService } = await import("../budget-cost-centre-utilization.service.js");

type Line = { id: string; cost_centre_id: string | null; head: string; sub_head: string | null; gross_amount: number };
type Alloc = {
  cost_centre_id: string | null;
  funding_cost_centre_id: string | null;
  budget_line_id: string;
  lifecycle_status: "reserved" | "consumed";
  amount_with_tax: number;
};

function makeExecute(opts: {
  lines?: Line[];
  allocations?: Alloc[];
  lineAllocations?: Array<{ budget_line_id: string; cost_centre_id: string; gross_amount: number }>;
  costCentres?: Array<{ id: string; cost_centre_code: string; cost_centre_name: string }>;
}) {
  const lines = opts.lines ?? [];
  const allocations = opts.allocations ?? [];
  const lineAllocations = opts.lineAllocations ?? [];
  const costCentres = opts.costCentres ?? [];

  return vi.fn(async (sql: string, params: unknown[] = []) => {
    const s = String(sql).replace(/\s+/g, " ").trim();

    // getBudgetBranch — unused by .get() directly, answered generically.
    if (s.includes("FROM finance_budget_header")) return [[{ branch_id: "br-1" }], []];

    // budgetRows UNION: direct lines + branch-level allocation.
    if (s.includes("SELECT cost_centre_id, head, sub_head, line_id")) {
      const direct = lines
        .filter((l) => l.cost_centre_id != null)
        .map((l) => ({ cost_centre_id: l.cost_centre_id, head: l.head, sub_head: l.sub_head, line_id: l.id, budgeted: l.gross_amount }));
      const allocated = lineAllocations.map((a) => {
        const line = lines.find((l) => l.id === a.budget_line_id)!;
        return { cost_centre_id: a.cost_centre_id, head: line.head, sub_head: line.sub_head, line_id: line.id, budgeted: a.gross_amount };
      });
      return [[...direct, ...allocated], []];
    }

    // spendRows: grouped by (cost_centre_id, head, sub_head).
    if (s.includes("SUM(CASE WHEN g.lifecycle_status = 'reserved' THEN g.amount_with_tax") && s.includes("GROUP BY g.cost_centre_id, l.head, l.sub_head")) {
      const groups = new Map<string, { cost_centre_id: string | null; head: string; sub_head: string | null; reserved: number; consumed: number }>();
      for (const a of allocations) {
        const line = lines.find((l) => l.id === a.budget_line_id)!;
        const key = JSON.stringify([a.cost_centre_id, line.head, line.sub_head]);
        const g = groups.get(key) ?? { cost_centre_id: a.cost_centre_id, head: line.head, sub_head: line.sub_head, reserved: 0, consumed: 0 };
        if (a.lifecycle_status === "reserved") g.reserved += a.amount_with_tax;
        else g.consumed += a.amount_with_tax;
        groups.set(key, g);
      }
      return [[...groups.values()], []];
    }

    // fundedElsewhereRows: grouped by (cost_centre_id, funding_cost_centre_id), only the spilled subset.
    if (s.includes("g.funding_cost_centre_id AS funding_cost_centre_id")) {
      const groups = new Map<string, { cost_centre_id: string | null; funding_cost_centre_id: string | null; reserved: number; consumed: number }>();
      for (const a of allocations) {
        const spilled = a.funding_cost_centre_id == null || a.funding_cost_centre_id !== a.cost_centre_id || a.cost_centre_id == null;
        if (!spilled) continue;
        const key = JSON.stringify([a.cost_centre_id, a.funding_cost_centre_id]);
        const g = groups.get(key) ?? { cost_centre_id: a.cost_centre_id, funding_cost_centre_id: a.funding_cost_centre_id, reserved: 0, consumed: 0 };
        if (a.lifecycle_status === "reserved") g.reserved += a.amount_with_tax;
        else g.consumed += a.amount_with_tax;
        groups.set(key, g);
      }
      return [[...groups.values()], []];
    }

    // simpleGrnRows — none in these fixtures.
    if (s.includes("l.reserved_amount AS reserved")) return [[], []];

    // unallocatedRows.
    if (s.includes("AS cnt, COALESCE(SUM(l.gross_amount)")) return [[{ cnt: 0, total_budget: 0 }], []];

    // cost_centre_master name lookup.
    if (s.includes("FROM cost_centre_master")) {
      const ids = params as string[];
      return [costCentres.filter((c) => ids.includes(c.id)), []];
    }

    throw new Error(`Unhandled SQL in fake DB router: ${s.slice(0, 160)}`);
  });
}

beforeEach(() => vi.clearAllMocks());

describe("no spill — the new fields are present and zero, nothing else changes", () => {
  it("a cost centre funded entirely by its own line reports zero fundedElsewhere", async () => {
    execute.mockImplementation(makeExecute({
      lines: [{ id: "line-A", cost_centre_id: "cc-A", head: "Rent", sub_head: null, gross_amount: 10000 }],
      allocations: [{ cost_centre_id: "cc-A", funding_cost_centre_id: "cc-A", budget_line_id: "line-A", lifecycle_status: "consumed", amount_with_tax: 1000 }],
      costCentres: [{ id: "cc-A", cost_centre_code: "A", cost_centre_name: "CC A" }],
    }));
    const { rows } = await budgetCostCentreUtilizationService.get("budget-1");
    const ccA = rows.find((r) => r.costCentreId === "cc-A")!;
    expect(ccA.consumed).toBe(1000);
    expect(ccA.fundedElsewhere).toEqual({ reserved: 0, consumed: 0 });
    expect(ccA.fundingSources).toEqual([]);
  });
});

describe("cost centre A funded by cost centre B's line", () => {
  it("reports the spend under A (unchanged) AND names B as the funding source", async () => {
    execute.mockImplementation(makeExecute({
      lines: [{ id: "line-B", cost_centre_id: "cc-B", head: "Office Supplies", sub_head: "Stationery", gross_amount: 20000 }],
      allocations: [{ cost_centre_id: "cc-A", funding_cost_centre_id: "cc-B", budget_line_id: "line-B", lifecycle_status: "consumed", amount_with_tax: 3000 }],
      costCentres: [
        { id: "cc-A", cost_centre_code: "A", cost_centre_name: "CC A" },
        { id: "cc-B", cost_centre_code: "B", cost_centre_name: "CC B" },
      ],
    }));
    const { rows } = await budgetCostCentreUtilizationService.get("budget-1");

    // The existing figure — what this file already reported before today — is UNCHANGED: A's
    // spend total still shows the full 3000, exactly as it always has.
    const ccA = rows.find((r) => r.costCentreId === "cc-A")!;
    expect(ccA.consumed).toBe(3000);

    // What is NEW: A's row now says how much of that 3000 was not paid by A's own budget, and by
    // whom instead.
    expect(ccA.fundedElsewhere).toEqual({ reserved: 0, consumed: 3000 });
    expect(ccA.fundingSources).toEqual([
      { costCentreId: "cc-B", costCentreName: "CC B", reserved: 0, consumed: 3000 },
    ]);

    // B still has its own row (it owns a real budget line, 20000 gross) — but B INCURRED nothing,
    // so B's own reserved/consumed and fundedElsewhere are all zero. fundedElsewhere is an
    // attribute of the INCURRING centre's row, never the funding centre's.
    const ccB = rows.find((r) => r.costCentreId === "cc-B")!;
    expect(ccB.budgeted).toBe(20000);
    expect(ccB.consumed).toBe(0);
    expect(ccB.fundedElsewhere).toEqual({ reserved: 0, consumed: 0 });
  });

  it("a branch-common (pooled) funding line reports the source as the branch pool, not a guess", async () => {
    execute.mockImplementation(makeExecute({
      lines: [{ id: "line-pool", cost_centre_id: null, head: "Electricity", sub_head: null, gross_amount: 50000 }],
      allocations: [{ cost_centre_id: "cc-A", funding_cost_centre_id: null, budget_line_id: "line-pool", lifecycle_status: "reserved", amount_with_tax: 1200 }],
      costCentres: [{ id: "cc-A", cost_centre_code: "A", cost_centre_name: "CC A" }],
    }));
    const { rows } = await budgetCostCentreUtilizationService.get("budget-1");
    const ccA = rows.find((r) => r.costCentreId === "cc-A")!;
    expect(ccA.reserved).toBe(1200);
    expect(ccA.fundedElsewhere).toEqual({ reserved: 1200, consumed: 0 });
    expect(ccA.fundingSources).toEqual([
      { costCentreId: null, costCentreName: "Branch-common pool", reserved: 1200, consumed: 0 },
    ]);
  });

  it("mixes own-funded and spilled spend on the same cost centre without conflating them", async () => {
    execute.mockImplementation(makeExecute({
      lines: [
        { id: "line-A", cost_centre_id: "cc-A", head: "Rent", sub_head: null, gross_amount: 10000 },
        { id: "line-B", cost_centre_id: "cc-B", head: "Rent", sub_head: null, gross_amount: 20000 },
      ],
      allocations: [
        { cost_centre_id: "cc-A", funding_cost_centre_id: "cc-A", budget_line_id: "line-A", lifecycle_status: "consumed", amount_with_tax: 500 },
        { cost_centre_id: "cc-A", funding_cost_centre_id: "cc-B", budget_line_id: "line-B", lifecycle_status: "consumed", amount_with_tax: 700 },
      ],
      costCentres: [
        { id: "cc-A", cost_centre_code: "A", cost_centre_name: "CC A" },
        { id: "cc-B", cost_centre_code: "B", cost_centre_name: "CC B" },
      ],
    }));
    const { rows } = await budgetCostCentreUtilizationService.get("budget-1");
    const ccA = rows.find((r) => r.costCentreId === "cc-A")!;
    // Total is the sum of both — the existing figure is untouched by which line funded which part.
    expect(ccA.consumed).toBe(1200);
    // Only the SPILLED 700 shows as funded elsewhere, not the full 1200.
    expect(ccA.fundedElsewhere).toEqual({ reserved: 0, consumed: 700 });
    expect(ccA.fundingSources).toEqual([
      { costCentreId: "cc-B", costCentreName: "CC B", reserved: 0, consumed: 700 },
    ]);
  });
});
