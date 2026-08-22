import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateBudgetLine } from "../branch-budget.service.js";

/**
 * Group D: cost-centre splits + brand-new budget-line requests on top of the existing Top-up
 * feature (1061 request entity, 1524 direct-apply).
 *
 * Rather than mocking each SQL statement's return value ad hoc, this file keeps a tiny in-memory
 * table store (finance_budget_line / finance_budget_header / finance_budget_topup_request /
 * finance_budget_topup_request_split / finance_budget_line_allocation / cost_centre_master) and a
 * single execute() implementation that reads/writes it by matching each query's distinctive SQL
 * shape. create()/review()/directApply() all obtain their connection via the SAME `execute` mock
 * (pool and "connection" alike), so effects from one call are visible to the next — needed for
 * the full create() -> review() -> review() flows below, which are exactly how this feature is
 * actually used.
 */

// isPeriodLocked must also be created inside vi.hoisted() — branch-budget.service.ts (imported
// directly below, for calculateBudgetLine) itself imports finance-period-lock.js, so the mock
// factory below is evaluated very early; a plain top-level `const isPeriodLocked = vi.fn()`
// triggers a TDZ ReferenceError under that ordering, exactly the trap vi.mock's own hoisting
// warning describes.
const { execute, query, getConnection, isPeriodLocked } = vi.hoisted(() => ({
  execute: vi.fn(), query: vi.fn(), getConnection: vi.fn(),
  isPeriodLocked: vi.fn(async () => false),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query, getConnection } }));
vi.mock("../finance-period-lock.js", () => ({ isPeriodLocked }));

const { budgetTopupService } = await import("../budget-topup.service.js");

type Line = {
  id: string;
  budget_id: string;
  cost_centre_id: string | null;
  planning_level: string;
  head: string;
  sub_head?: string | null;
  item_name: string;
  quantity: number;
  unit: string;
  unit_rate: number;
  tax_treatment: string;
  gst_rate: number;
  gst_type: string;
  recoverable_tax_pct: number;
  base_amount: number;
  tax_amount: number;
  gross_amount: number;
  recoverable_tax_amount: number;
  pnl_cost_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
};

type Header = {
  id: string;
  status: string;
  branch_id: string;
  period_code: string;
  gross_budget_amount: number;
  pnl_budget_amount: number;
};

type TopupRequest = {
  id: string;
  budget_line_id: string | null;
  budget_id: string;
  requested_by: string;
  requested_amount: number;
  requested_quantity: number;
  reason: string;
  status: string;
  is_new_line: number;
  is_direct: number;
  head: string | null;
  sub_head: string | null;
  unit: string | null;
  unit_rate: number | null;
  branch_head_reviewed_by: string | null;
  finance_head_reviewed_by: string | null;
  applied_at: string | null;
};

type AllocationRow = {
  id: string;
  budget_line_id: string;
  cost_centre_id: string;
  planned_unit: number;
  base_amount: number;
  tax_amount: number;
  gross_amount: number;
  pnl_cost_amount: number;
  allocation_percentage: number;
};

function makeState() {
  return {
    lines: new Map<string, Line>(),
    headers: new Map<string, Header>(),
    requests: new Map<string, TopupRequest>(),
    splits: new Map<string, Array<{ cost_centre_id: string; amount: number; quantity: number }>>(),
    allocations: [] as AllocationRow[],
    costCentres: new Map<string, { id: string; branch_id: string; active_status: number }>(),
  };
}

