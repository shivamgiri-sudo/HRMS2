import { describe, expect, it, vi } from "vitest";
import { getStatement } from "../pnl-statement.service.js";

/**
 * Branch revenue on the Statement is the reconciled (Live P&L / CEO / Branch Review) figure for every period.
Header of the sibling suite: a cost centre
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

const snap = (agent: number) => ({ agent_salary: agent, dsc_people: 0, bmc_people: 0 });

async function statementWithPeople(byBranch: Map<string, ReturnType<typeof snap>>, noBranchPeople: number) {
  const componentRow = { component_key: "agent_salary", display_name: "Agent", section_key: "cost", parent_component_key: null,
    display_order: 1, component_type: "SOURCE_ACTUAL", source_field: "agentSalary", format_type: "CURRENCY", sign_convention: "+", is_subtotal: 0, active_status: 1 };
  return getStatement({ period: CLOSED } as never, "branch", {
    getComponents: async () => [componentRow],
    getSummary: async () => ({ rows: [
      { processId: PROCESS_ID, processName: "P1", branchId: BRANCH_ID, branchName: "B1", recognizedRevenue: 0, agentSalary: 0, activeHc: 10 },
      { processId: "p-nobranch", processName: "Pool", branchId: null, branchName: null, recognizedRevenue: 0, agentSalary: noBranchPeople, activeHc: 3 },
    ] }),
    getIndirectCost: async () => split(0, 0), getDriverRevenue: async () => split(0, 0), getInvoicedRevenue: async () => split(0, 0),
    getSeatRevenue: async () => ({ ...split(0, 0), billableEmployees: 0, rateMissingEmployees: 0, unresolvedEmployees: 0, notSeatBilledEmployees: 0, rateMissingByKey: split(0, 0) }),
    getPeopleCost: async () => ({ byBranch, byProcess: new Map() }) as never,
    getRevenueEstimate: async () => split(0, 0),
    getForecastRevenue: async () => ({ ...forecastOf(0, "OPEN"), byBranch: new Map(), byProcess: new Map(), byCostCentre: new Map(), state: new Map() }),
    getBranchRevenue: async () => undefined,
    getProcessSummary,
  } as never);
}
const agent = (s: Awaited<ReturnType<typeof statementWithPeople>>, col: string) => s.rows.find((r) => r.componentKey === "agent_salary")?.values[col];

describe("statement branch view: people cost is counted once", () => {
  it("the Unassigned column does not re-add payroll the real branch columns already carry", async () => {
    const s = await statementWithPeople(new Map([[BRANCH_ID, snap(1000)]]), 500);
    expect(agent(s, BRANCH_ID)).toBe(1000);
    expect(agent(s, "unassigned")).toBe(0);
  });
  it("it keeps genuinely branchless payroll (the empty-key bucket)", async () => {
    const s = await statementWithPeople(new Map([[BRANCH_ID, snap(1000)], ["", snap(70)]]), 500);
    expect(agent(s, "unassigned")).toBe(70);
  });
  it("with no people snapshot at all, the upstream rows still supply the figure (unchanged behaviour)", async () => {
    const s = await statementWithPeople(new Map(), 500);
    expect(agent(s, "unassigned")).toBe(500);
  });
});
