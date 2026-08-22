import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Group C, step 2b (2026-08-22) — branch-wide headroom gate wired into saveComponentAllocations().
 *
 * Mirrors grn-branch-headroom-gate.test.ts's mocked-DB approach (real calculateBudgetLine /
 * getHeadSubHeadCoverage / allocateAcrossLines, faked DB layer routed by matching distinctive SQL
 * substrings). This method applies the SAME branch-aggregate/spillover rule as step 2a's
 * saveAllocations(), but with a different, already-documented tax rule: "Invoice GST rates are
 * ground truth" — each grid cell's already-computed, invoice-driven base/tax/gross figures are
 * kept FIXED and only reapportioned pro-rata across whichever funding line(s) end up paying for
 * them, never recomputed via calculateBudgetLine() against a funding line's own gst_rate/
 * tax_treatment. Several tests below exist specifically to catch that rule being violated.
 */

const { stateRef } = vi.hoisted(() => ({ stateRef: { current: null as any } }));

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: (...args: unknown[]) => stateRef.current.route(...(args as [string, unknown[]?])),
    getConnection: async () => stateRef.current.connection,
  },
}));

vi.mock("../../../shared/financeApprovalEvent.js", () => ({
  recordFinanceApprovalEvent: vi.fn().mockResolvedValue(undefined),
  listFinanceApprovalEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../shared/auditLog.js", () => ({
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../process-pnl/budget-consumption.service.js", () => ({
  budgetConsumptionService: {
    reserve: vi.fn().mockResolvedValue(undefined),
    consume: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    reverseConsumption: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../process-pnl/finance-period-lock.js", () => ({
  isPeriodLocked: vi.fn().mockResolvedValue(false),
}));

// Real getHeadSubHeadCoverage/allocateAcrossLines implementation throughout.
vi.mock("../../process-pnl/budget-headroom-gate.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../process-pnl/budget-headroom-gate.service.js")>();
  return {
    ...actual,
    getHeadSubHeadCoverage: vi.fn(actual.getHeadSubHeadCoverage),
  };
});

type FakeBudgetHeader = { id: string; branch_id: string; period_code: string; status: string; financial_year?: string };
type FakeBudgetLine = {
  id: string;
  budget_id: string;
  head: string;
  sub_head: string | null;
  item_name: string;
  cost_centre_id: string | null;
  cost_centre_name?: string | null;
  process_id: string | null;
  unit: string;
  unit_rate: number;
  tax_treatment: string;
  gst_rate: number;
  gst_type: string;
  recoverable_tax_pct: number;
  justification: string;
  period_code: string;
  quantity: number;
  reserved_quantity: number;
  consumed_quantity: number;
  gross_amount: number;
  reserved_amount: number;
  consumed_amount: number;
};
type FakeCostCentre = { id: string; cost_centre_code: string; cost_centre_name: string; branch_id: string; active_status: number };

const ALLOCATION_INSERT_COLUMNS = [
  "id", "grn_request_id", "sequence_no", "budget_id", "budget_line_id", "invoice_component_id",
  "branch_id", "process_id", "cost_centre_id", "cost_class", "allocation_percentage",
  "quantity", "unit", "unit_rate", "tax_treatment", "gst_rate", "gst_type",
  "recoverable_tax_pct", "amount_without_tax", "tax_amount", "cgst_amount",
  "sgst_amount", "igst_amount", "amount_with_tax", "recoverable_tax_amount",
  "pnl_cost_amount", "lifecycle_status", "remarks", "is_unbudgeted", "created_by",
] as const;

const COMPONENT_INSERT_COLUMNS = [
  "id", "grn_request_id", "sequence_no", "amount_without_tax", "gst_rate",
  "hsn_sac_code", "tax_amount", "amount_with_tax", "remarks", "created_by",
] as const;