function makeExecute(state: ReturnType<typeof makeState>) {
  return vi.fn(async (sql: string, params: any[] = []) => {
    const s = String(sql);

    // finance_budget_topup_request_split — checked before the topup_request patterns below,
    // since the table name is a superstring of finance_budget_topup_request.
    if (/INSERT INTO finance_budget_topup_request_split/i.test(s)) {
      const [, topupRequestId, costCentreId, amount, quantity] = params;
      const list = state.splits.get(topupRequestId) ?? [];
      list.push({ cost_centre_id: String(costCentreId), amount: Number(amount), quantity: Number(quantity) });
      state.splits.set(topupRequestId, list);
      return [[], []];
    }
    if (/SELECT cost_centre_id, quantity FROM finance_budget_topup_request_split/i.test(s)) {
      const [topupRequestId] = params;
      const list = state.splits.get(topupRequestId) ?? [];
      return [list.map((row) => ({ cost_centre_id: row.cost_centre_id, quantity: row.quantity })), []];
    }

    // review()'s own request+header fetch, and create()/directApply()'s final this.get(id).
    if (/SELECT t\.\*, h\.period_code/i.test(s)) {
      const [id] = params;
      const request = state.requests.get(id);
      if (!request) return [[], []];
      const header = state.headers.get(request.budget_id)!;
      return [[{ ...request, period_code: header.period_code }], []];
    }
    if (/FROM finance_budget_topup_request t/i.test(s) && /LEFT JOIN finance_budget_line l/i.test(s)) {
      const [id] = params;
      const request = state.requests.get(id);
      return [request ? [{ ...request }] : [], []];
    }

    // finance_budget_topup_request INSERT variants.
    if (/INSERT INTO finance_budget_topup_request\b/i.test(s)) {
      if (s.includes("is_new_line, head, sub_head, unit, unit_rate")) {
        const [id, budgetId, requestedBy, requestedAmount, requestedQuantity, reason, head, subHead, unit, unitRate] = params;
        state.requests.set(id, {
          id, budget_line_id: null, budget_id: budgetId, requested_by: requestedBy,
          requested_amount: Number(requestedAmount), requested_quantity: Number(requestedQuantity),
          reason, status: "submitted", is_new_line: 1, is_direct: 0,
          head, sub_head: subHead, unit, unit_rate: Number(unitRate),
          branch_head_reviewed_by: null, finance_head_reviewed_by: null, applied_at: null,
        });
      } else if (s.includes("is_direct, status,")) {
        const [id, budgetLineId, budgetId, requestedBy, requestedAmount, requestedQuantity, reason] = params;
        state.requests.set(id, {
          id, budget_line_id: budgetLineId, budget_id: budgetId, requested_by: requestedBy,
          requested_amount: Number(requestedAmount), requested_quantity: Number(requestedQuantity),
          reason, status: "applied", is_new_line: 0, is_direct: 1,
          head: null, sub_head: null, unit: null, unit_rate: null,
          branch_head_reviewed_by: requestedBy, finance_head_reviewed_by: requestedBy, applied_at: "now",
        });
      } else {
        const [id, budgetLineId, budgetId, requestedBy, requestedAmount, requestedQuantity, reason] = params;
        state.requests.set(id, {
          id, budget_line_id: budgetLineId, budget_id: budgetId, requested_by: requestedBy,
          requested_amount: Number(requestedAmount), requested_quantity: Number(requestedQuantity),
          reason, status: "submitted", is_new_line: 0, is_direct: 0,
          head: null, sub_head: null, unit: null, unit_rate: null,
          branch_head_reviewed_by: null, finance_head_reviewed_by: null, applied_at: null,
        });
      }
      return [[], []];
    }
    if (/UPDATE finance_budget_topup_request\b/i.test(s)) {
      if (/status = 'branch_head_approved'/i.test(s)) {
        const [actorId, , id] = params;
        const request = state.requests.get(id);
        if (request) { request.status = "branch_head_approved"; request.branch_head_reviewed_by = actorId; }
      } else if (/status = 'applied', applied_at = NOW\(\)/i.test(s)) {
        const [actorId, , id] = params;
        const request = state.requests.get(id);
        if (request) { request.status = "applied"; request.finance_head_reviewed_by = actorId; request.applied_at = "now"; }
      } else if (/status = 'rejected'/i.test(s)) {
        const id = params[params.length - 1];
        const request = state.requests.get(id);
        if (request) request.status = "rejected";
      }
      return [[], []];
    }

    // cost_centre_master
    if (/FROM cost_centre_master WHERE id = \? AND active_status = 1/i.test(s)) {
      const [id] = params;
      const cc = state.costCentres.get(id);
      return [cc ? [cc] : [], []];
    }

    // finance_budget_line_allocation — checked before finance_budget_line (superstring).
    if (/INSERT INTO finance_budget_line_allocation/i.test(s)) {
      const [id, budgetLineId, costCentreId, plannedUnit, baseAmount, taxAmount, grossAmount, pnlCostAmount] = params;
      const existing = state.allocations.find(
        (row) => row.budget_line_id === budgetLineId && row.cost_centre_id === costCentreId
      );
      if (existing) {
        existing.planned_unit += Number(plannedUnit);
        existing.base_amount += Number(baseAmount);
        existing.tax_amount += Number(taxAmount);
        existing.gross_amount += Number(grossAmount);
        existing.pnl_cost_amount += Number(pnlCostAmount);
      } else {
        state.allocations.push({
          id, budget_line_id: budgetLineId, cost_centre_id: costCentreId,
          planned_unit: Number(plannedUnit), base_amount: Number(baseAmount), tax_amount: Number(taxAmount),
          gross_amount: Number(grossAmount), pnl_cost_amount: Number(pnlCostAmount), allocation_percentage: 0,
        });
      }
      return [[], []];
    }
    if (/SELECT id, gross_amount FROM finance_budget_line_allocation WHERE budget_line_id = \?/i.test(s)) {
      const [budgetLineId] = params;
      return [
        state.allocations
          .filter((row) => row.budget_line_id === budgetLineId)
          .map((row) => ({ id: row.id, gross_amount: row.gross_amount })),
        [],
      ];
    }
    if (/UPDATE finance_budget_line_allocation SET allocation_percentage = allocation_percentage \+ \?/i.test(s)) {
      const [delta, id] = params;
      const row = state.allocations.find((r) => r.id === id);
      if (row) row.allocation_percentage += Number(delta);
      return [[], []];
    }
    if (/UPDATE finance_budget_line_allocation SET allocation_percentage = \?/i.test(s)) {
      const [percentage, id] = params;
      const row = state.allocations.find((r) => r.id === id);
      if (row) row.allocation_percentage = Number(percentage);
      return [[], []];
    }

    // finance_budget_line — create()/directApply() line+header fetch (aliased, joined).
    if (/SELECT l\.id, l\.budget_id, l\.unit_rate, h\.status AS budget_status, h\.branch_id, h\.period_code/i.test(s)) {
      const [id] = params;
      const line = state.lines.get(id);
      if (!line) return [[], []];
      const header = state.headers.get(line.budget_id)!;
      return [[{
        id: line.id, budget_id: line.budget_id, unit_rate: line.unit_rate,
        budget_status: header.status, branch_id: header.branch_id, period_code: header.period_code,
      }], []];
    }
    // lockActiveBudgetLine's fetch (l.*).
    if (/SELECT l\.\*, h\.status AS budget_status, h\.branch_id, h\.period_code/i.test(s)) {
      const [id] = params;
      const line = state.lines.get(id);
      if (!line) return [[], []];
      const header = state.headers.get(line.budget_id)!;
      return [[{ ...line, budget_status: header.status, branch_id: header.branch_id, period_code: header.period_code }], []];
    }
    // applyTopupToLine's own fetch (no alias, no join).
    if (/FROM finance_budget_line WHERE id = \?/i.test(s)) {
      const [id] = params;
      const line = state.lines.get(id);
      return [line ? [line] : [], []];
    }
    // applyTopupToLine's recompute UPDATE.
    if (/UPDATE finance_budget_line\s+SET quantity = \?/i.test(s)) {
      const [quantity, baseAmount, taxAmount, grossAmount, recoverableTaxAmount, pnlCostAmount, cgstAmount, sgstAmount, igstAmount, id] = params;
      const line = state.lines.get(id);
      if (line) {
        Object.assign(line, {
          quantity: Number(quantity), base_amount: Number(baseAmount), tax_amount: Number(taxAmount),
          gross_amount: Number(grossAmount), recoverable_tax_amount: Number(recoverableTaxAmount),
          pnl_cost_amount: Number(pnlCostAmount), cgst_amount: Number(cgstAmount),
          sgst_amount: Number(sgstAmount), igst_amount: Number(igstAmount),
        });
      }
      return [[], []];
    }
    // applyTopupAsNewLine's brand-new line INSERT.
    if (/INSERT INTO finance_budget_line\b/i.test(s)) {
      const [id, budgetId, head, subHead, itemName, quantity, unit, unitRate,
        cgstAmount, sgstAmount, igstAmount, baseAmount, taxAmount,
        grossAmount, recoverableTaxAmount, pnlCostAmount] = params;
      state.lines.set(id, {
        id, budget_id: budgetId, cost_centre_id: null, planning_level: "branch",
        head, sub_head: subHead, item_name: itemName, quantity: Number(quantity), unit, unit_rate: Number(unitRate),
        tax_treatment: "exclusive", gst_rate: 0, gst_type: "cgst_sgst", recoverable_tax_pct: 100,
        base_amount: Number(baseAmount), tax_amount: Number(taxAmount), gross_amount: Number(grossAmount),
        recoverable_tax_amount: Number(recoverableTaxAmount), pnl_cost_amount: Number(pnlCostAmount),
        cgst_amount: Number(cgstAmount), sgst_amount: Number(sgstAmount), igst_amount: Number(igstAmount),
      });
      return [[], []];
    }

    // finance_budget_header — create()'s new-line header fetch, and resummarizeHeaderTotals.
    if (/SELECT id, status, branch_id, period_code FROM finance_budget_header WHERE id = \?/i.test(s)) {
      const [id] = params;
      const header = state.headers.get(id);
      return [header ? [{ id: header.id, status: header.status, branch_id: header.branch_id, period_code: header.period_code }] : [], []];
    }
    if (/UPDATE finance_budget_header h\s+SET h\.gross_budget_amount/i.test(s)) {
      const [budgetId] = params;
      let gross = 0;
      let pnl = 0;
      for (const line of state.lines.values()) {
        if (line.budget_id === budgetId) { gross += line.gross_amount; pnl += line.pnl_cost_amount; }
      }
      const header = state.headers.get(budgetId);
      if (header) { header.gross_budget_amount = gross; header.pnl_budget_amount = pnl; }
      return [[], []];
    }

    // Everything else this file doesn't need to inspect (finance_approval_event,
    // finance_budget_approval_log, etc.) — a harmless no-op read/write.
    return [[], []];
  });
}

