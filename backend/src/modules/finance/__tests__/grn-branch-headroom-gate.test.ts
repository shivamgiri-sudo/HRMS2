import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Group C, step 2a (2026-08-22) — branch-wide headroom gate wired into saveAllocations().
 *
 * Behavioural (mocked-DB) tests. grn-multi-month-wiring.test.ts explains why saveAllocations is
 * otherwise covered by source-contract assertions rather than a mocked-DB harness ("a mock
 * faithful enough to drive it would assert the mock, not the code"). That is true of the
 * surrounding transaction machinery (period locks, recognition schedule, audit trail) — this
 * change is squarely about MONEY MATH and BRANCH-WIDE CAPACITY DECISIONS, which is exactly the
 * part a source-string assertion cannot catch a regression in (e.g. a spillover draw silently
 * reproducing the wrong gross amount, or two allocation rows double-spending the same branch
 * aggregate). So this file drives saveAllocations() end to end against a lightweight in-memory
 * fake of the tables it reads/writes, routed by matching on distinctive SQL substrings — not a
 * rigid ordered `mockResolvedValueOnce` chain, which would make this file as brittle as the thing
 * it is trying to avoid. calculateBudgetLine, getHeadSubHeadCoverage and allocateAcrossLines all
 * run for REAL; only the DB layer, financeApprovalEvent/auditLog/budgetConsumption modules and
 * the period-lock check are faked.
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

const INSERT_COLUMNS = [
  "id", "grn_request_id", "sequence_no", "budget_id", "budget_line_id", "branch_id",
  "process_id", "cost_centre_id", "cost_class", "allocation_percentage",
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

    // getHeadSubHeadCoverage's lines query — distinctive via the UPPER(TRIM(l.head)) filter
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

describe("saveAllocations — branch-wide headroom gate (Group C step 2a)", () => {
  it("1. unbudgeted row, branch has zero budget lines anywhere for that head/sub-head — throws NO_BUDGET_FOR_HEAD", async () => {
    stateRef.current = makeState({
      grn: baseGrn({ head: "Marketing", sub_head: "Events" }),
      budgetHeaders: [{ id: "hdr-1", branch_id: "br-1", period_code: "2026-08", status: "active" }],
      budgetLines: [], // nothing anywhere for this head/sub-head
      costCentres: [{ id: "cc-X", cost_centre_code: "CCX", cost_centre_name: "CC X", branch_id: "br-1", active_status: 1 }],
    });
    const { grnSmartService } = await import("../grn-smart.service.js");
    await expect(
      grnSmartService.saveAllocations(
        "grn-1",
        { allocations: [{ costCentreId: "cc-X", quantity: 10, unitRate: 5 }] },
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
      grnSmartService.saveAllocations(
        "grn-1",
        { allocations: [{ costCentreId: "cc-X", quantity: 10, unitRate: 5 }] },
        "user-1",
        "branch_head"
      )
    ).rejects.toMatchObject({ code: "NO_BRANCH_BUDGET", statusCode: 409 });
  });

  it("3/4. own chosen line is exhausted, a sibling pooled line covers the rest — two inserts, same original cost centre, gross sums to target, each internally consistent", async () => {
    const lineA: FakeBudgetLine = {
      id: "line-A", budget_id: "hdr-1", head: "Office Supplies", sub_head: "Stationery",
      item_name: "Stationery Item A", cost_centre_id: "cc-A", cost_centre_name: "CC A", process_id: null,
      unit: "nos", unit_rate: 10, tax_treatment: "exclusive", gst_rate: 0, gst_type: "none",
      recoverable_tax_pct: 100, justification: "Approved", period_code: "2026-08",
      quantity: 1000, reserved_quantity: 980, consumed_quantity: 0,
      gross_amount: 10000, reserved_amount: 9800, consumed_amount: 0, // available: 20 qty / ₹200
    };
    const lineB: FakeBudgetLine = {
      id: "line-B", budget_id: "hdr-1", head: "Office Supplies", sub_head: "Stationery",
      item_name: "Stationery Item B (Pooled)", cost_centre_id: null, cost_centre_name: null, process_id: null,
      unit: "nos", unit_rate: 20, tax_treatment: "exclusive", gst_rate: 0, gst_type: "none",
      recoverable_tax_pct: 100, justification: "Approved", period_code: "2026-08",
      quantity: 1000, reserved_quantity: 0, consumed_quantity: 0,
      gross_amount: 20000, reserved_amount: 0, consumed_amount: 0, // available: 1000 qty / ₹20000
    };
    stateRef.current = makeState({
      grn: baseGrn(),
      budgetHeaders: [{ id: "hdr-1", branch_id: "br-1", period_code: "2026-08", status: "active" }],
      budgetLines: [lineA, lineB],
      costCentres: [{ id: "cc-A", cost_centre_code: "CCA", cost_centre_name: "CC A", branch_id: "br-1", active_status: 1 }],
    });
    const { grnSmartService } = await import("../grn-smart.service.js");
    const { calculateBudgetLine } = await import("../../process-pnl/branch-budget.service.js");

    await grnSmartService.saveAllocations(
      "grn-1",
      { allocations: [{ budgetLineId: "line-A", quantity: 100, unitRate: 10, remarks: "Order note" }] },
      "user-1",
      "branch_head"
    );

    const rows = stateRef.current.insertedAllocations;
    expect(rows).toHaveLength(2);

    // Both draws attribute to the ORIGINAL row's own cost centre (line-A's), never line-B's own
    // (null/pooled) cost centre.
    expect(rows[0].cost_centre_id).toBe("cc-A");
    expect(rows[1].cost_centre_id).toBe("cc-A");
    expect(rows[0].budget_line_id).toBe("line-A");
    expect(rows[1].budget_line_id).toBe("line-B");

    // Gross sums to the row's originally required grossTarget (₹1000: 100 qty × ₹10, 0% GST).
    const totalGross = Number(rows[0].amount_with_tax) + Number(rows[1].amount_with_tax);
    expect(totalGross).toBeCloseTo(1000, 6);

    // Remarks: first draw keeps the raiser's own text; the spillover draw gets an audit note.
    expect(rows[0].remarks).toBe("Order note");
    expect(String(rows[1].remarks)).toContain("Auto-allocated from branch aggregate headroom for Office Supplies/Stationery");

    // Neither draw is "unbudgeted" — the original row had a real budgetLineId.
    expect(rows[0].is_unbudgeted).toBe(0);
    expect(rows[1].is_unbudgeted).toBe(0);

    // Each insert's own base/tax/gross is internally consistent with calculateBudgetLine given
    // THAT insert's own quantity/unitRate/gstRate — re-derived independently here.
    const expectedA = calculateBudgetLine({
      head: "Office Supplies", subHead: "Stationery", itemName: lineA.item_name,
      quantity: Number(rows[0].quantity), unit: "nos", unitRate: Number(rows[0].unit_rate),
      taxTreatment: "exclusive", gstRate: 0, gstType: "none", recoverableTaxPct: 100, justification: "x",
    });
    expect(Number(rows[0].amount_without_tax)).toBeCloseTo(expectedA.baseAmount, 6);
    expect(Number(rows[0].amount_with_tax)).toBeCloseTo(expectedA.grossAmount, 6);
    expect(Number(rows[0].quantity)).toBeCloseTo(20, 6); // ₹200 / ₹10 per unit

    const expectedB = calculateBudgetLine({
      head: "Office Supplies", subHead: "Stationery", itemName: lineB.item_name,
      quantity: Number(rows[1].quantity), unit: "nos", unitRate: Number(rows[1].unit_rate),
      taxTreatment: "exclusive", gstRate: 0, gstType: "none", recoverableTaxPct: 100, justification: "x",
    });
    expect(Number(rows[1].amount_without_tax)).toBeCloseTo(expectedB.baseAmount, 6);
    expect(Number(rows[1].amount_with_tax)).toBeCloseTo(expectedB.grossAmount, 6);
    expect(Number(rows[1].quantity)).toBeCloseTo(40, 6); // ₹800 / ₹20 per unit
  });

  it("5. spillover draw's required quantity exceeds the sibling line's own available_quantity — throws, even though money headroom was sufficient", async () => {
    const lineA: FakeBudgetLine = {
      id: "line-A", budget_id: "hdr-1", head: "Office Supplies", sub_head: "Stationery",
      item_name: "Stationery Item A", cost_centre_id: "cc-A", cost_centre_name: "CC A", process_id: null,
      unit: "nos", unit_rate: 10, tax_treatment: "exclusive", gst_rate: 0, gst_type: "none",
      recoverable_tax_pct: 100, justification: "Approved", period_code: "2026-08",
      quantity: 1000, reserved_quantity: 980, consumed_quantity: 0,
      gross_amount: 10000, reserved_amount: 9800, consumed_amount: 0, // available: 20 qty / ₹200
    };
    const lineB: FakeBudgetLine = {
      id: "line-B", budget_id: "hdr-1", head: "Office Supplies", sub_head: "Stationery",
      item_name: "Stationery Item B (Pooled)", cost_centre_id: null, cost_centre_name: null, process_id: null,
      unit: "nos", unit_rate: 20, tax_treatment: "exclusive", gst_rate: 0, gst_type: "none",
      recoverable_tax_pct: 100, justification: "Approved", period_code: "2026-08",
      // Plenty of MONEY (₹20000) but only 35 units of quantity — the spillover draw needs 40.
      quantity: 35, reserved_quantity: 0, consumed_quantity: 0,
      gross_amount: 20000, reserved_amount: 0, consumed_amount: 0,
    };
    stateRef.current = makeState({
      grn: baseGrn(),
      budgetHeaders: [{ id: "hdr-1", branch_id: "br-1", period_code: "2026-08", status: "active" }],
      budgetLines: [lineA, lineB],
      costCentres: [{ id: "cc-A", cost_centre_code: "CCA", cost_centre_name: "CC A", branch_id: "br-1", active_status: 1 }],
    });
    const { grnSmartService } = await import("../grn-smart.service.js");

    await expect(
      grnSmartService.saveAllocations(
        "grn-1",
        { allocations: [{ budgetLineId: "line-A", quantity: 100, unitRate: 10 }] },
        "user-1",
        "branch_head"
      )
    ).rejects.toMatchObject({ code: "HEADROOM_EXCEEDED", statusCode: 409 });
  });

  it("6. normal case, no spillover needed — one insert, same cost centre/remarks as the input, no auto-generated note", async () => {
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

    await grnSmartService.saveAllocations(
      "grn-1",
      { allocations: [{ budgetLineId: "line-N", quantity: 5, unitRate: 50, remarks: "Straightforward" }] },
      "user-1",
      "branch_head"
    );

    const rows = stateRef.current.insertedAllocations;
    expect(rows).toHaveLength(1);
    expect(rows[0].cost_centre_id).toBe("cc-N");
    expect(rows[0].budget_line_id).toBe("line-N");
    expect(rows[0].remarks).toBe("Straightforward");
    expect(Number(rows[0].quantity)).toBeCloseTo(5, 6); // no spillover means the quantity round-trips exactly
    expect(Number(rows[0].amount_with_tax)).toBeCloseTo(295, 6); // 5*50=250 base, +18% = 295
  });

  it("unbudgeted row succeeds by drawing a REAL branch line when capacity exists — no longer a no-op success", async () => {
    const lineT: FakeBudgetLine = {
      id: "line-T", budget_id: "hdr-1", head: "Travel", sub_head: "Local Conveyance",
      item_name: "Local Conveyance", cost_centre_id: null, cost_centre_name: null, process_id: null,
      unit: "trip", unit_rate: 100, tax_treatment: "exclusive", gst_rate: 0, gst_type: "none",
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

    await grnSmartService.saveAllocations(
      "grn-1",
      { allocations: [{ costCentreId: "cc-X", quantity: 2, unitRate: 500 }] }, // no budgetLineId
      "user-1",
      "branch_head"
    );

    const rows = stateRef.current.insertedAllocations;
    expect(rows).toHaveLength(1);
    // FLAGGED CONCERN (see report): an unbudgeted row now gets a REAL, non-null budget_line_id —
    // it is no longer persisted NULL waiting for Finance Head to link one later.
    expect(rows[0].budget_line_id).toBe("line-T");
    expect(rows[0].budget_id).toBe("hdr-1");
    // is_unbudgeted still records that the RAISER picked no line, independent of budget_line_id.
    expect(rows[0].is_unbudgeted).toBe(1);
    // Cost-centre attribution is the raiser's own, not the funding line's (line-T is pooled/null).
    expect(rows[0].cost_centre_id).toBe("cc-X");
    expect(Number(rows[0].amount_with_tax)).toBeCloseTo(1000, 6); // 2 * 500, 0% GST
  });

  it("7. two rows with DIFFERENT head/sub-heads are looked up independently and do not interfere", async () => {
    const lineA: FakeBudgetLine = {
      id: "line-A", budget_id: "hdr-1", head: "Office Supplies", sub_head: "Stationery",
      item_name: "Stationery", cost_centre_id: "cc-A", cost_centre_name: "CC A", process_id: null,
      unit: "nos", unit_rate: 10, tax_treatment: "exclusive", gst_rate: 0, gst_type: "none",
      recoverable_tax_pct: 100, justification: "Approved", period_code: "2026-08",
      quantity: 1000, reserved_quantity: 0, consumed_quantity: 0,
      gross_amount: 10000, reserved_amount: 0, consumed_amount: 0,
    };
    const lineT: FakeBudgetLine = {
      id: "line-T", budget_id: "hdr-1", head: "Travel", sub_head: "Local Conveyance",
      item_name: "Local Conveyance", cost_centre_id: "cc-T", cost_centre_name: "CC T", process_id: null,
      unit: "trip", unit_rate: 50, tax_treatment: "exclusive", gst_rate: 0, gst_type: "none",
      recoverable_tax_pct: 100, justification: "Approved", period_code: "2026-08",
      quantity: 1000, reserved_quantity: 0, consumed_quantity: 0,
      gross_amount: 50000, reserved_amount: 0, consumed_amount: 0,
    };
    stateRef.current = makeState({
      grn: baseGrn(),
      budgetHeaders: [{ id: "hdr-1", branch_id: "br-1", period_code: "2026-08", status: "active" }],
      budgetLines: [lineA, lineT],
      costCentres: [
        { id: "cc-A", cost_centre_code: "CCA", cost_centre_name: "CC A", branch_id: "br-1", active_status: 1 },
        { id: "cc-T", cost_centre_code: "CCT", cost_centre_name: "CC T", branch_id: "br-1", active_status: 1 },
      ],
    });
    const { grnSmartService } = await import("../grn-smart.service.js");
    const { getHeadSubHeadCoverage } = await import("../../process-pnl/budget-headroom-gate.service.js");

    await grnSmartService.saveAllocations(
      "grn-1",
      {
        allocations: [
          { budgetLineId: "line-A", quantity: 10, unitRate: 10 }, // ₹100, Office Supplies/Stationery
          { budgetLineId: "line-T", quantity: 4, unitRate: 50 },  // ₹200, Travel/Local Conveyance
        ],
      },
      "user-1",
      "branch_head"
    );

    const rows = stateRef.current.insertedAllocations;
    expect(rows).toHaveLength(2);
    expect(rows[0].budget_line_id).toBe("line-A");
    expect(rows[0].cost_centre_id).toBe("cc-A");
    expect(Number(rows[0].amount_with_tax)).toBeCloseTo(100, 6);
    expect(rows[1].budget_line_id).toBe("line-T");
    expect(rows[1].cost_centre_id).toBe("cc-T");
    expect(Number(rows[1].amount_with_tax)).toBeCloseTo(200, 6);

    // getHeadSubHeadCoverage was consulted once per row, with each row's OWN head/sub-head — not
    // once for the whole GRN, and not sharing one aggregate across genuinely different heads.
    const coverageMock = getHeadSubHeadCoverage as unknown as { mock: { calls: unknown[][] } };
    expect(coverageMock.mock.calls).toHaveLength(2);
    expect(coverageMock.mock.calls[0]).toEqual(["br-1", "2026-08", "Office Supplies", "Stationery"]);
    expect(coverageMock.mock.calls[1]).toEqual(["br-1", "2026-08", "Travel", "Local Conveyance"]);
  });

  it("two rows sharing ONE head/sub-head do not double-spend the branch aggregate within a single save", async () => {
    // Regression guard: without netting out what an earlier row in the SAME save already drew,
    // this second row would re-read line-S's availability fresh from "the DB" (unaffected by the
    // first row's already-decided draw) and wrongly succeed, overcommitting the branch aggregate
    // to 800 + 300 = 1100 against a real capacity of 1000.
    const lineS: FakeBudgetLine = {
      id: "line-S", budget_id: "hdr-1", head: "Office Supplies", sub_head: "Stationery",
      item_name: "Stationery (Pooled)", cost_centre_id: null, cost_centre_name: null, process_id: null,
      unit: "nos", unit_rate: 10, tax_treatment: "exclusive", gst_rate: 0, gst_type: "none",
      recoverable_tax_pct: 100, justification: "Approved", period_code: "2026-08",
      quantity: 100, reserved_quantity: 0, consumed_quantity: 0,
      gross_amount: 1000, reserved_amount: 0, consumed_amount: 0, // available: ₹1000 total
    };
    stateRef.current = makeState({
      grn: baseGrn(),
      budgetHeaders: [{ id: "hdr-1", branch_id: "br-1", period_code: "2026-08", status: "active" }],
      budgetLines: [lineS],
      costCentres: [],
    });
    const { grnSmartService } = await import("../grn-smart.service.js");

    await expect(
      grnSmartService.saveAllocations(
        "grn-1",
        {
          allocations: [
            { budgetLineId: "line-S", quantity: 80, unitRate: 10 }, // ₹800 — leaves ₹200
            { budgetLineId: "line-S", quantity: 30, unitRate: 10 }, // ₹300 — only ₹200 remains
          ],
        },
        "user-1",
        "branch_head"
      )
    ).rejects.toMatchObject({ code: "HEADROOM_EXCEEDED", statusCode: 409 });
  });
});
