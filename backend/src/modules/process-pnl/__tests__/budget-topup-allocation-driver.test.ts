import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The 2026-08-29 fix: a top-up divides its money by the SAME sharing rule the budget line uses,
 * instead of leaving the split describing the pre-top-up amount (or, for a top-up that creates a
 * new head/sub-head, never having a rule at all).
 *
 * `resyncLineAllocations` — the function this exercises — already has direct unit coverage in
 * branch-budget-allocation.test.ts (its host module). What was untested is the WIRING: that
 * `applyTopupToLine`/`applyTopupAsNewLine` actually call it when no hand-typed splits are given,
 * that hand-typed splits still take priority, and that a missing driver reports rather than
 * blocks the top-up. Rather than extending budget-topup-cost-centre-split.test.ts's large
 * hand-matched-SQL harness to also answer computeLineAllocations' several extra queries, this is
 * a focused fake scoped to exactly the two call sites and the reads they trigger.
 */

const { execute, getConnection } = vi.hoisted(() => ({ execute: vi.fn(), getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));
vi.mock("../finance-period-lock.js", () => ({ isPeriodLocked: vi.fn(async () => false) }));

const { budgetTopupService } = await import("../budget-topup.service.js");

type Line = {
  id: string; budget_id: string; cost_centre_id: string | null; planning_level: string;
  head: string; sub_head: string | null; item_name: string;
  quantity: number; unit: string; unit_rate: number;
  tax_treatment: string; gst_rate: number; gst_type: string; recoverable_tax_pct: number;
  base_amount: number; tax_amount: number; gross_amount: number;
  recoverable_tax_amount: number; pnl_cost_amount: number;
  cgst_amount: number; sgst_amount: number; igst_amount: number;
  allocation_driver?: string | null;
};

function makeState() {
  return {
    lines: new Map<string, Line>(),
    headers: new Map<string, { id: string; status: string; branch_id: string; period_code: string; gross_budget_amount: number; pnl_budget_amount: number }>(),
    requests: new Map<string, any>(),
    splits: new Map<string, Array<{ cost_centre_id: string; amount: number; quantity: number }>>(),
    allocations: [] as Array<{ id: string; budget_line_id: string; cost_centre_id: string; gross_amount: number; base_amount: number; tax_amount: number; pnl_cost_amount: number; allocation_percentage: number }>,
    costCentres: new Map<string, { id: string; branch_id: string; active_status: number }>(),
    drivers: new Map<string, number>(), // key: `${branchId}|${period}|${costCentreId}` -> planned_headcount
  };
}

function keyDriver(branchId: string, period: string, ccId: string) {
  return `${branchId}|${period}|${ccId}`;
}

function makeExecute(state: ReturnType<typeof makeState>) {
  return vi.fn(async (sql: string, params: any[] = []) => {
    const s = String(sql).replace(/\s+/g, " ").trim();

    // review() reads the raiser's own hand-typed splits back before deciding whether to apply
    // them or fall through to resyncLineAllocations. Missing this made every "hand-typed splits"
    // path silently see an empty array — indistinguishable from "no splits were given" and the
    // exact reason this suite's failures were mysterious the first time round.
    if (/SELECT cost_centre_id, quantity FROM finance_budget_topup_request_split/i.test(s)) {
      const [topupRequestId] = params;
      const list = state.splits.get(topupRequestId) ?? [];
      return [list.map((row) => ({ cost_centre_id: row.cost_centre_id, quantity: row.quantity })), []];
    }
    if (/INSERT INTO finance_budget_topup_request_split/i.test(s)) {
      const [, id, ccId, amount, quantity] = params;
      const list = state.splits.get(id) ?? [];
      list.push({ cost_centre_id: String(ccId), amount: Number(amount), quantity: Number(quantity) });
      state.splits.set(id, list);
      return [[], []];
    }
    if (/SELECT t\.\*, h\.period_code/i.test(s)) {
      const [id] = params;
      const req = state.requests.get(id);
      if (!req) return [[], []];
      const header = state.headers.get(req.budget_id)!;
      return [[{ ...req, period_code: header.period_code }], []];
    }
    if (/FROM finance_budget_topup_request t/i.test(s) && /LEFT JOIN finance_budget_line l/i.test(s)) {
      const [id] = params;
      return [state.requests.has(id) ? [{ ...state.requests.get(id) }] : [], []];
    }
    if (/INSERT INTO finance_budget_topup_request\b/i.test(s)) {
      if (s.includes("is_new_line, head, sub_head, unit, unit_rate, allocation_driver")) {
        const [id, budgetId, requestedBy, requestedAmount, requestedQuantity, reason, head, subHead, unit, unitRate, allocationDriver] = params;
        state.requests.set(id, {
          id, budget_line_id: null, budget_id: budgetId, requested_by: requestedBy,
          requested_amount: Number(requestedAmount), requested_quantity: Number(requestedQuantity),
          reason, status: "submitted", is_new_line: 1, is_direct: 0,
          head, sub_head: subHead, unit, unit_rate: Number(unitRate), allocation_driver: allocationDriver,
          branch_head_reviewed_by: null, finance_head_reviewed_by: null, applied_at: null,
        });
      } else if (s.includes("allocation_driver)")) {
        const [id, budgetLineId, budgetId, requestedBy, requestedAmount, requestedQuantity, reason, allocationDriver] = params;
        state.requests.set(id, {
          id, budget_line_id: budgetLineId, budget_id: budgetId, requested_by: requestedBy,
          requested_amount: Number(requestedAmount), requested_quantity: Number(requestedQuantity),
          reason, status: "submitted", is_new_line: 0, is_direct: 0,
          head: null, sub_head: null, unit: null, unit_rate: null, allocation_driver: allocationDriver,
          branch_head_reviewed_by: null, finance_head_reviewed_by: null, applied_at: null,
        });
      }
      return [[], []];
    }
    if (/UPDATE finance_budget_topup_request\b/i.test(s)) {
      if (/status = 'branch_head_approved'/i.test(s)) {
        const [actorId, , id] = params;
        const req = state.requests.get(id);
        if (req) { req.status = "branch_head_approved"; req.branch_head_reviewed_by = actorId; }
      } else if (/status = 'applied', applied_at = NOW\(\)/i.test(s)) {
        const [actorId, , id] = params;
        const req = state.requests.get(id);
        if (req) { req.status = "applied"; req.finance_head_reviewed_by = actorId; req.applied_at = "now"; }
      }
      return [[], []];
    }

    // computeLineAllocations' cost-centre and driver reads.
    // listActiveCostCentres' real query prefixes every column with "ccm." (ccm.branch_id,
    // ccm.active_status), so a bare "branch_id = ? AND active_status = 1" substring never matches
    // it — checked separately below for exactly that reason.
    if (/FROM cost_centre_master/i.test(s) && /branch_id = \?/i.test(s) && /active_status = 1/i.test(s) && !/WHERE\s+\w*\.?id = \?/i.test(s)) {
      const [branchId] = params;
      const list = [...state.costCentres.values()].filter((cc) => cc.branch_id === branchId);
      return [list.map((cc) => ({ id: cc.id, cost_centre_code: cc.id, cost_centre_name: cc.id, resolved_process_name: null })), []];
    }
    if (/FROM cost_centre_master WHERE id = \? AND active_status = 1/i.test(s)) {
      const [id] = params;
      const cc = state.costCentres.get(id);
      return [cc ? [cc] : [], []];
    }
    if (/FROM finance_cost_centre_monthly_driver/i.test(s)) {
      const [branchId, period] = params;
      const rows: any[] = [];
      for (const [key, headcount] of state.drivers.entries()) {
        const [b, p, cc] = key.split("|");
        if (b === branchId && p === period) rows.push({ cost_centre_id: cc, planned_headcount: headcount });
      }
      return [rows, []];
    }
    if (/AS live_headcount/i.test(s)) {
      return [[], []]; // no live-staff fallback needed for these tests
    }

    // finance_budget_line_allocation
    if (/DELETE FROM finance_budget_line_allocation WHERE budget_line_id = \?/i.test(s)) {
      const [lineId] = params;
      state.allocations = state.allocations.filter((r) => r.budget_line_id !== lineId);
      return [[], []];
    }
    if (/INSERT INTO finance_budget_line_allocation\s*\n?\s*\(id, budget_line_id, cost_centre_id, driver_value/i.test(s)) {
      // resyncLineAllocations' multi-row INSERT via replaceLineAllocations — 13 BOUND columns per
      // row (id, budget_line_id, cost_centre_id, driver_value, allocation_percentage,
      // planned_unit, base_amount, tax_amount, gross_amount, pnl_cost_amount,
      // rounding_adjustment, created_by, updated_by); entry_source is the literal 'calculated'
      // baked into the SQL, not a 14th placeholder. Getting this wrong shifts every row after the
      // first by one param and was silently corrupting all but the first row's fields.
      const cols = 13;
      for (let i = 0; i < params.length; i += cols) {
        const [id, budgetLineId, costCentreId, , , , baseAmount, taxAmount, grossAmount, pnlCostAmount] = params.slice(i, i + cols);
        state.allocations.push({
          id, budget_line_id: budgetLineId, cost_centre_id: costCentreId,
          base_amount: Number(baseAmount), tax_amount: Number(taxAmount),
          gross_amount: Number(grossAmount), pnl_cost_amount: Number(pnlCostAmount),
          allocation_percentage: 0,
        });
      }
      return [[], []];
    }
    if (/INSERT INTO finance_budget_line_allocation/i.test(s)) {
      // The single-row manual-split INSERT (upsertAllocationSplits / applyTopupAsNewLine).
      const [id, budgetLineId, costCentreId, plannedUnit, baseAmount, taxAmount, grossAmount, pnlCostAmount] = params;
      const existing = state.allocations.find((r) => r.budget_line_id === budgetLineId && r.cost_centre_id === costCentreId);
      if (existing) {
        existing.base_amount += Number(baseAmount);
        existing.tax_amount += Number(taxAmount);
        existing.gross_amount += Number(grossAmount);
        existing.pnl_cost_amount += Number(pnlCostAmount);
      } else {
        state.allocations.push({
          id, budget_line_id: budgetLineId, cost_centre_id: costCentreId,
          base_amount: Number(baseAmount), tax_amount: Number(taxAmount),
          gross_amount: Number(grossAmount), pnl_cost_amount: Number(pnlCostAmount), allocation_percentage: 0,
        });
      }
      return [[], []];
    }
    if (/SELECT cost_centre_id, allocation_percentage\s*\n?\s*FROM finance_budget_line_allocation/i.test(s)) {
      const [lineId] = params;
      return [state.allocations.filter((r) => r.budget_line_id === lineId).map((r) => ({ cost_centre_id: r.cost_centre_id, allocation_percentage: r.allocation_percentage })), []];
    }
    if (/SELECT id, gross_amount FROM finance_budget_line_allocation WHERE budget_line_id = \?/i.test(s)) {
      const [lineId] = params;
      return [state.allocations.filter((r) => r.budget_line_id === lineId).map((r) => ({ id: r.id, gross_amount: r.gross_amount })), []];
    }
    if (/UPDATE finance_budget_line_allocation SET allocation_percentage/i.test(s)) return [[], []];

    // finance_budget_line reads.
    if (/SELECT l\.id, l\.planning_level, l\.allocation_driver/i.test(s)) {
      const [id] = params;
      const line = state.lines.get(id);
      if (!line) return [[], []];
      const header = state.headers.get(line.budget_id)!;
      return [[{
        id: line.id, planning_level: line.planning_level, allocation_driver: line.allocation_driver,
        base_amount: line.base_amount, tax_amount: line.tax_amount, gross_amount: line.gross_amount,
        pnl_cost_amount: line.pnl_cost_amount, branch_id: header.branch_id, period_code: header.period_code,
      }], []];
    }
    if (/SELECT l\.id, l\.budget_id, l\.unit_rate,/i.test(s) && /budget_status/i.test(s)) {
      const [id] = params;
      const line = state.lines.get(id);
      if (!line) return [[], []];
      const header = state.headers.get(line.budget_id)!;
      return [[{
        id: line.id, budget_id: line.budget_id, unit_rate: line.unit_rate,
        planning_level: line.planning_level, allocation_driver: line.allocation_driver ?? null,
        budget_status: header.status, branch_id: header.branch_id, period_code: header.period_code,
      }], []];
    }
    if (/SELECT l\.\*, h\.status AS budget_status/i.test(s)) {
      const [id] = params;
      const line = state.lines.get(id);
      if (!line) return [[], []];
      const header = state.headers.get(line.budget_id)!;
      return [[{ ...line, budget_status: header.status, branch_id: header.branch_id, period_code: header.period_code }], []];
    }
    if (/FROM finance_budget_line WHERE id = \?/i.test(s)) {
      const [id] = params;
      const line = state.lines.get(id);
      return [line ? [line] : [], []];
    }
    if (/UPDATE finance_budget_line SET allocation_driver = \?/i.test(s)) {
      const [driver, id] = params;
      const line = state.lines.get(id);
      if (line) line.allocation_driver = driver;
      return [[], []];
    }
    if (/UPDATE finance_budget_line\s+SET quantity = \?/i.test(s)) {
      const [quantity, baseAmount, taxAmount, grossAmount, recoverableTaxAmount, pnlCostAmount, cgstAmount, sgstAmount, igstAmount, id] = params;
      const line = state.lines.get(id);
      if (line) Object.assign(line, {
        quantity: Number(quantity), base_amount: Number(baseAmount), tax_amount: Number(taxAmount),
        gross_amount: Number(grossAmount), recoverable_tax_amount: Number(recoverableTaxAmount),
        pnl_cost_amount: Number(pnlCostAmount), cgst_amount: Number(cgstAmount),
        sgst_amount: Number(sgstAmount), igst_amount: Number(igstAmount),
      });
      return [[], []];
    }
    if (/INSERT INTO finance_budget_line\b/i.test(s)) {
      const [id, budgetId, head, subHead, itemName, quantity, unit, unitRate,
        cgstAmount, sgstAmount, igstAmount, baseAmount, taxAmount,
        grossAmount, recoverableTaxAmount, pnlCostAmount, allocationDriver] = params;
      state.lines.set(id, {
        id, budget_id: budgetId, cost_centre_id: null, planning_level: "branch",
        head, sub_head: subHead, item_name: itemName, quantity: Number(quantity), unit, unit_rate: Number(unitRate),
        tax_treatment: "exclusive", gst_rate: 0, gst_type: "cgst_sgst", recoverable_tax_pct: 100,
        base_amount: Number(baseAmount), tax_amount: Number(taxAmount), gross_amount: Number(grossAmount),
        recoverable_tax_amount: Number(recoverableTaxAmount), pnl_cost_amount: Number(pnlCostAmount),
        cgst_amount: Number(cgstAmount), sgst_amount: Number(sgstAmount), igst_amount: Number(igstAmount),
        allocation_driver: allocationDriver,
      });
      return [[], []];
    }

    if (/SELECT id, status, branch_id, period_code FROM finance_budget_header WHERE id = \?/i.test(s)) {
      const [id] = params;
      const h = state.headers.get(id);
      return [h ? [{ id: h.id, status: h.status, branch_id: h.branch_id, period_code: h.period_code }] : [], []];
    }
    if (/UPDATE finance_budget_header h\s+SET h\.gross_budget_amount/i.test(s)) {
      const [budgetId] = params;
      let gross = 0, pnl = 0;
      for (const line of state.lines.values()) if (line.budget_id === budgetId) { gross += line.gross_amount; pnl += line.pnl_cost_amount; }
      const h = state.headers.get(budgetId);
      if (h) { h.gross_budget_amount = gross; h.pnl_budget_amount = pnl; }
      return [[], []];
    }

    return [[], []];
  });
}

function seed() {
  const state = makeState();
  state.costCentres.set("cc-1", { id: "cc-1", branch_id: "branch-A", active_status: 1 });
  state.costCentres.set("cc-2", { id: "cc-2", branch_id: "branch-A", active_status: 1 });
  state.headers.set("budget-1", { id: "budget-1", status: "active", branch_id: "branch-A", period_code: "2026-08", gross_budget_amount: 0, pnl_budget_amount: 0 });
  return state;
}

const CONN = { execute, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  getConnection.mockResolvedValue(CONN);
});

describe("Top-up to an EXISTING branch-level line — no hand-typed splits", () => {
  it("divides the new total by the line's own driver instead of leaving the split stale", async () => {
    const state = seed();
    state.drivers.set(keyDriver("branch-A", "2026-08", "cc-1"), 30);
    state.drivers.set(keyDriver("branch-A", "2026-08", "cc-2"), 10);
    state.lines.set("line-1", {
      id: "line-1", budget_id: "budget-1", cost_centre_id: null, planning_level: "branch",
      head: "Office Rent", sub_head: "Office Rent", item_name: "Office Rent",
      // unit_rate 1 means quantity IS the amount, matching how the real "amount" unit lines work
      // (saveAllocations' unbudgeted branch does the same). quantity must equal gross_amount for
      // that convention to hold, or a top-up's recomputed total (quantity + additionalQuantity)
      // and its recomputed gross_amount stop agreeing with each other.
      quantity: 40000, unit: "Amount", unit_rate: 1,
      tax_treatment: "exclusive", gst_rate: 0, gst_type: "cgst_sgst", recoverable_tax_pct: 100,
      base_amount: 40000, tax_amount: 0, gross_amount: 40000, recoverable_tax_amount: 0, pnl_cost_amount: 40000,
      cgst_amount: 0, sgst_amount: 0, igst_amount: 0, allocation_driver: "total_manpower",
    });
    execute.mockImplementation(makeExecute(state));

    const created = await budgetTopupService.create(
      {
        budgetLineId: "line-1", requestedAmount: 20000, requestedQuantity: 20000, reason: "Rent increase",
        costCentreSplits: [], // no hand-typed splits — the whole point of this test
      },
      "u-raiser", "branch_admin"
    );
    await budgetTopupService.review(created.id, "approve", "u-bh", "branch_head");
    await budgetTopupService.review(created.id, "approve", "u-fh", "finance_head");

    const rows = state.allocations.filter((r) => r.budget_line_id === "line-1");
    expect(rows).toHaveLength(2);
    const byId = Object.fromEntries(rows.map((r) => [r.cost_centre_id, r]));
    // 30:10 headcount over the NEW total (40,000 + 20,000 = 60,000), not the pre-top-up 40,000.
    expect(byId["cc-1"].gross_amount).toBeCloseTo(45000, 0);
    expect(byId["cc-2"].gross_amount).toBeCloseTo(15000, 0);
    expect(byId["cc-1"].gross_amount + byId["cc-2"].gross_amount).toBeCloseTo(60000, 0);
  });

  it("hand-typed splits still win over the line's driver", async () => {
    const state = seed();
    state.drivers.set(keyDriver("branch-A", "2026-08", "cc-1"), 30);
    state.drivers.set(keyDriver("branch-A", "2026-08", "cc-2"), 10);
    state.lines.set("line-1", {
      id: "line-1", budget_id: "budget-1", cost_centre_id: null, planning_level: "branch",
      head: "Office Rent", sub_head: "Office Rent", item_name: "Office Rent",
      // unit_rate 1 means quantity IS the amount, matching how the real "amount" unit lines work
      // (saveAllocations' unbudgeted branch does the same). quantity must equal gross_amount for
      // that convention to hold, or a top-up's recomputed total (quantity + additionalQuantity)
      // and its recomputed gross_amount stop agreeing with each other.
      quantity: 40000, unit: "Amount", unit_rate: 1,
      tax_treatment: "exclusive", gst_rate: 0, gst_type: "cgst_sgst", recoverable_tax_pct: 100,
      base_amount: 40000, tax_amount: 0, gross_amount: 40000, recoverable_tax_amount: 0, pnl_cost_amount: 40000,
      cgst_amount: 0, sgst_amount: 0, igst_amount: 0, allocation_driver: "total_manpower",
    });
    execute.mockImplementation(makeExecute(state));

    const created = await budgetTopupService.create(
      {
        budgetLineId: "line-1", requestedAmount: 20000, requestedQuantity: 20000, reason: "Rent increase",
        // 100% to cc-2 — the opposite of what the 30:10 driver would give it.
        costCentreSplits: [{ costCentreId: "cc-2", amount: 20000, quantity: 20000 }],
      },
      "u-raiser", "branch_admin"
    );
    await budgetTopupService.review(created.id, "approve", "u-bh", "branch_head");
    await budgetTopupService.review(created.id, "approve", "u-fh", "finance_head");

    const rows = state.allocations.filter((r) => r.budget_line_id === "line-1");
    const byId = Object.fromEntries(rows.map((r) => [r.cost_centre_id, r]));
    expect(byId["cc-2"].gross_amount).toBeCloseTo(20000, 0);
    expect(byId["cc-1"]).toBeUndefined();
  });

  it("a missing driver reports rather than blocking the top-up from being applied", async () => {
    const state = seed();
    // No drivers recorded at all for either cost centre.
    state.lines.set("line-1", {
      id: "line-1", budget_id: "budget-1", cost_centre_id: null, planning_level: "branch",
      head: "Office Rent", sub_head: "Office Rent", item_name: "Office Rent",
      // unit_rate 1 means quantity IS the amount, matching how the real "amount" unit lines work
      // (saveAllocations' unbudgeted branch does the same). quantity must equal gross_amount for
      // that convention to hold, or a top-up's recomputed total (quantity + additionalQuantity)
      // and its recomputed gross_amount stop agreeing with each other.
      quantity: 40000, unit: "Amount", unit_rate: 1,
      tax_treatment: "exclusive", gst_rate: 0, gst_type: "cgst_sgst", recoverable_tax_pct: 100,
      base_amount: 40000, tax_amount: 0, gross_amount: 40000, recoverable_tax_amount: 0, pnl_cost_amount: 40000,
      cgst_amount: 0, sgst_amount: 0, igst_amount: 0, allocation_driver: "total_manpower",
    });
    execute.mockImplementation(makeExecute(state));

    const created = await budgetTopupService.create(
      { budgetLineId: "line-1", requestedAmount: 20000, requestedQuantity: 20000, reason: "Rent increase", costCentreSplits: [] },
      "u-raiser", "branch_admin"
    );
    await budgetTopupService.review(created.id, "approve", "u-bh", "branch_head");
    // The approval itself must not throw — a data gap on ONE line's driver must not block Finance
    // from applying an approved top-up.
    await expect(
      budgetTopupService.review(created.id, "approve", "u-fh", "finance_head")
    ).resolves.toBeTruthy();

    const line = state.lines.get("line-1")!;
    expect(line.gross_amount).toBeCloseTo(60000, 0); // the amount still applied
    expect(state.allocations.filter((r) => r.budget_line_id === "line-1")).toHaveLength(0); // no split invented
  });
});

describe("Top-up creating a NEW head/sub-head — the driver is recorded and used", () => {
  it("stores the chosen allocation_driver on the new line and divides by it", async () => {
    const state = seed();
    state.drivers.set(keyDriver("branch-A", "2026-08", "cc-1"), 3);
    state.drivers.set(keyDriver("branch-A", "2026-08", "cc-2"), 1);
    execute.mockImplementation(makeExecute(state));

    const created = await budgetTopupService.create(
      {
        isNewLine: true, budgetId: "budget-1", head: "Electricity", subHead: "Diesel",
        unit: "Amount", unitRate: 1, allocationDriver: "total_manpower",
        requestedAmount: 8000, requestedQuantity: 8000, reason: "New generator line",
        costCentreSplits: [],
      },
      "u-raiser", "branch_admin"
    );
    await budgetTopupService.review(created.id, "approve", "u-bh", "branch_head");
    await budgetTopupService.review(created.id, "approve", "u-fh", "finance_head");

    const newLineId = [...state.lines.keys()].find((id) => state.lines.get(id)!.head === "Electricity")!;
    expect(state.lines.get(newLineId)!.allocation_driver).toBe("total_manpower");
    const rows = state.allocations.filter((r) => r.budget_line_id === newLineId);
    expect(rows).toHaveLength(2);
    const byId = Object.fromEntries(rows.map((r) => [r.cost_centre_id, r]));
    // 3:1 headcount over 8,000.
    expect(byId["cc-1"].gross_amount).toBeCloseTo(6000, 0);
    expect(byId["cc-2"].gross_amount).toBeCloseTo(2000, 0);
  });

  it("omitting the driver keeps the pre-fix behaviour — a line with no rule, hand-typed splits only", async () => {
    const state = seed();
    execute.mockImplementation(makeExecute(state));

    const created = await budgetTopupService.create(
      {
        isNewLine: true, budgetId: "budget-1", head: "Office Stationery", subHead: "Paper",
        unit: "Amount", unitRate: 1,
        requestedAmount: 5000, requestedQuantity: 5000, reason: "New stationery line",
        costCentreSplits: [{ costCentreId: "cc-1", amount: 5000, quantity: 5000 }],
      },
      "u-raiser", "branch_admin"
    );
    await budgetTopupService.review(created.id, "approve", "u-bh", "branch_head");
    await budgetTopupService.review(created.id, "approve", "u-fh", "finance_head");

    const newLineId = [...state.lines.keys()].find((id) => state.lines.get(id)!.head === "Office Stationery")!;
    expect(state.lines.get(newLineId)!.allocation_driver ?? null).toBeNull();
    const rows = state.allocations.filter((r) => r.budget_line_id === newLineId);
    expect(rows).toHaveLength(1);
    expect(rows[0].cost_centre_id).toBe("cc-1");
  });
});