function seed() {
  const state = makeState();

  state.costCentres.set("cc-1", { id: "cc-1", branch_id: "branch-A", active_status: 1 });
  state.costCentres.set("cc-2", { id: "cc-2", branch_id: "branch-A", active_status: 1 });

  // Existing-line fixture: 10 units @ Rs 1,000, 18% exclusive GST, 100% recoverable.
  const lineAmounts = calculateBudgetLine({
    head: "Communication & Connectivity", itemName: "Company Owned Data",
    quantity: 10, unit: "Nos", unitRate: 1000,
    taxTreatment: "exclusive", gstRate: 18, gstType: "cgst_sgst", recoverableTaxPct: 100,
    justification: "",
  });
  state.lines.set("line-1", {
    id: "line-1", budget_id: "budget-1", cost_centre_id: "cc-1", planning_level: "cost_centre",
    head: "Communication & Connectivity", sub_head: "Data", item_name: "Company Owned Data",
    quantity: 10, unit: "Nos", unit_rate: 1000,
    tax_treatment: "exclusive", gst_rate: 18, gst_type: "cgst_sgst", recoverable_tax_pct: 100,
    base_amount: lineAmounts.baseAmount, tax_amount: lineAmounts.taxAmount, gross_amount: lineAmounts.grossAmount,
    recoverable_tax_amount: lineAmounts.recoverableTaxAmount, pnl_cost_amount: lineAmounts.pnlCostAmount,
    cgst_amount: lineAmounts.cgstAmount, sgst_amount: lineAmounts.sgstAmount, igst_amount: lineAmounts.igstAmount,
  });
  state.headers.set("budget-1", {
    id: "budget-1", status: "active", branch_id: "branch-A", period_code: "2026-08",
    gross_budget_amount: lineAmounts.grossAmount, pnl_budget_amount: lineAmounts.pnlCostAmount,
  });

  // New-line fixture: a budget with no lines yet.
  state.headers.set("budget-2", {
    id: "budget-2", status: "active", branch_id: "branch-A", period_code: "2026-08",
    gross_budget_amount: 0, pnl_budget_amount: 0,
  });

  // Direct-apply fixture: a second existing line, non_gst (the shape live in production today).
  const line3Amounts = calculateBudgetLine({
    head: "Office Supplies", itemName: "Stationery", quantity: 20, unit: "Nos", unitRate: 500,
    taxTreatment: "non_gst", gstRate: 0, gstType: "none", recoverableTaxPct: 0, justification: "",
  });
  state.lines.set("line-3", {
    id: "line-3", budget_id: "budget-3", cost_centre_id: "cc-1", planning_level: "cost_centre",
    head: "Office Supplies", sub_head: "Stationery", item_name: "Stationery",
    quantity: 20, unit: "Nos", unit_rate: 500,
    tax_treatment: "non_gst", gst_rate: 0, gst_type: "none", recoverable_tax_pct: 0,
    base_amount: line3Amounts.baseAmount, tax_amount: line3Amounts.taxAmount, gross_amount: line3Amounts.grossAmount,
    recoverable_tax_amount: line3Amounts.recoverableTaxAmount, pnl_cost_amount: line3Amounts.pnlCostAmount,
    cgst_amount: line3Amounts.cgstAmount, sgst_amount: line3Amounts.sgstAmount, igst_amount: line3Amounts.igstAmount,
  });
  state.headers.set("budget-3", {
    id: "budget-3", status: "active", branch_id: "branch-A", period_code: "2026-08",
    gross_budget_amount: line3Amounts.grossAmount, pnl_budget_amount: line3Amounts.pnlCostAmount,
  });

  return state;
}

