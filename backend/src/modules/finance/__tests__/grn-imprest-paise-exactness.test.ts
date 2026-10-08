import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Imprest paise exactness (2026-08-27).
 *
 * Reported symptom: a ₹2,112.00 imprest voucher split 50/50 across two cost centres showed a
 * total of ₹2,112.02 in the GRN form and could not be submitted at all — saveAllocations refuses
 * any cost-centre split that misses the declared invoice total by more than ₹0.01.
 *
 * Cause: an imprest share was expressed as a fractional QUANTITY of the funding budget line and
 * the money was then re-derived from that quantity through the line's PLANNING tax profile.
 * "Staff Welfare / Tea, Coffee & Refreshment" is planned exclusive-18%, so each ₹1,056.00 share
 * became base ₹894.92 (rounded up from 894.9152) + 18% of that rounded base ₹161.09 = ₹1,056.01.
 * Two rows, ₹0.02. applyImprestNoGst() then zeroed the tax — but only AFTER the gross had already
 * absorbed the rounding, so it relabelled the drift instead of preventing it.
 *
 * An imprest voucher is petty cash: there is no tax invoice, no GST and no ITC, so the rupee
 * figure the raiser types IS the money. It must never travel through a GST profile to get to the
 * allocation rows. These tests drive saveAllocations() end to end against a fake DB — real
 * calculateBudgetLine, real getHeadSubHeadCoverage, real allocateAcrossLines — and assert the
 * rows reproduce the typed amount to the paise.
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

// saveAllocations does not itself lock the accounting period against real data here — that is
// exercised by the pre-existing pre-pass contract tests. Stubbed false so every test below is
// exercising the headroom gate, not incidentally tripping over an unrelated guard.
vi.mock("../../process-pnl/finance-period-lock.js", () => ({
  isPeriodLocked: vi.fn().mockResolvedValue(false),
}));

// Partial mock: real getHeadSubHeadCoverage/allocateAcrossLines implementation, wrapped so call
// arguments can be inspected (used by the "does not share an aggregate across rows with
// different head/sub-heads" test below).
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

// funding_cost_centre_id sits beside cost_centre_id from migration 1630: WHO INCURRED the
// spend and WHOSE BUDGET PAID it are separate facts now, so this fixture mirrors that order.
const INSERT_COLUMNS = [
  "id", "grn_request_id", "sequence_no", "budget_id", "budget_line_id", "branch_id",
  "process_id", "cost_centre_id", "funding_cost_centre_id", "cost_class", "allocation_percentage",
  "quantity", "unit", "unit_rate", "tax_treatment", "gst_rate", "gst_type",
  "recoverable_tax_pct", "amount_without_tax", "tax_amount", "cgst_amount",
  "sgst_amount", "igst_amount", "amount_with_tax", "recoverable_tax_amount",
  "pnl_cost_amount", "lifecycle_status", "remarks", "is_unbudgeted", "created_by",
] as const;

