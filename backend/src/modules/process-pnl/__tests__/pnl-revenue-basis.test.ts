import { describe, expect, it, vi } from "vitest";
import { getStatement } from "../pnl-statement.service.js";

/**
 * Which revenue figure the statement publishes, and when.
 *
 * Three sources compete: a figure already on the row, what was actually invoiced, and
 * planned_headcount x revenue_rate_per_head. Picking wrong is not a rounding error — the driver
 * exists for three periods while real invoicing runs from April, so preferring it on a closed
 * month replaces Rs 355 lakh of billed revenue with nothing, and preferring invoicing on an open
 * month reports a collapse that is only an unfinished billing cycle.
 *
 * These tests pin the rule in both directions. They derive their periods from the clock rather
 * than hardcoding one, because a test written in an open month silently changes meaning once that
 * month closes — which has already happened twice in this suite.
 */

const { queryRows, tableExists, getSummary, getProcessSummary } = vi.hoisted(() => ({
  queryRows: vi.fn(),
  tableExists: vi.fn(),
  getSummary: vi.fn(),
  getProcessSummary: vi.fn(),
}));

vi.mock("../../../shared/dbHelpers.js", () => ({ queryRows, tableExists }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn().mockResolvedValue([[], []]) } }));
vi.mock("../canonical-pnl.service.js", () => ({ canonicalPnlService: { getSummary } }));
vi.mock("../process-lob.service.js", () => ({ processLobService: { getProcessSummary } }));

const PROCESS_ID = "proc-1";
const BRANCH_ID = "branch-1";

/** A period that is unambiguously closed / open right now, whenever "now" is. */
function period(offsetMonths: number): string {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offsetMonths);
  return d.toISOString().slice(0, 7);
}
const CLOSED = period(-2);
const OPEN = period(0);

const actuals = (amount: number) => ({
  byBranch: new Map([[BRANCH_ID, amount]]),
  byProcess: new Map([[PROCESS_ID, amount]]),
  byCostCentre: new Map<string, number>(),
});

const seatActuals = (earned: number, rateMissing: number) => ({
  ...actuals(earned),
  billableEmployees: 1,
  rateMissingEmployees: rateMissing,
  unresolvedEmployees: 0,
  notSeatBilledEmployees: 0,
  rateMissingByKey: actuals(rateMissing),
});

async function statementFor(periodCode: string, opts: {
  planned: number; invoiced: number; seatEarned?: number; rateMissing?: number;
}) {
  const componentRow = (key: string, field: string, order: number) => ({
    component_key: key, display_name: key, section_key: "revenue",
    parent_component_key: null, display_order: order, component_type: "SOURCE_ACTUAL",
    source_field: field, format_type: "CURRENCY", sign_convention: "+",
    is_subtotal: 0, active_status: 1,
  });
  const components = [
    componentRow("recognized_revenue", "recognizedRevenue", 1),
    componentRow("invoiced_revenue", "invoicedRevenue", 2),
    componentRow("seat_revenue_earned", "seatRevenueEarned", 3),
    componentRow("seat_shortfall", "seatShortfall", 4),
  ];
  return getStatement({ period: periodCode } as never, "process", {
    getComponents: async () => components,
    getSummary: async () => ({
      rows: [{
        processId: PROCESS_ID, processName: "P1", branchId: BRANCH_ID, branchName: "B1",
        recognizedRevenue: 0, directPeopleCost: 0, activeHc: 10,
      }],
    }),
    getIndirectCost: async () => actuals(0),
    getDriverRevenue: async () => actuals(opts.planned),
    getInvoicedRevenue: async () => actuals(opts.invoiced),
    getSeatRevenue: async () => seatActuals(opts.seatEarned ?? 0, opts.rateMissing ?? 0),
    getPeopleCost: async () => ({ byBranch: new Map(), byProcess: new Map() }) as never,
    getProcessSummary,
  } as never);
}

const revenueOf = (statement: Awaited<ReturnType<typeof statementFor>>) =>
  statement.rows.find((r) => r.componentKey === "recognized_revenue")?.values[PROCESS_ID];

describe("statement revenue basis", () => {
  it("uses what was actually invoiced once the month has closed", async () => {
    const statement = await statementFor(CLOSED, { planned: 11_900_000, invoiced: 35_537_000 });
    expect(
      revenueOf(statement),
      "a closed month must report billed revenue, not the budgeting driver",
    ).toBe(35_537_000);
  });

  it("keeps the planned figure while the month is still running", async () => {
    // Invoicing lags delivery: July showed Rs 77 lakh mid-month against a Rs 325-372 lakh run
    // rate. Switching to it live would report a collapse that has not happened.
    const statement = await statementFor(OPEN, { planned: 11_900_000, invoiced: 7_705_000 });
    expect(revenueOf(statement)).toBe(11_900_000);
  });

  it("falls back to planned on a closed month with no invoicing at all", async () => {
    const statement = await statementFor(CLOSED, { planned: 11_900_000, invoiced: 0 });
    expect(
      revenueOf(statement),
      "no invoice data must not zero the revenue line",
    ).toBe(11_900_000);
  });

  it("publishes a seat shortfall only when every billable person has a rate", async () => {
    const withGaps = await statementFor(CLOSED, {
      planned: 11_900_000, invoiced: 35_537_000, seatEarned: 8_180_000, rateMissing: 512,
    });
    const complete = await statementFor(CLOSED, {
      planned: 11_900_000, invoiced: 35_537_000, seatEarned: 8_180_000, rateMissing: 0,
    });
    // Rates cover 7 of ~95 trading cost centres, so a blanket subtraction would report roughly
    // Rs 290 lakh of "lost revenue" that is really unconfigured rates.
    const shortfallOf = (st: Awaited<ReturnType<typeof statementFor>>) =>
      st.rows.find((r) => r.componentKey === "seat_shortfall")?.values[PROCESS_ID] ?? null;
    expect(shortfallOf(withGaps)).toBeNull();
    expect(shortfallOf(complete)).toBe(11_900_000 - 8_180_000);
  });
});