let state: ReturnType<typeof makeState>;

beforeEach(() => {
  execute.mockReset();
  query.mockReset();
  getConnection.mockReset();
  isPeriodLocked.mockReset().mockResolvedValue(false);

  state = seed();
  const exec = makeExecute(state);
  // Same mock instance backs the pool (db.execute) and every db.getConnection() connection, so a
  // write through one is visible to a read through the other — exactly like a real pool/txn would
  // behave from this test's point of view.
  execute.mockImplementation(exec as any);
  query.mockResolvedValue([[], []]);
  getConnection.mockResolvedValue({
    execute,
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(() => {}),
  });
});

describe("create() validates cost-centre splits", () => {
  it("rejects when split amounts don't sum to the requested amount", async () => {
    await expect(
      budgetTopupService.create(
        {
          budgetLineId: "line-1",
          requestedAmount: 5000,
          requestedQuantity: 5,
          reason: "Headcount added",
          costCentreSplits: [
            { costCentreId: "cc-1", amount: 3000, quantity: 3 },
            { costCentreId: "cc-2", amount: 1000, quantity: 1 },
          ],
        } as any,
        "user-raiser",
        "branch_admin"
      )
    ).rejects.toMatchObject({ code: "TOPUP_SPLIT_TOTAL_AMOUNT_MISMATCH" });
  });

  it("rejects when one split's own quantity * unitRate disagrees with its own amount", async () => {
    await expect(
      budgetTopupService.create(
        {
          budgetLineId: "line-1",
          requestedAmount: 5000,
          requestedQuantity: 5,
          reason: "Headcount added",
          costCentreSplits: [
            { costCentreId: "cc-1", amount: 3000, quantity: 2 }, // 2 x 1000 = 2000, not 3000
            { costCentreId: "cc-2", amount: 2000, quantity: 2 },
          ],
        } as any,
        "user-raiser",
        "branch_admin"
      )
    ).rejects.toMatchObject({ code: "TOPUP_SPLIT_AMOUNT_QUANTITY_MISMATCH" });
  });
});