function makeState(opts: {
  grn: Record<string, unknown>;
  budgetHeaders: FakeBudgetHeader[];
  budgetLines: FakeBudgetLine[];
  costCentres: FakeCostCentre[];
}) {
  const insertedAllocations: Record<string, unknown>[] = [];
  let grnUpdateParams: unknown[] | null = null;
  let grnUpdateSql: string | null = null;

  function norm(v: unknown) {
    return String(v ?? "").trim().toUpperCase();
  }

  async function route(sql: string, params: unknown[] = []): Promise<[unknown, unknown]> {
    const s = String(sql).replace(/\s+/g, " ").trim();

    if (s.includes("SELECT * FROM grn_request WHERE id = ? FOR UPDATE")) {
      return [[opts.grn], []];
    }

    // getWorkspace()'s own grn_request fetch (saveAllocations returns this.getWorkspace(grnId)
    // at the end) — distinguished from the lockGrn fetch above by its column list and joins.
    if (s.startsWith("SELECT g.*") && s.includes("FROM grn_request g")) {
      return [[opts.grn], []];
    }

    // loadAllocations() — reads back what THIS save just inserted.
    if (s.includes("FROM grn_cost_allocation a")) {
      return [insertedAllocations.slice(), []];
    }

    // lockBudgetLine — distinctive via its join to finance_budget_line AND process_master;
    // must be checked before the generic "LEFT JOIN process_master" match below, since
    // getWorkspace()'s own query also joins process_master.
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

    // getHeadSubHeadCoverage's lines query. Matched on the derived headroom column rather than
    // on the head filter's exact text: that filter now resolves the LINE's head through
    // finance_expense_head_master (a budget line may store head_code where the GRN carries
    // head_name), and a matcher keyed to the old literal silently stopped matching, so the mock
    // returned nothing and every headroom test failed as NO_BUDGET_FOR_HEAD.
    if (s.includes("FROM finance_budget_line l") && s.includes("available_gross_amount")) {
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

    // getHeadSubHeadCoverage's header query
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

    if (s.startsWith("INSERT INTO grn_cost_allocation")) {
      const record: Record<string, unknown> = {};
      INSERT_COLUMNS.forEach((col, i) => { record[col] = params[i]; });
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
      grnUpdateSql = s;
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

    // getWorkspace()'s remaining auxiliary reads (invoice components, documents, extractions,
    // validations, duplicate matches, period-allocation schedule) — none of them are exercised by
    // anything this file asserts on, so any plain SELECT not explicitly handled above is answered
    // with an empty result set rather than enumerated one by one. Anything that is NOT a SELECT
    // still throws below, so an unexpected write is not silently swallowed.
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
    get grnUpdateParams() { return grnUpdateParams; },
    get grnUpdateSql() { return grnUpdateSql; },
  };
}

function baseGrn(overrides: Record<string, unknown> = {}) {
  return {
    id: "grn-1",
    status: "draft",
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
  // The getHeadSubHeadCoverage spy wraps the real implementation once and is not guaranteed to be
  // recreated by resetModules alone under NodeNext/ESM — clear call history explicitly so each
  // test's assertions on "how many times / with what args" are not polluted by earlier tests.
  // clearAllMocks (not resetAllMocks) so the wrapped real implementation and the
  // isPeriodLocked mockResolvedValue(false) survive.
  vi.clearAllMocks();
});

/** The real line behind the report: shared-pool "Tea, Coffee & Refreshment", planned
 *  exclusive-18%. Its gross headroom is deliberately far larger than any voucher below, so every
 *  test here is exercising the money maths and nothing else. */
const teaLine: FakeBudgetLine = {
  id: "line-tea", budget_id: "hdr-1", head: "Staff Welfare", sub_head: "Tea, Coffee & Refreshment",
  item_name: "Tea, Coffee & Refreshment", cost_centre_id: null, cost_centre_name: null, process_id: null,
  unit: "Month", unit_rate: 8500, tax_treatment: "exclusive", gst_rate: 18, gst_type: "cgst_sgst",
  recoverable_tax_pct: 100, justification: "Approved", period_code: "2026-08",
  quantity: 12, reserved_quantity: 0, consumed_quantity: 0,
  gross_amount: 120360, reserved_amount: 0, consumed_amount: 0,
};

const headers = [{ id: "hdr-1", branch_id: "br-1", period_code: "2026-08", status: "active" }];
const costCentres = [
  { id: "cc-465", cost_centre_code: "BSS/OB/AHMH-JD/465", cost_centre_name: "Godfrey Philips India Ltd", branch_id: "br-1", active_status: 1 },
  { id: "cc-919", cost_centre_code: "BSS/OB/AHMH-JD/919", cost_centre_name: "Bluevine Technologies", branch_id: "br-1", active_status: 1 },
];

/** What the GRN form posts for one cost-centre share: the exact rupee share as `grossAmount`,
 *  with quantity/unitRate kept for the stored quantity column only. */
const share = (amount: number) => ({
  budgetLineId: "line-tea",
  quantity: Number((amount / 10030).toFixed(4)), // 4-dp qty against the line's GROSS per-unit
  unitRate: 8500,
  grossAmount: amount,
});

const sum = (rows: Record<string, unknown>[], col: string) =>
  Math.round(rows.reduce((total, row) => total + Number(row[col] ?? 0), 0) * 100) / 100;

describe("imprest allocations reproduce the typed amount to the paise", () => {
  it("₹2,112 split 50/50 on an exclusive-18% line books exactly ₹2,112.00, not ₹2,112.02", async () => {
    stateRef.current = makeState({
      grn: baseGrn({ grn_type: "imprest" }),
      budgetHeaders: headers, budgetLines: [teaLine], costCentres,
    });
    const { grnSmartService } = await import("../grn-smart.service.js");

    await grnSmartService.saveAllocations(
      "grn-1",
      { allocations: [share(1056), share(1056)], declaredInvoiceTotal: 2112 },
      "user-1",
      "branch_head"
    );

    const rows = stateRef.current.insertedAllocations;
    expect(rows).toHaveLength(2);
    expect(sum(rows, "amount_with_tax")).toBe(2112);
    expect(sum(rows, "pnl_cost_amount")).toBe(2112);
    expect(sum(rows, "amount_without_tax")).toBe(2112);
    // Every row is exactly its own share — the drift was a paisa per row, so a total-only
    // assertion could be satisfied by two rows that are individually wrong and cancel out.
    for (const row of rows) {
      expect(Number(row.amount_with_tax)).toBe(1056);
      expect(Number(row.tax_amount)).toBe(0);
      expect(Number(row.cgst_amount)).toBe(0);
      expect(Number(row.sgst_amount)).toBe(0);
      expect(Number(row.recoverable_tax_amount)).toBe(0);
      expect(String(row.tax_treatment)).toBe("non_gst");
    }
  });

  it("the ±₹0.01 declared-total guard passes — this is what blocked the voucher from submitting", async () => {
    stateRef.current = makeState({
      grn: baseGrn({ grn_type: "imprest" }),
      budgetHeaders: headers, budgetLines: [teaLine], costCentres,
    });
    const { grnSmartService } = await import("../grn-smart.service.js");

    // Before the fix this rejected with "Cost-centre splits must equal the invoice total
    // exactly. Difference: 0.02".
    await expect(
      grnSmartService.saveAllocations(
        "grn-1",
        { allocations: [share(1056), share(1056)], declaredInvoiceTotal: 2112 },
        "user-1",
        "branch_head"
      )
    ).resolves.toBeDefined();
  });

  it("an uneven three-way split still lands on the typed total", async () => {
    stateRef.current = makeState({
      grn: baseGrn({ grn_type: "imprest" }),
      budgetHeaders: headers, budgetLines: [teaLine], costCentres,
    });
    const { grnSmartService } = await import("../grn-smart.service.js");

    // 100 / 3 does not divide into paise: the form hands the residual to the last row.
    await grnSmartService.saveAllocations(
      "grn-1",
      { allocations: [share(33.33), share(33.33), share(33.34)], declaredInvoiceTotal: 100 },
      "user-1",
      "branch_head"
    );

    expect(sum(stateRef.current.insertedAllocations, "amount_with_tax")).toBe(100);
  });

  it("stores a quantity derived from the funding line's own rate — money is exact, quantity is the approximation", async () => {
    stateRef.current = makeState({
      grn: baseGrn({ grn_type: "imprest" }),
      budgetHeaders: headers, budgetLines: [teaLine], costCentres,
    });
    const { grnSmartService } = await import("../grn-smart.service.js");

    await grnSmartService.saveAllocations(
      "grn-1",
      { allocations: [share(1056)], declaredInvoiceTotal: 1056 },
      "user-1",
      "branch_head"
    );

    const [row] = stateRef.current.insertedAllocations;
    expect(Number(row.amount_with_tax)).toBe(1056);
    // ₹1,056 of a ₹8,500/month line. Quantity is a 4-dp approximation and always will be; the
    // point of the fix is that the MONEY no longer inherits that approximation.
    expect(Number(row.quantity)).toBeCloseTo(1056 / 8500, 4);
  });

  it("leaves vendor maths alone — a vendor GRN on the same line still books base + 18% GST", async () => {
    stateRef.current = makeState({
      grn: baseGrn({ grn_type: "vendor" }),
      budgetHeaders: headers, budgetLines: [teaLine], costCentres,
    });
    const { grnSmartService } = await import("../grn-smart.service.js");

    await grnSmartService.saveAllocations(
      "grn-1",
      { allocations: [{ budgetLineId: "line-tea", quantity: 1, unitRate: 8500 }] },
      "user-1",
      "branch_head"
    );

    const [row] = stateRef.current.insertedAllocations;
    expect(Number(row.amount_without_tax)).toBe(8500);
    expect(Number(row.tax_amount)).toBe(1530);
    expect(Number(row.amount_with_tax)).toBe(10030);
    expect(String(row.tax_treatment)).toBe("exclusive");
  });
});

/**
 * round_off_amount is a DISCLOSURE column: it records that a gap between an invoice's components
 * and its declared total was absorbed into a cost allocation rather than fixed. saveComponentAllocations()
 * writes it correctly. saveAllocations() — the other write path, which the same GRN can be saved
 * through afterwards — wrote `input.roundOffAmount ?? 0`, treating "field not sent" as "the
 * round-off is zero" and silently erasing the disclosure while the absorbed paise stayed in the
 * allocation rows. Live evidence: 2 of the 7 component-flow GRNs carry a 4-6 paise gap between
 * their components and their header with round_off_amount reading 0.00, and pass validation only
 * because the re-check tolerance is ₹1.
 *
 * "Not sent" must mean "leave it alone" — the COALESCE pattern the extraction-confirm path
 * already uses. An explicit 0 still clears it.
 */
describe("saveAllocations does not erase a round-off disclosure it was not asked to change", () => {
  const line: FakeBudgetLine = {
    ...teaLine, id: "line-plain", tax_treatment: "exclusive", gst_rate: 0, gst_type: "none",
  };

  async function save(input: Record<string, unknown>, grnOverrides: Record<string, unknown> = {}) {
    stateRef.current = makeState({
      grn: baseGrn({ grn_type: "vendor", round_off_amount: -0.2, ...grnOverrides }),
      budgetHeaders: headers, budgetLines: [line], costCentres,
    });
    const { grnSmartService } = await import("../grn-smart.service.js");
    await grnSmartService.saveAllocations("grn-1", input, "user-1", "branch_head");
    const sql = String(stateRef.current.grnUpdateSql);
    const params = stateRef.current.grnUpdateParams as unknown[];
    // The round-off parameter is the one immediately before is_unbudgeted/grnId at the tail.
    return { sql, roundOffParam: params[params.length - 3] };
  }

  it("leaves the stored value untouched when the caller does not send one", async () => {
    const { sql, roundOffParam } = await save({
      allocations: [{ budgetLineId: "line-plain", quantity: 1, unitRate: 8500 }],
    });
    expect(sql).toContain("round_off_amount = COALESCE(?, round_off_amount)");
    // null = "leave it alone". Before this change it was 0 — the disclosure was wiped.
    expect(roundOffParam).toBeNull();
  });

  it("still writes an explicit value, including an explicit zero", async () => {
    const explicit = await save({
      allocations: [{ budgetLineId: "line-plain", quantity: 1, unitRate: 8500 }],
      roundOffAmount: -0.2,
    });
    expect(explicit.roundOffParam).toBe(-0.2);

    const cleared = await save({
      allocations: [{ budgetLineId: "line-plain", quantity: 1, unitRate: 8500 }],
      roundOffAmount: 0,
    });
    expect(cleared.roundOffParam).toBe(0);
  });
});
