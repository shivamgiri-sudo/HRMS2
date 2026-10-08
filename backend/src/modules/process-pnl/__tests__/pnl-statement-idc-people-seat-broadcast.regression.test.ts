import { describe, expect, it } from "vitest";
import { getStatement } from "../pnl-statement.service.js";

/**
 * Regression test for the idc/people/seat branch-broadcast bug (fixed 2026-09-01, "A6").
 *
 * Identical defect class to the A3 revenue-broadcast fix (pnl-statement-detail-agreement.
 * regression.test.ts) and to the branch-pool broadcast fixed upstream in 8172b98a — but this one
 * lived inside pnl-statement.service.ts's own enrichColumn()/pick() helper and was left
 * unapplied to idc/people/seat when A3 was fixed for revenue earlier the same day. 8172b98a's
 * commit message explicitly flagged it as a known follow-up:
 *
 *   "this surfaced a DIFFERENT, pre-existing bug in enrichColumn()'s pick() helper (idc/people/
 *   seat actuals still fall back to source.byBranch.get(branchId) for a process column that
 *   lacks a per-process entry ... that makes the Process view's total_cost/agent_salary sum well
 *   above the Branch view's total on branches with several processes (NOIDA: process-sum
 *   agent_salary 14,042,821 vs branch total 7,082,707)."
 *
 * Root cause: pick() (idc, seat) and the people-cost snapshot lookup both fell back to
 * source.byBranch.get(branchId) whenever byProcess had no entry for the requested process —
 * silently crediting a process with NO per-process idc/people/seat data with its WHOLE branch's
 * total, instead of showing 0. On a branch with several processes lacking that per-process data,
 * this happened for EVERY one of them, so the process-view column sum ran to a multiple of the
 * real branch total.
 *
 * This test plants two processes on one branch: PROC_WITH_DATA has genuine per-process idc/
 * people/seat entries; PROC_NO_DATA has none — only the branch-wide totals exist. Before the fix,
 * PROC_NO_DATA silently inherited the entire branch figure for all three; after the fix it shows
 * 0/undefined-snapshot instead, and the process-view sum for idc no longer exceeds the real
 * branch total.
 */

const BRANCH_ID = "branch-bcast-2";
const PROC_WITH_DATA = "proc-with-data";
const PROC_NO_DATA = "proc-no-data";

// The genuine per-process figure for PROC_WITH_DATA.
const OWN_IDC = 50_000;
const OWN_SEAT = 20_000;
// The WHOLE branch's idc/seat total — large, and must never leak onto PROC_NO_DATA.
const BRANCH_WIDE_IDC = 807_669.06;
const BRANCH_WIDE_SEAT = 300_000;

function closedPeriod(): string {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 2);
  return d.toISOString().slice(0, 7);
}

const emptyActuals = () => ({
  byBranch: new Map<string, number>(),
  byProcess: new Map<string, number>(),
  byCostCentre: new Map<string, number>(),
});

/** Actuals map shaped exactly like the live bug: one process has its own entry, the branch also
 *  carries a total, but the OTHER process has nothing at process grain. */
function actualsWithOneProcessAndBranch(ownAmount: number, branchAmount: number) {
  return {
    byBranch: new Map([[BRANCH_ID, branchAmount]]),
    byProcess: new Map([[PROC_WITH_DATA, ownAmount]]),
    byCostCentre: new Map<string, number>(),
  };
}

function seatActuals(ownAmount: number, branchAmount: number) {
  return {
    ...actualsWithOneProcessAndBranch(ownAmount, branchAmount),
    billableEmployees: 0,
    rateMissingEmployees: 0,
    unresolvedEmployees: 0,
    notSeatBilledEmployees: 0,
    rateMissingByKey: emptyActuals(),
  };
}

function component(key: string, field: string, order: number) {
  return {
    component_key: key, display_name: key, section_key: "cost",
    parent_component_key: null, display_order: order, component_type: "SOURCE_ACTUAL",
    source_field: field, format_type: "CURRENCY", sign_convention: "+",
    is_subtotal: 0, active_status: 1,
  };
}

function row(processId: string) {
  return {
    processId, processName: processId, branchId: BRANCH_ID, branchName: "Branch B2",
    processStatus: "active",
    recognizedRevenue: 0, agentSalary: 0, dscSalary: 0, bmcSalary: 0,
    dscPeople: 0, bmcPeople: 0, dscNonPeople: 0, bmcNonPeople: 0,
    activeHc: 5,
  };
}