describe("create() with isNewLine", () => {
  it("rejects when isNewLine is true but no budgetId is given", async () => {
    await expect(
      budgetTopupService.create(
        {
          isNewLine: true,
          head: "New Head", subHead: "New SubHead", unit: "Nos", unitRate: 2000,
          requestedAmount: 10000, requestedQuantity: 5,
          reason: "Brand-new line",
          costCentreSplits: [{ costCentreId: "cc-1", amount: 10000, quantity: 5 }],
        } as any,
        "user-raiser",
        "branch_admin"
      )
    ).rejects.toMatchObject({ code: "TOPUP_BUDGET_ID_REQUIRED" });
  });

  it("rejects a new-line request against a budget that is not active", async () => {
    state.headers.get("budget-2")!.status = "draft";
    await expect(
      budgetTopupService.create(
        {
          isNewLine: true,
          budgetId: "budget-2",
          head: "New Head", subHead: "New SubHead", unit: "Nos", unitRate: 2000,
          requestedAmount: 10000, requestedQuantity: 5,
          reason: "Brand-new line",
          costCentreSplits: [{ costCentreId: "cc-1", amount: 10000, quantity: 5 }],
        } as any,
        "user-raiser",
        "branch_admin"
      )
    ).rejects.toMatchObject({ code: "BUDGET_NOT_ACTIVE" });
  });
});