function makeState(opts: {
  grn: Record<string, unknown>;
  budgetHeaders: FakeBudgetHeader[];
  budgetLines: FakeBudgetLine[];
  costCentres: FakeCostCentre[];
}) {
  const insertedAllocations: Record<string, unknown>[] = [];
  const insertedComponents: Record<string, unknown>[] = [];
  let grnUpdateParams: unknown[] | null = null;

  function norm(v: unknown) {
    return String(v ?? "").trim().toUpperCase();
  }

  async function route(sql: string, params: unknown[] = []): Promise<[unknown, unknown]> {
    const s = String(sql).replace(/\s+/g, " ").trim();

    if (s.includes("SELECT * FROM grn_request WHERE id = ? FOR UPDATE")) {
      return [[opts.grn], []];
    }

    // getWorkspace()'s own grn_request fetch (saveComponentAllocations returns
    // this.getWorkspace(grnId) at the end).
    if (s.startsWith("SELECT g.*") && s.includes("FROM grn_request g")) {
      return [[opts.grn], []];
    }

    // loadAllocations() — reads back what THIS save just inserted.
    if (s.includes("FROM grn_cost_allocation a")) {
      return [insertedAllocations.slice(), []];
    }

    // lockBudgetLine — distinctive via its join to finance_budget_line AND process_master; must
    // be checked before the generic "LEFT JOIN process_master" match, since getWorkspace()'s own
    // query also joins process_master.
    if (s.includes("FROM finance_budget_line l") && s.includes("LEFT JOIN process_master")) {
      const [budgetLineId, branchId] = params;
      const line = opts.budgetLines.find((l) => String(l.id) === String(budgetLineId));
      if (!line) return [[], []];
      const header = opts.budgetHeaders.find((h) => String(h.id) === String(line.budget_id));
      if (!header || String(header.branch_id) !== String(branchId)) return [[], []];
      const cc = opts.costCentres.find((c) => String(c.id) === String(line.cost_centre_id));
      return [[{
        ...line,
        budget_status: header.status,
        branch_id: header.branch_id,
        period_code: header.period_code,
        financial_year: header.financial_year ?? "2026-27",
        process_name: null,
        cost_centre_name: cc?.cost_centre_name ?? line.cost_centre_name ?? null,
      }], []];
    }

    // getHeadSubHeadCoverage's lines query — distinctive via the UPPER(TRIM(l.head)) filter.
    if (s.includes("UPPER(TRIM(l.head))")) {
      const [headerId, head, subHead] = params;
      const matches = opts.budgetLines.filter((l) =>
        String(l.budget_id) === String(headerId)
        && norm(l.head) === norm(head)
        && norm(l.sub_head) === norm(subHead)
      );
      const rows = matches.map((l) => ({
        ...l,
        available_quantity: Number(l.quantity) - Number(l.reserved_quantity) - Number(l.consumed_quantity),
        available_gross_amount: Math.round((Number(l.gross_amount) - Number(l.reserved_amount) - Number(l.consumed_amount) + Number.EPSILON) * 100) / 100,
      }));
      return [rows, []];
    }

    // getHeadSubHeadCoverage's header query.
    if (s.includes("FROM finance_budget_header") && s.includes("status = 'active'") && s.includes("LIMIT 1")) {
      const [branchId, periodCode] = params;
      const header = opts.budgetHeaders.find((h) =>
        String(h.branch_id) === String(branchId) && String(h.period_code) === String(periodCode) && h.status === "active"
      );
      return [header ? [{ id: header.id }] : [], []];
    }

    if (s.includes("FROM cost_centre_master") && s.includes("active_status = 1")) {
      const [ccId] = params;
      const cc = opts.costCentres.find((c) => String(c.id) === String(ccId) && c.active_status === 1);
      return [cc ? [cc] : [], []];
    }

    if (s.startsWith("DELETE FROM grn_cost_allocation")) {
      insertedAllocations.length = 0;
      return [{ affectedRows: 0 }, []];
    }

    if (s.startsWith("DELETE FROM grn_invoice_component")) {
      insertedComponents.length = 0;
      return [{ affectedRows: 0 }, []];
    }

    if (s.startsWith("INSERT INTO grn_invoice_component")) {
      const record: Record<string, unknown> = {};
      COMPONENT_INSERT_COLUMNS.forEach((col, i) => { record[col] = params[i]; });
      insertedComponents.push(record);
      return [{ insertId: insertedComponents.length, affectedRows: 1 }, []];
    }

    if (s.startsWith("INSERT INTO grn_cost_allocation")) {
      const record: Record<string, unknown> = {};
      ALLOCATION_INSERT_COLUMNS.forEach((col, i) => { record[col] = params[i]; });
      insertedAllocations.push(record);
      return [{ insertId: insertedAllocations.length, affectedRows: 1 }, []];
    }

    if (s.includes("SELECT id, allocation_percentage FROM grn_cost_allocation")) {
      return [insertedAllocations.map((r) => ({ id: r.id, allocation_percentage: r.allocation_percentage })), []];
    }

    if (s.includes("UPDATE grn_cost_allocation SET allocation_percentage")) {
      const [delta, id] = params;
      const rec = insertedAllocations.find((r) => r.id === id);
      if (rec) rec.allocation_percentage = Number(rec.allocation_percentage) + Number(delta);
      return [{ affectedRows: 1 }, []];
    }

    if (s.startsWith("UPDATE grn_request") && s.includes("SET allocation_mode")) {
      grnUpdateParams = params;
      return [{ affectedRows: 1 }, []];
    }

    if (s.includes("DELETE FROM grn_period_allocation")) {
      return [{ affectedRows: 0 }, []];
    }
    if (s.startsWith("UPDATE grn_request") && s.includes("recognition_start_period = NULL")) {
      return [{ affectedRows: 1 }, []];
    }
    if (s.startsWith("INSERT INTO sensitive_action_log")) {
      return [{ insertId: 1 }, []];
    }

    // getWorkspace()'s remaining auxiliary reads — none of them are exercised by anything this
    // file asserts on, so any plain SELECT not explicitly handled above is answered with an empty
    // result set. Anything that is NOT a SELECT still throws below, so an unexpected write is not
    // silently swallowed.
    if (s.startsWith("SELECT")) {
      return [[], []];
    }

    throw new Error(`Unhandled SQL in fake DB router: ${s.slice(0, 200)}`);
  }

  const connection = {
    execute: (...args: [string, unknown[]?]) => route(...args),
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
  };

  return {
    route,
    connection,
    get insertedAllocations() { return insertedAllocations; },
    get insertedComponents() { return insertedComponents; },
    get grnUpdateParams() { return grnUpdateParams; },
  };
}

