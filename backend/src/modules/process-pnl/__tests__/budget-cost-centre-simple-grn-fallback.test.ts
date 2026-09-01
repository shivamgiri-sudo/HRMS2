import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The "simple GRN" fallback in budgetCostCentreUtilizationService.get() — direct-CC budget lines
 * whose spend is tracked ONLY in finance_budget_line.reserved_amount/consumed_amount, with no
 * grn_cost_allocation rows written for it at all.
 *
 * Live-verified 2026-09-01: the original fallback checked "does ANY grn_cost_allocation row exist
 * for this line" as a single yes/no gate. A line that has a settled GRN with a real 'consumed'
 * allocation row, plus a newer GRN whose 'reserved' allocation was never written, has an
 * allocation row — so the old gate treated it as "fully covered" and silently dropped the missing
 * reserved amount. Found on 4 live budgets where the Variance tab correctly showed a Reserved
 * figure the Cost Centre tab reported as exactly zero.
 *
 * The fix checks reserved and consumed independently, so a line can fall back for the status with
 * no allocation row while staying measured (0 added here) for the status that already has one.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute } }));

const { budgetCostCentreUtilizationService } = await import("../budget-cost-centre-utilization.service.js");

type Line = {
  id: string;
  cost_centre_id: string | null;
  head: string;
  sub_head: string | null;
  gross_amount: number;
  reserved_amount: number;
  consumed_amount: number;
};
/** Which statuses already have a real grn_cost_allocation row for a given line, so the fake
 *  router's NOT EXISTS checks can answer truthfully per status. */
type AllocatedStatuses = { lineId: string; statuses: Array<"reserved" | "consumed"> };

function makeExecute(opts: { lines: Line[]; allocated?: AllocatedStatuses[] }) {
  const lines = opts.lines;
  const allocated = opts.allocated ?? [];
  const hasAllocation = (lineId: string, status: "reserved" | "consumed") =>
    allocated.some((a) => a.lineId === lineId && a.statuses.includes(status));

  return vi.fn(async (sql: string) => {
    const s = String(sql).replace(/\s+/g, " ").trim();

    if (s.includes("FROM finance_budget_header")) return [[{ branch_id: "br-1" }], []];

    if (s.includes("SELECT cost_centre_id, head, sub_head, line_id")) {
      const direct = lines
        .filter((l) => l.cost_centre_id != null)
        .map((l) => ({ cost_centre_id: l.cost_centre_id, head: l.head, sub_head: l.sub_head, line_id: l.id, budgeted: l.gross_amount }));
      return [direct, []];
    }

    // spendRows — real grn_cost_allocation rows. Deliberately empty: this test is only about
    // lines with NO (or partial) allocation rows; the measured half is covered elsewhere.
    if (s.includes("GROUP BY g.cost_centre_id, l.head, l.sub_head")) return [[], []];
    if (s.includes("g.funding_cost_centre_id AS funding_cost_centre_id")) return [[], []];

    // simpleGrnRows — the fallback under test.
    if (s.includes("CASE WHEN NOT EXISTS")) {
      const rows = lines
        .filter((l) => l.cost_centre_id != null && (l.reserved_amount > 0 || l.consumed_amount > 0))
        .filter((l) => !hasAllocation(l.id, "reserved") || !hasAllocation(l.id, "consumed"))
        .map((l) => ({
          cost_centre_id: l.cost_centre_id,
          head: l.head,
          sub_head: l.sub_head,
          reserved: hasAllocation(l.id, "reserved") ? 0 : l.reserved_amount,
          consumed: hasAllocation(l.id, "consumed") ? 0 : l.consumed_amount,
        }));
      return [rows, []];
    }

    if (s.includes("AS cnt, COALESCE(SUM(l.gross_amount)")) return [[{ cnt: 0, total_budget: 0 }], []];
    if (s.includes("FROM cost_centre_master")) return [[{ id: "cc-A", cost_centre_code: "A", cost_centre_name: "CC A" }], []];

    throw new Error(`Unhandled SQL in fake DB router: ${s.slice(0, 160)}`);
  });
}

beforeEach(() => vi.clearAllMocks());

describe("simple-GRN fallback is evaluated per lifecycle status, not per line", () => {
  it("credits the reserved amount when only the CONSUMED status has a real allocation row", async () => {
    // A settled GRN (consumed, has its own allocation row) sits alongside a newer GRN whose
    // reservation was never written to grn_cost_allocation. The old line-level gate saw "this
    // line has an allocation row" and skipped the reserved fallback entirely.
    execute.mockImplementation(makeExecute({
      lines: [{
        id: "line-A", cost_centre_id: "cc-A", head: "Rent", sub_head: null,
        gross_amount: 50000, reserved_amount: 811.86, consumed_amount: 18298,
      }],
      allocated: [{ lineId: "line-A", statuses: ["consumed"] }],
    }));
    const { rows } = await budgetCostCentreUtilizationService.get("budget-1");
    const ccA = rows.find((r) => r.costCentreId === "cc-A")!;
    // Reserved comes from the fallback (no allocation row for 'reserved').
    expect(ccA.reserved).toBe(811.86);
    // Consumed stays at 0 here since this fixture's spendRows (the real measurement) is empty —
    // proving the fallback does NOT also credit the status that already has an allocation row.
    expect(ccA.consumed).toBe(0);
  });

  it("credits nothing when both statuses already have a real allocation row", async () => {
    execute.mockImplementation(makeExecute({
      lines: [{
        id: "line-B", cost_centre_id: "cc-A", head: "Rent", sub_head: null,
        gross_amount: 50000, reserved_amount: 500, consumed_amount: 1000,
      }],
      allocated: [{ lineId: "line-B", statuses: ["reserved", "consumed"] }],
    }));
    const { rows } = await budgetCostCentreUtilizationService.get("budget-1");
    const ccA = rows.find((r) => r.costCentreId === "cc-A")!;
    expect(ccA.reserved).toBe(0);
    expect(ccA.consumed).toBe(0);
  });

  it("credits both when neither status has an allocation row (the original simple-GRN case)", async () => {
    execute.mockImplementation(makeExecute({
      lines: [{
        id: "line-C", cost_centre_id: "cc-A", head: "Rent", sub_head: null,
        gross_amount: 50000, reserved_amount: 200, consumed_amount: 300,
      }],
      allocated: [],
    }));
    const { rows } = await budgetCostCentreUtilizationService.get("budget-1");
    const ccA = rows.find((r) => r.costCentreId === "cc-A")!;
    expect(ccA.reserved).toBe(200);
    expect(ccA.consumed).toBe(300);
  });
});