describe("full flow: existing-line top-up with a 2-way cost-centre split", () => {
  it("applies the increase and writes/renormalizes the allocation rows", async () => {
    const created = await budgetTopupService.create(
      {
        budgetLineId: "line-1",
        requestedAmount: 5000,
        requestedQuantity: 5,
        reason: "Headcount added",
        costCentreSplits: [
          { costCentreId: "cc-1", amount: 3000, quantity: 3 },
          { costCentreId: "cc-2", amount: 2000, quantity: 2 },
        ],
      } as any,
      "user-raiser",
      "branch_admin"
    );
    const requestId = (created as any).id;
    expect(requestId).toBeTruthy();

    await budgetTopupService.review(requestId, "approve", "user-branch-head", "branch_head");
    await budgetTopupService.review(requestId, "approve", "user-finance-head", "finance_head");

    const line = state.lines.get("line-1")!;
    const expectedLine = calculateBudgetLine({
      head: line.head, itemName: line.item_name, quantity: 15, unit: line.unit, unitRate: line.unit_rate,
      taxTreatment: line.tax_treatment as any, gstRate: line.gst_rate, gstType: line.gst_type as any,
      recoverableTaxPct: line.recoverable_tax_pct, justification: "",
    });
    expect(line.quantity).toBe(15);
    expect(line.gross_amount).toBe(expectedLine.grossAmount);
    expect(line.pnl_cost_amount).toBe(expectedLine.pnlCostAmount);

    const allocations = state.allocations.filter((row) => row.budget_line_id === "line-1");
    expect(allocations).toHaveLength(2);
    const cc1 = allocations.find((row) => row.cost_centre_id === "cc-1")!;
    const cc2 = allocations.find((row) => row.cost_centre_id === "cc-2")!;
    const expectedCc1 = calculateBudgetLine({
      head: line.head, itemName: line.item_name, quantity: 3, unit: line.unit, unitRate: 1000,
      taxTreatment: "exclusive", gstRate: 18, gstType: "cgst_sgst", recoverableTaxPct: 100, justification: "",
    });
    const expectedCc2 = calculateBudgetLine({
      head: line.head, itemName: line.item_name, quantity: 2, unit: line.unit, unitRate: 1000,
      taxTreatment: "exclusive", gstRate: 18, gstType: "cgst_sgst", recoverableTaxPct: 100, justification: "",
    });
    expect(cc1.gross_amount).toBe(expectedCc1.grossAmount);
    expect(cc2.gross_amount).toBe(expectedCc2.grossAmount);

    // allocation_percentage sums to exactly 100 across ALL rows for the line, not just the 2
    // just touched — there were none pre-existing here, so "all" is these same 2.
    const totalPercentage = allocations.reduce((sum, row) => sum + row.allocation_percentage, 0);
    expect(Math.abs(totalPercentage - 100)).toBeLessThan(0.000001);
  });
});