async function buildStatement() {
  const period = closedPeriod();
  return getStatement({ period, branchId: BRANCH_ID } as never, "process", {
    getComponents: async () => [
      component("total_idc", "indirectCostTotal", 1),
      component("seat_revenue_earned", "seatRevenueEarned", 2),
      component("agent_salary", "agentSalary", 3),
    ],
    getSummary: async () => ({
      rows: [row(PROC_WITH_DATA), row(PROC_NO_DATA)],
      generatedAt: new Date().toISOString(),
    }),
    // The live bug's exact shape: PROC_WITH_DATA has its own entry, PROC_NO_DATA has none, and
    // the branch total (which must never leak onto PROC_NO_DATA) is large.
    getIndirectCost: async () => actualsWithOneProcessAndBranch(OWN_IDC, BRANCH_WIDE_IDC),
    getDriverRevenue: async () => emptyActuals(),
    getInvoicedRevenue: async () => emptyActuals(),
    getSeatRevenue: async () => seatActuals(OWN_SEAT, BRANCH_WIDE_SEAT),
    // Same shape for the people-cost snapshot: PROC_WITH_DATA has its own bucket, PROC_NO_DATA
    // has none, only a branch-wide bucket exists.
    getPeopleCost: async () => ({
      byBranch: new Map([[BRANCH_ID, { agent_salary: 400_000, dsc_people: 0, bmc_people: 0 }]]),
      byProcess: new Map([[PROC_WITH_DATA, { agent_salary: 60_000, dsc_people: 0, bmc_people: 0 }]]),
      coverageByBranch: new Map(),
      coverageByProcess: new Map(),
      asOfDate: null,
    }) as never,
    getProcessSummary: async () => ({ rows: [] }),
  } as never);
}

describe("P&L Statement idc/people/seat branch-broadcast (regression, 2026-09-01 A6 fix)", () => {
  it("gives a process with no per-process idc entry its OWN 0, never the whole branch's idc", async () => {
    const statement = await buildStatement();
    const idcRow = statement.rows.find((r) => r.componentKey === "total_idc")!;
    expect(idcRow.values[PROC_WITH_DATA]).toBe(OWN_IDC);
    expect(
      idcRow.values[PROC_NO_DATA],
      "a process with no per-process idc entry must show 0, not the whole branch's idc total",
    ).toBe(0);
    expect(idcRow.values[PROC_NO_DATA]).not.toBe(BRANCH_WIDE_IDC);
  });

  it("gives a process with no per-process seat entry its OWN 0, never the whole branch's seat revenue", async () => {
    const statement = await buildStatement();
    const seatRow = statement.rows.find((r) => r.componentKey === "seat_revenue_earned")!;
    expect(seatRow.values[PROC_WITH_DATA]).toBe(OWN_SEAT);
    expect(seatRow.values[PROC_NO_DATA]).toBe(0);
    expect(seatRow.values[PROC_NO_DATA]).not.toBe(BRANCH_WIDE_SEAT);
  });

  it("gives a process with no per-process people snapshot the upstream row figure, never the whole branch's snapshot", async () => {
    const statement = await buildStatement();
    const agentRow = statement.rows.find((r) => r.componentKey === "agent_salary")!;
    // PROC_WITH_DATA: snapshot present for this process -> uses the snapshot's own figure.
    expect(agentRow.values[PROC_WITH_DATA]).toBe(60_000);
    // PROC_NO_DATA: no snapshot entry of its own -> falls back to the canonical row's own
    // agentSalary (0 here), never the branch's 400,000 snapshot bucket.
    expect(
      agentRow.values[PROC_NO_DATA],
      "a process with no per-process people snapshot must not inherit the whole branch's snapshot",
    ).toBe(0);
    expect(agentRow.values[PROC_NO_DATA]).not.toBe(400_000);
  });

  it("process-view idc sum no longer exceeds the real total (the live NOIDA overstatement shape)", async () => {
    const statement = await buildStatement();
    const idcRow = statement.rows.find((r) => r.componentKey === "total_idc")!;
    const processSum = Object.values(idcRow.values).reduce((a, v) => a + Number(v ?? 0), 0);
    // Only PROC_WITH_DATA's own figure should be counted; PROC_NO_DATA contributes 0, not a
    // second copy of the branch total.
    expect(processSum).toBe(OWN_IDC);
    expect(processSum).toBeLessThan(BRANCH_WIDE_IDC);
  });
});
