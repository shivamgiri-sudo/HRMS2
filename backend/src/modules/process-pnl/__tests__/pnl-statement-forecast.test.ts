import { describe, expect, it, vi } from "vitest";
import { getStatement } from "../pnl-statement.service.js";

/**
 * The Statement under the revenue-forecast rule (owner 2026-10-06), same as Live P&L: a cost centre
 * with an approved forecast earns the forecast (open) or closed amount; its own invoiced / planned
 * revenue is taken out so nothing is counted twice; other cost centres keep the old rule.
 *
 * Original header of the sibling suite (pnl-revenue-basis.test.ts), kept for the period helpers:
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
/** The month just closed: still inside the seat-estimate window (current + previous month). */
const LAST = period(-1);

/** Process P1 = cost centres CC1 (forecast) + CC2 (no forecast). */
const split = (cc1: number, cc2: number) => ({
  byBranch: new Map([[BRANCH_ID, cc1 + cc2]]),
  byProcess: new Map([[PROCESS_ID, cc1 + cc2]]),
  byCostCentre: new Map([["CC1", cc1], ["CC2", cc2]]),
  ccKeys: new Map([["CC1", { branchId: BRANCH_ID, processId: PROCESS_ID }], ["CC2", { branchId: BRANCH_ID, processId: PROCESS_ID }]]),
});
const forecastOf = (amount: number, state: "OPEN" | "CLOSED") => ({
  byBranch: new Map([[BRANCH_ID, amount]]), byProcess: new Map([[PROCESS_ID, amount]]),
  byCostCentre: new Map([["CC1", amount]]),
  ccKeys: new Map([["CC1", { branchId: BRANCH_ID, processId: PROCESS_ID }]]),
  state: new Map([["CC1", state]]),
});

async function statementFor(periodCode: string, viewBy: "process" | "branch", opts: {
  planned: [number, number]; invoiced: [number, number]; forecast?: ReturnType<typeof forecastOf>; rowRevenue?: number;
}) {
  const componentRow = (key: string, field: string, order: number) => ({
    component_key: key, display_name: key, section_key: "revenue",
    parent_component_key: null, display_order: order, component_type: "SOURCE_ACTUAL",
    source_field: field, format_type: "CURRENCY", sign_convention: "+",
    is_subtotal: 0, active_status: 1,
  });
  return getStatement({ period: periodCode } as never, viewBy, {
    getComponents: async () => [componentRow("recognized_revenue", "recognizedRevenue", 1)],
    getSummary: async () => ({
      rows: [{ processId: PROCESS_ID, processName: "P1", branchId: BRANCH_ID, branchName: "B1",
        recognizedRevenue: opts.rowRevenue ?? 0, directPeopleCost: 0, activeHc: 10 }],
    }),
    getIndirectCost: async () => split(0, 0),
    getDriverRevenue: async () => split(...opts.planned),
    getInvoicedRevenue: async () => split(...opts.invoiced),
    getSeatRevenue: async () => ({ ...split(0, 0), billableEmployees: 0, rateMissingEmployees: 0, unresolvedEmployees: 0, notSeatBilledEmployees: 0, rateMissingByKey: split(0, 0) }),
    getPeopleCost: async () => ({ byBranch: new Map(), byProcess: new Map() }) as never,
    getRevenueEstimate: async () => split(0, 0),
    getForecastRevenue: async () => opts.forecast ?? forecastOf(0, "OPEN"),
    getProcessSummary,
  } as never);
}

const revenueOf = (statement: Awaited<ReturnType<typeof statementFor>>, column: string) =>
  statement.rows.find((r) => r.componentKey === "recognized_revenue")?.values[column];

describe("statement revenue with approved forecasts", () => {
  it("closed month: invoiced of the other cost centres + the forecast cost centre's closed amount", async () => {
    // CC1 invoiced 50 but is closed at 80 -> 80 replaces 50; CC2 invoiced 30 stays.
    const s = await statementFor(CLOSED, "process", { planned: [0, 0], invoiced: [50, 30], forecast: forecastOf(80, "CLOSED") });
    expect(revenueOf(s, PROCESS_ID)).toBe(110);
    expect(s.forecastRevenue).toEqual({ costCentres: 1, amount: 80, closed: 1 });
  });

  it("open month: planned of the others + the open forecast, never the canonical row's figure", async () => {
    const s = await statementFor(OPEN, "process", { planned: [100, 40], invoiced: [0, 0], rowRevenue: 999, forecast: forecastOf(120, "OPEN") });
    expect(revenueOf(s, PROCESS_ID)).toBe(160);
  });

  it("branch view agrees with the process view", async () => {
    const s = await statementFor(CLOSED, "branch", { planned: [0, 0], invoiced: [50, 30], forecast: forecastOf(80, "CLOSED") });
    expect(revenueOf(s, BRANCH_ID)).toBe(110);
  });

  it("no forecast: unchanged (invoiced on a closed month)", async () => {
    const s = await statementFor(CLOSED, "process", { planned: [0, 0], invoiced: [50, 30], forecast: { ...forecastOf(0, "OPEN"), byBranch: new Map(), byProcess: new Map(), byCostCentre: new Map(), state: new Map() } });
    expect(revenueOf(s, PROCESS_ID)).toBe(80);
    expect(s.forecastRevenue.costCentres).toBe(0);
  });
});