function baseGrn(overrides: Record<string, unknown> = {}) {
  return {
    id: "grn-1",
    status: "draft",
    grn_type: "vendor",
    branch_id: "br-1",
    accounting_period: "2026-08",
    recognition_start_period: null,
    recognition_end_period: null,
    bill_date: "2026-08-05",
    head: null,
    sub_head: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("saveComponentAllocations — branch-wide headroom gate (Group C step 2b)", () => {
  it("1. zero budget lines anywhere for the shared head/sub-head — throws NO_BUDGET_FOR_HEAD", async () => {
    stateRef.current = makeState({
      grn: baseGrn({ head: "Marketing", sub_head: "Events" }),
      budgetHeaders: [{ id: "hdr-1", branch_id: "br-1", period_code: "2026-08", status: "active" }],
      budgetLines: [], // nothing anywhere for this head/sub-head
      costCentres: [{ id: "cc-X", cost_centre_code: "CCX", cost_centre_name: "CC X", branch_id: "br-1", active_status: 1 }],
    });
    const { grnSmartService } = await import("../grn-smart.service.js");
    await expect(
      grnSmartService.saveComponentAllocations(
        "grn-1",
        {
          declaredInvoiceTotal: 118,
          components: [{ amountWithoutTax: 100, gstRate: 18 }],
          costCentreSplits: [{ costCentreId: "cc-X", percentage: 100 }],
        },
        "user-1",
        "branch_head"
      )
    ).rejects.toMatchObject({ code: "NO_BUDGET_FOR_HEAD", statusCode: 409 });
  });

  it("2. branch has no active budget header at all for the period — throws NO_BRANCH_BUDGET", async () => {
    stateRef.current = makeState({
      grn: baseGrn({ head: "Marketing", sub_head: "Events" }),
      budgetHeaders: [], // no active header for br-1/2026-08 at all
      budgetLines: [],
      costCentres: [{ id: "cc-X", cost_centre_code: "CCX", cost_centre_name: "CC X", branch_id: "br-1", active_status: 1 }],
    });
    const { grnSmartService } = await import("../grn-smart.service.js");
    await expect(
      grnSmartService.saveComponentAllocations(
        "grn-1",
        {
          declaredInvoiceTotal: 118,
          components: [{ amountWithoutTax: 100, gstRate: 18 }],
          costCentreSplits: [{ costCentreId: "cc-X", percentage: 100 }],
        },
        "user-1",
        "branch_head"
      )
    ).rejects.toMatchObject({ code: "NO_BRANCH_BUDGET", statusCode: 409 });
  });

  it("3/4. own line short, a sibling covers the rest — 4 rows (2 components x 2 draws), original cost centre preserved, gross reproduces exactly, and gst_rate stays the INVOICE's own rate even though the funding line's own gst_rate/tax_treatment differ", async () => {
    const lineA: FakeBudgetLine = {
      id: "line-A", budget_id: "hdr-1", head: "Office Supplies", sub_head: "Consumables",
      item_name: "Consumables A", cost_centre_id: "cc-A", cost_centre_name: "CC A", process_id: null,
      unit: "nos", unit_rate: 10, tax_treatment: "exclusive", gst_rate: 5, gst_type: "cgst_sgst",
      recoverable_tax_pct: 100, justification: "Approved", period_code: "2026-08",
      quantity: 1000, reserved_quantity: 0, consumed_quantity: 980,
      gross_amount: 10000, reserved_amount: 0, consumed_amount: 9800, // available: ~₹200
    };
    // Sibling's own gst_rate/tax_treatment DELIBERATELY differ from lineA's and from the
    // invoice components' own rates (18% and 0%) — proves the ground-truth rule: the funding
    // line's own tax profile must never leak into the invoice-driven amounts.
    const lineB: FakeBudgetLine = {
      id: "line-B", budget_id: "hdr-1", head: "Office Supplies", sub_head: "Consumables",
      item_name: "Consumables B (Pooled)", cost_centre_id: null, cost_centre_name: null, process_id: null,
      unit: "nos", unit_rate: 20, tax_treatment: "inclusive", gst_rate: 12, gst_type: "igst",
      recoverable_tax_pct: 50, justification: "Approved", period_code: "2026-08",
      quantity: 1000, reserved_quantity: 0, consumed_quantity: 0,
      gross_amount: 50000, reserved_amount: 0, consumed_amount: 0, // ample
    };
    stateRef.current = makeState({
      grn: baseGrn(),
      budgetHeaders: [{ id: "hdr-1", branch_id: "br-1", period_code: "2026-08", status: "active" }],
      budgetLines: [lineA, lineB],
      costCentres: [{ id: "cc-A", cost_centre_code: "CCA", cost_centre_name: "CC A", branch_id: "br-1", active_status: 1 }],
    });
    const { grnSmartService } = await import("../grn-smart.service.js");
    const { calculateBudgetLine } = await import("../../process-pnl/branch-budget.service.js");

    // Two components, single 100% split against line-A. Chosen so the total (1108) safely
    // exceeds line-A's own ~₹200 headroom and must spill onto line-B.
    await grnSmartService.saveComponentAllocations(
      "grn-1",
      {
        declaredInvoiceTotal: 1108, // 708 (600 @18%) + 400 (400 @0%) = 1108, diff = 0
        components: [
          { amountWithoutTax: 600, gstRate: 18 },
          { amountWithoutTax: 400, gstRate: 0 },
        ],
        costCentreSplits: [{ budgetLineId: "line-A", percentage: 100 }],
      },
      "user-1",
      "branch_head"
    );

    const rows = stateRef.current.insertedAllocations;
    expect(rows).toHaveLength(4);

    // Every row keeps the ORIGINAL split's own cost centre (line-A's), never line-B's (pooled).
    for (const row of rows) {
      expect(row.cost_centre_id).toBe("cc-A");
    }

    // gst_rate column is the INVOICE COMPONENT's own real rate, never the funding line's
    // (5% on line-A, 12% on line-B) — this is the test that would catch the ground-truth rule
    // being violated.
    const componentIndexOf = (invoiceComponentId: unknown) =>
      stateRef.current.insertedComponents.findIndex((c: any) => c.id === invoiceComponentId);
    const rowsForComponent = (compIdx: number) =>
      rows.filter((r) => componentIndexOf(r.invoice_component_id) === compIdx);

    const comp0Rows = rowsForComponent(0); // the 600 @ 18% component
    const comp1Rows = rowsForComponent(1); // the 400 @ 0% component
    expect(comp0Rows).toHaveLength(2);
    expect(comp1Rows).toHaveLength(2);
    for (const row of comp0Rows) expect(Number(row.gst_rate)).toBe(18);
    for (const row of comp1Rows) expect(Number(row.gst_rate)).toBe(0);

    // Re-derive each component's pre-split gross INDEPENDENTLY (same call shape the source uses
    // to build the grid cell) and confirm the fan-out sub-rows sum to it exactly.
    const expectedComp0 = calculateBudgetLine({
      head: "Office Supplies", subHead: "Consumables", itemName: lineA.item_name,
      quantity: 1, unit: lineA.unit, unitRate: 600, taxTreatment: "exclusive",
      gstRate: 18, gstType: lineA.gst_type as any, recoverableTaxPct: lineA.recoverable_tax_pct,
      justification: "x",
    });
    const expectedComp1 = calculateBudgetLine({
      head: "Office Supplies", subHead: "Consumables", itemName: lineA.item_name,
      quantity: 1, unit: lineA.unit, unitRate: 400, taxTreatment: "exclusive",
      gstRate: 0, gstType: lineA.gst_type as any, recoverableTaxPct: lineA.recoverable_tax_pct,
      justification: "x",
    });
    const sum0 = comp0Rows.reduce((s, r) => s + Number(r.amount_with_tax), 0);
    const sum1 = comp1Rows.reduce((s, r) => s + Number(r.amount_with_tax), 0);
    expect(sum0).toBeCloseTo(expectedComp0.grossAmount, 6);
    expect(sum1).toBeCloseTo(expectedComp1.grossAmount, 6);

    // One draw per component is funded by line-A, the other by line-B.
    expect(comp0Rows.map((r) => r.budget_line_id).sort()).toEqual(["line-A", "line-B"]);
    expect(comp1Rows.map((r) => r.budget_line_id).sort()).toEqual(["line-A", "line-B"]);

    // Spillover audit note on the line-B draws only.
    const lineBRows = rows.filter((r) => r.budget_line_id === "line-B");
    for (const row of lineBRows) {
      expect(String(row.remarks)).toContain("Auto-allocated from branch aggregate headroom for Office Supplies/Consumables");
    }
  });

  it("5. spillover sub-row's recomputed quantity exceeds the funding line's own available_quantity — throws HEADROOM_EXCEEDED even though money-headroom was sufficient", async () => {
    const lineA: FakeBudgetLine = {
      id: "line-A", budget_id: "hdr-1", head: "Office Supplies", sub_head: "Consumables",
      item_name: "Consumables A", cost_centre_id: "cc-A", cost_centre_name: "CC A", process_id: null,
      unit: "nos", unit_rate: 10, tax_treatment: "exclusive", gst_rate: 0, gst_type: "cgst_sgst",
      recoverable_tax_pct: 100, justification: "Approved", period_code: "2026-08",
      quantity: 1000, reserved_quantity: 0, consumed_quantity: 980,
      gross_amount: 10000, reserved_amount: 0, consumed_amount: 9800, // available: ~₹200
    };
    const lineB: FakeBudgetLine = {
      id: "line-B", budget_id: "hdr-1", head: "Office Supplies", sub_head: "Consumables",
      item_name: "Consumables B (Pooled)", cost_centre_id: null, cost_centre_name: null, process_id: null,
      unit: "nos", unit_rate: 20, tax_treatment: "exclusive", gst_rate: 0, gst_type: "cgst_sgst",
      recoverable_tax_pct: 100, justification: "Approved", period_code: "2026-08",
      // Plenty of MONEY, but the spillover draw of ~₹500 needs 25 units at ₹20/unit — only 5 left.
      quantity: 5, reserved_quantity: 0, consumed_quantity: 0,
      gross_amount: 50000, reserved_amount: 0, consumed_amount: 0,
    };
    stateRef.current = makeState({
      grn: baseGrn(),
      budgetHeaders: [{ id: "hdr-1", branch_id: "br-1", period_code: "2026-08", status: "active" }],
      budgetLines: [lineA, lineB],
      costCentres: [{ id: "cc-A", cost_centre_code: "CCA", cost_centre_name: "CC A", branch_id: "br-1", active_status: 1 }],
    });
    const { grnSmartService } = await import("../grn-smart.service.js");

    await expect(
      grnSmartService.saveComponentAllocations(
        "grn-1",
        {
          declaredInvoiceTotal: 700,
          components: [{ amountWithoutTax: 700, gstRate: 0 }],
          costCentreSplits: [{ budgetLineId: "line-A", percentage: 100 }],
        },
        "user-1",
        "branch_head"
      )
    ).rejects.toMatchObject({ code: "HEADROOM_EXCEEDED", statusCode: 409 });
  });

  it("6. two splits sharing the same head/sub-head both draw against the same pooled sibling — the second split's draw is netted against what the first already took", async () => {
    // line-A and line-C are each direct lines with ZERO headroom of their own, forcing BOTH
    // splits to draw entirely from the shared pooled line-S. line-S has only ₹1000 available;
    // split 1 needs ₹800 and split 2 needs ₹300 (₹1100 total) — without netting the second
    // split's allocateAcrossLines call against the first split's already-decided draw, both
    // would wrongly see the FULL ₹1000 available and succeed, overcommitting the aggregate.
    const lineA: FakeBudgetLine = {
      id: "line-A", budget_id: "hdr-1", head: "Office Supplies", sub_head: "Consumables",
      item_name: "Consumables A", cost_centre_id: "cc-A", cost_centre_name: "CC A", process_id: null,
      unit: "nos", unit_rate: 10, tax_treatment: "exclusive", gst_rate: 0, gst_type: "cgst_sgst",
      recoverable_tax_pct: 100, justification: "Approved", period_code: "2026-08",
      quantity: 100, reserved_quantity: 100, consumed_quantity: 0,
      gross_amount: 1000, reserved_amount: 1000, consumed_amount: 0, // available: ₹0
    };
    const lineC: FakeBudgetLine = {
      id: "line-C", budget_id: "hdr-1", head: "Office Supplies", sub_head: "Consumables",
      item_name: "Consumables C", cost_centre_id: "cc-C", cost_centre_name: "CC C", process_id: null,
      unit: "nos", unit_rate: 10, tax_treatment: "exclusive", gst_rate: 0, gst_type: "cgst_sgst",
      recoverable_tax_pct: 100, justification: "Approved", period_code: "2026-08",
      quantity: 100, reserved_quantity: 100, consumed_quantity: 0,
      gross_amount: 1000, reserved_amount: 1000, consumed_amount: 0, // available: ₹0
    };
    const lineS: FakeBudgetLine = {
      id: "line-S", budget_id: "hdr-1", head: "Office Supplies", sub_head: "Consumables",
      item_name: "Consumables (Pooled)", cost_centre_id: null, cost_centre_name: null, process_id: null,
      unit: "nos", unit_rate: 10, tax_treatment: "exclusive", gst_rate: 0, gst_type: "cgst_sgst",
      recoverable_tax_pct: 100, justification: "Approved", period_code: "2026-08",
      quantity: 100, reserved_quantity: 0, consumed_quantity: 0,
      gross_amount: 1000, reserved_amount: 0, consumed_amount: 0, // available: ₹1000 total
    };
    stateRef.current = makeState({
      grn: baseGrn(),
      budgetHeaders: [{ id: "hdr-1", branch_id: "br-1", period_code: "2026-08", status: "active" }],
      budgetLines: [lineA, lineC, lineS],
      costCentres: [
        { id: "cc-A", cost_centre_code: "CCA", cost_centre_name: "CC A", branch_id: "br-1", active_status: 1 },
        { id: "cc-C", cost_centre_code: "CCC", cost_centre_name: "CC C", branch_id: "br-1", active_status: 1 },
      ],
    });
    const { grnSmartService } = await import("../grn-smart.service.js");

    await expect(
      grnSmartService.saveComponentAllocations(
        "grn-1",
        {
          declaredInvoiceTotal: 1100,
          components: [{ amountWithoutTax: 1100, gstRate: 0 }],
          costCentreSplits: [
            { budgetLineId: "line-A", percentage: 800 / 1100 * 100 }, // ~₹800 of the invoice
            { budgetLineId: "line-C", percentage: 300 / 1100 * 100 }, // ~₹300 of the invoice
          ],
        },
        "user-1",
        "branch_head"
      )
    ).rejects.toMatchObject({ code: "HEADROOM_EXCEEDED", statusCode: 409 });
  });

  it("7. normal case, no spillover anywhere — row count, amounts and quantities identical to pre-change behaviour", async () => {
    const lineN: FakeBudgetLine = {
      id: "line-N", budget_id: "hdr-1", head: "Travel", sub_head: "Local Conveyance",
      item_name: "Local Conveyance", cost_centre_id: "cc-N", cost_centre_name: "CC N", process_id: null,
      unit: "trip", unit_rate: 50, tax_treatment: "exclusive", gst_rate: 18, gst_type: "cgst_sgst",
      recoverable_tax_pct: 100, justification: "Approved", period_code: "2026-08",
      quantity: 1000, reserved_quantity: 0, consumed_quantity: 0,
      gross_amount: 100000, reserved_amount: 0, consumed_amount: 0, // ample room
    };
    stateRef.current = makeState({
      grn: baseGrn(),
      budgetHeaders: [{ id: "hdr-1", branch_id: "br-1", period_code: "2026-08", status: "active" }],
      budgetLines: [lineN],
      costCentres: [{ id: "cc-N", cost_centre_code: "CCN", cost_centre_name: "CC N", branch_id: "br-1", active_status: 1 }],
    });
    const { grnSmartService } = await import("../grn-smart.service.js");

    await grnSmartService.saveComponentAllocations(
      "grn-1",
      {
        declaredInvoiceTotal: 590, // 500 base + 18% = 590
        components: [{ amountWithoutTax: 500, gstRate: 18 }],
        costCentreSplits: [{ budgetLineId: "line-N", percentage: 100, remarks: "Straightforward" }],
      },
      "user-1",
      "branch_head"
    );

    const rows = stateRef.current.insertedAllocations;
    expect(rows).toHaveLength(1); // 1 split x 1 component, no spillover
    expect(rows[0].cost_centre_id).toBe("cc-N");
    expect(rows[0].budget_line_id).toBe("line-N");
    expect(rows[0].remarks).toBe("Straightforward");
    expect(Number(rows[0].amount_with_tax)).toBeCloseTo(590, 6);
    expect(Number(rows[0].quantity)).toBeCloseTo(10, 6); // 500 base / ₹50 per trip
  });

  it("8. an unbudgeted split with real branch capacity available succeeds, resulting rows carry a real non-null budget_id/budget_line_id", async () => {
    const lineT: FakeBudgetLine = {
      id: "line-T", budget_id: "hdr-1", head: "Travel", sub_head: "Local Conveyance",
      item_name: "Local Conveyance", cost_centre_id: null, cost_centre_name: null, process_id: null,
      unit: "trip", unit_rate: 100, tax_treatment: "exclusive", gst_rate: 0, gst_type: "cgst_sgst",
      recoverable_tax_pct: 100, justification: "Approved", period_code: "2026-08",
      quantity: 50, reserved_quantity: 0, consumed_quantity: 0,
      gross_amount: 5000, reserved_amount: 0, consumed_amount: 0,
    };
    stateRef.current = makeState({
      grn: baseGrn({ head: "Travel", sub_head: "Local Conveyance" }),
      budgetHeaders: [{ id: "hdr-1", branch_id: "br-1", period_code: "2026-08", status: "active" }],
      budgetLines: [lineT],
      costCentres: [{ id: "cc-X", cost_centre_code: "CCX", cost_centre_name: "CC X", branch_id: "br-1", active_status: 1 }],
    });
    const { grnSmartService } = await import("../grn-smart.service.js");

    await grnSmartService.saveComponentAllocations(
      "grn-1",
      {
        declaredInvoiceTotal: 1000,
        components: [{ amountWithoutTax: 1000, gstRate: 0 }],
        costCentreSplits: [{ costCentreId: "cc-X", percentage: 100 }], // no budgetLineId
      },
      "user-1",
      "branch_head"
    );

    const rows = stateRef.current.insertedAllocations;
    expect(rows).toHaveLength(1);
    expect(rows[0].budget_line_id).toBe("line-T");
    expect(rows[0].budget_id).toBe("hdr-1");
    expect(rows[0].is_unbudgeted).toBe(1);
    // Cost-centre attribution is the raiser's own, not the funding line's (line-T is pooled/null).
    expect(rows[0].cost_centre_id).toBe("cc-X");
    expect(Number(rows[0].amount_with_tax)).toBeCloseTo(1000, 6);
  });
});