describe("full flow: brand-new budget-line request with a 2-way cost-centre split", () => {
  it("creates the line, splits it across cost centres, and rolls the header totals up", async () => {
    const created = await budgetTopupService.create(
      {
        isNewLine: true,
        budgetId: "budget-2",
        head: "New Head", subHead: "New SubHead", unit: "Nos", unitRate: 2000,
        requestedAmount: 10000, requestedQuantity: 5,
        reason: "Nothing budgeted for this yet",
        costCentreSplits: [
          { costCentreId: "cc-1", amount: 6000, quantity: 3 },
          { costCentreId: "cc-2", amount: 4000, quantity: 2 },
        ],
      } as any,
      "user-raiser",
      "branch_admin"
    );
    const requestId = (created as any).id;

    await budgetTopupService.review(requestId, "approve", "user-branch-head", "branch_head");
    await budgetTopupService.review(requestId, "approve", "user-finance-head", "finance_head");

    const newLines = [...state.lines.values()].filter((line) => line.budget_id === "budget-2");
    expect(newLines).toHaveLength(1);
    const newLine = newLines[0];
    expect(newLine.planning_level).toBe("branch");
    expect(newLine.cost_centre_id).toBeNull();
    expect(newLine.head).toBe("New Head");
    expect(newLine.unit_rate).toBe(2000);
    expect(newLine.quantity).toBe(5);
    const expectedNewLine = calculateBudgetLine({
      head: "New Head", itemName: "New Head", quantity: 5, unit: "Nos", unitRate: 2000,
      taxTreatment: "exclusive", gstRate: 0, gstType: "cgst_sgst", recoverableTaxPct: 100,
      justification: "Nothing budgeted for this yet",
    });
    expect(newLine.gross_amount).toBe(expectedNewLine.grossAmount);
    expect(newLine.pnl_cost_amount).toBe(expectedNewLine.pnlCostAmount);

    const allocations = state.allocations.filter((row) => row.budget_line_id === newLine.id);
    expect(allocations).toHaveLength(2);
    const totalPercentage = allocations.reduce((sum, row) => sum + row.allocation_percentage, 0);
    expect(Math.abs(totalPercentage - 100)).toBeLessThan(0.000001);

    // Header started at 0/0 for this budget (no other lines in this fixture), so the increase
    // equals the new line's own gross/pnl amounts exactly.
    const header = state.headers.get("budget-2")!;
    expect(header.gross_budget_amount).toBe(newLine.gross_amount);
    expect(header.pnl_budget_amount).toBe(newLine.pnl_cost_amount);
  });
});

describe("directApply() with cost-centre splits", () => {
  it("applies the increase and writes the allocation rows, ignoring any stray isNewLine flag", async () => {
    const linesBefore = state.lines.size;
    const result = await budgetTopupService.directApply(
      {
        budgetLineId: "line-3",
        additionalQuantity: 10,
        reason: "Direct increase",
        costCentreSplits: [
          { costCentreId: "cc-1", amount: 2500, quantity: 5 },
          { costCentreId: "cc-2", amount: 2500, quantity: 5 },
        ],
        // Not part of directApply()'s declared input type — included here only to prove a stray
        // flag has no effect, matching the Group D report's stated decision (silently ignored,
        // not explicitly refused).
        isNewLine: true,
      } as any,
      "user-finance-head",
      "finance_head"
    );
    expect(result).toBeDefined();

    // No new finance_budget_line row was created — directApply() never calls
    // applyTopupAsNewLine(), regardless of what the caller passed.
    expect(state.lines.size).toBe(linesBefore);

    const line = state.lines.get("line-3")!;
    const expectedLine = calculateBudgetLine({
      head: line.head, itemName: line.item_name, quantity: 30, unit: line.unit, unitRate: line.unit_rate,
      taxTreatment: line.tax_treatment as any, gstRate: line.gst_rate, gstType: line.gst_type as any,
      recoverableTaxPct: line.recoverable_tax_pct, justification: "",
    });
    expect(line.quantity).toBe(30);
    expect(line.gross_amount).toBe(expectedLine.grossAmount);
    expect(line.pnl_cost_amount).toBe(expectedLine.pnlCostAmount);

    const allocations = state.allocations.filter((row) => row.budget_line_id === "line-3");
    expect(allocations).toHaveLength(2);
    const totalPercentage = allocations.reduce((sum, row) => sum + row.allocation_percentage, 0);
    expect(Math.abs(totalPercentage - 100)).toBeLessThan(0.000001);
  });
});
