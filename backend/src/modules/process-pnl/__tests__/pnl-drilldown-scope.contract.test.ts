import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the drilldown is allowed to answer, and with which rows.
 *
 * The service has always been able to return row-level detail; nothing called it, so none of its
 * edges were pinned. Wiring it to a route made three of them load-bearing, and each has a way of
 * failing that looks like a working screen:
 *
 *   1. BUDGET SCOPE. budgetDrilldownRows() used to hard-require branchId and threw for a process
 *      or cost-centre scope, so a budget cell on a process-grouped statement could not be opened
 *      at all. finance_budget_line_snapshot has no cost-centre column — the centre's code sits in
 *      expense_type_name — so the scope has to go through cost_centre_master. Measured live
 *      2026-09: all 93 of that period's CostCenter lines join cleanly on that code.
 *
 *   2. PAYROLL PRIVACY. The people drilldown's natural grain is one named employee against their
 *      gross plus employer contributions. CLAUDE.md forbids that on management surfaces, so a
 *      caller entitled to the P&L but not to payroll must get the same total grouped by
 *      designation instead. The failure mode is silent: a component that forgets the flag leaks
 *      salary while looking correct, which is why the decision lives in the route and the
 *      aggregated query is asserted here to carry no employee identity at all.
 *
 *   3. BUCKETED PEOPLE COST. Agent Salary, DSC People and BMC People are three separate statement
 *      lines whose split exists only on pnl_running_salary_snapshot.pnl_bucket. An unbucketed
 *      drilldown returns everyone in scope, whose total is the sum of all three — so clicking
 *      "DSC People" would open a list totalling several times the cell it came from. Verified live
 *      on 2026-08 for one branch: agent 52,32,428.16 + dsc 8,32,603.38 + bmc 2,24,265.52 =
 *      62,89,297.06, which is exactly the unbucketed total for the same scope.
 */

const { execute, tableExists } = vi.hoisted(() => ({
  execute: vi.fn(),
  tableExists: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists }));
// The seat-rate estimate is its own service (tested there); only its answer matters here.
const { getSeatBillingEstimate } = vi.hoisted(() => ({ getSeatBillingEstimate: vi.fn() }));
vi.mock("../pnl-seat-billing.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../pnl-seat-billing.service.js")>()),
  getSeatBillingEstimate,
}));
// Pin "today" so the open estimate window is deterministic: 2026-08 and 2026-09 are inside it.
vi.mock("../../../shared/istDate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/istDate.js")>()),
  getCurrentDateIST: () => "2026-09-15",
}));

import { getPnlDrilldown } from "../pnl-drilldown.service.js";

const PERIOD = "2026-08";
const BRANCH_ID = "branch-1";
const PROCESS_ID = "proc-1";
const COST_CENTRE_ID = "cc-1";

beforeEach(() => {
  execute.mockReset();
  tableExists.mockReset();
  tableExists.mockResolvedValue(true);
  execute.mockResolvedValue([[], []]);
  getSeatBillingEstimate.mockReset();
});

/** Every SQL string the call issued, joined — enough to assert on predicates and parameters. */
function sqlCalls(): { sql: string; params: unknown[] }[] {
  return execute.mock.calls.map(([sql, params]) => ({ sql: String(sql), params: (params ?? []) as unknown[] }));
}

describe("budget drilldown scope", () => {
  /*
   * 2026-09-23: the drawer reads pnl-budget-source.ts readBudgetEntries(), the same reader as Live
   * P&L's budget cells and CEO Overview. Fixture: branch-1 has budget ONLY in the db_bill mirror
   * (two cost-centre lines on budget 11, one on budget 12 shared with another centre, plus top-ups);
   * branch-2 has an ACTIVE HRMS budget, so its mirror rows must never appear.
   */
  const mirrorLines = [
    { bill_source_id: 1, budget_source_id: 11, expense_type_name: "CC/1", amount: 1000, branch_name: "B ONE", branch_id: BRANCH_ID, cost_centre_id: COST_CENTRE_ID },
    { bill_source_id: 2, budget_source_id: 11, expense_type_name: "CC/1", amount: 500, branch_name: "B ONE", branch_id: BRANCH_ID, cost_centre_id: COST_CENTRE_ID },
    { bill_source_id: 3, budget_source_id: 12, expense_type_name: "CC/1", amount: 200, branch_name: "B ONE", branch_id: BRANCH_ID, cost_centre_id: COST_CENTRE_ID },
    { bill_source_id: 4, budget_source_id: 12, expense_type_name: "CC/OTHER", amount: 300, branch_name: "B ONE", branch_id: BRANCH_ID, cost_centre_id: "cc-other" },
    { bill_source_id: 5, budget_source_id: 21, expense_type_name: "CC/2", amount: 9999, branch_name: "B TWO", branch_id: "branch-2", cost_centre_id: "cc-2" },
  ];
  const mirrorTopUps = [
    { bill_source_id: 11, reopen_additional_amount: 36500, branch_name: "B ONE", branch_id: BRANCH_ID },
    { bill_source_id: 12, reopen_additional_amount: 99999, branch_name: "B ONE", branch_id: BRANCH_ID },
    { bill_source_id: 21, reopen_additional_amount: 5555, branch_name: "B TWO", branch_id: "branch-2" },
  ];
  const hrmsLines = [
    { budget_id: "fbh-2", branch_id: "branch-2", branch_name: "B Two", line_id: "l1", allocation_id: null,
      head: "Admin", sub_head: "Rent", item_name: "Floor 2", cost_centre_id: "cc-2", cost_centre_code: "CC/2", amount: 4000 },
    { budget_id: "fbh-2", branch_id: "branch-2", branch_name: "B Two", line_id: "l2", allocation_id: null,
      head: "Admin", sub_head: null, item_name: "Common area", cost_centre_id: null, cost_centre_code: null, amount: 600 },
  ];

  beforeEach(() => {
    execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes("AS code") && !q.includes("finance_budget")) {
        return [[{ code: (params ?? [])[0] === "cc-2" ? "CC/2" : "CC/1" }], []];
      }
      if (q.includes("FROM finance_budget_header h") && q.includes("JOIN finance_budget_line l")) return [hrmsLines, []];
      if (q.includes("FROM finance_budget_header h")) return [[{ id: "fbh-2", branch_id: "branch-2", branch_name: "B Two" }], []];
      if (q.includes("FROM finance_budget_line_snapshot l")) return [mirrorLines, []];
      if (q.includes("reopen_additional_amount <> 0")) return [mirrorTopUps, []];
      return [[], []];
    });
  });

  it("branch scope lists every line of that branch plus its header-level top-ups", async () => {
    const result = await getPnlDrilldown({ metric: "budget", period: PERIOD, branchId: BRANCH_ID });
    expect(result.total, "a branch-scoped budget drilldown must include sanctioned top-ups or it under-totals")
      .toBe(1000 + 500 + 200 + 300 + 36500 + 99999);
    expect(result.rows.some((r) => r.label === "Sanctioned top-up")).toBe(true);
  });

  it("a branch with an active HRMS budget shows the HRMS lines only, never its mirror rows", async () => {
    const result = await getPnlDrilldown({ metric: "budget", period: PERIOD, branchId: "branch-2" });
    expect(result.rows.map((r) => r.amount).sort((a, b) => a - b)).toEqual([600, 4000]);
    expect(result.total).toBe(4600);
    expect(result.rows.every((r) => String(r.detail).includes("HRMS budget"))).toBe(true);
  });

  it("cost-centre / process scope matches lines on the centre's code, and a top-up only when its budget funds nothing else", async () => {
    // A top-up is recorded against the budget header with no cost centre of its own. Attributing a
    // SHARED budget's top-up (budget 12) to one scope would inflate it by another scope's money, so
    // that is left out rather than guessed. Budget 11's every line is in scope, so its top-up is
    // the scope's whole — the same rule as the CEO focus panel's budget (audit item 16).
    for (const scope of [{ processId: PROCESS_ID }, { costCentreId: COST_CENTRE_ID }]) {
      const result = await getPnlDrilldown({ metric: "budget", period: PERIOD, ...scope });
      expect(result.rows.map((r) => r.amount).sort((a, b) => a - b)).toEqual([200, 500, 1000, 36500]);
      expect(result.total).toBe(38200);
    }
  });

  it("cost-centre scope on an HRMS-budgeted centre reads HRMS lines only", async () => {
    const result = await getPnlDrilldown({ metric: "budget", period: PERIOD, costCentreId: "cc-2" });
    expect(result.total).toBe(4000);
  });
});

describe("people drilldown — payroll privacy", () => {
  it("returns one row per named employee only when the caller is entitled to payroll", async () => {
    execute.mockResolvedValueOnce([
      [{ id: "l1", employee_code: "E1", full_name: "A Person", cost_center_code: "CC1", amount: "1000.00" }],
      [],
    ]);

    const result = await getPnlDrilldown({ metric: "people", period: PERIOD, processId: PROCESS_ID });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].label).toBe("A Person");
    expect(result.total).toBe(1000);
  });

  it("groups by designation — with no employee identity in the query — for everyone else", async () => {
    execute.mockResolvedValueOnce([
      [{ designation_name: "Agent", headcount: 12, amount: "12000.00" }],
      [],
    ]);

    const result = await getPnlDrilldown({
      metric: "people", period: PERIOD, processId: PROCESS_ID, aggregatePeople: true,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].label).toBe("Agent");
    expect(result.rows[0].detail).toContain("12 employees");
    expect(result.total).toBe(12000);

    const sql = sqlCalls()[0].sql;
    expect(sql).toContain("GROUP BY designation_name");
    // The whole point: no way for a name or code to reach the response.
    expect(sql).not.toContain("full_name");
    expect(sql).not.toContain("employee_code");
  });
});

describe("people drilldown — falls back to the running snapshot for an open period", () => {
  it("reads pnl_running_salary_snapshot when payroll has not run, and flags the rows estimated", async () => {
    // Live on 2026-09-03 the latest salary_prep_run was 2026-07, so both 2026-08 and 2026-09 have
    // no posted payroll while the statement still shows real people cost from the snapshot. Without
    // this fallback the drawer rendered "None" under a populated cell.
    execute
      .mockResolvedValueOnce([[], []]) // no posted payroll lines
      .mockResolvedValueOnce([
        [{ id: "s1", employee_code: "E1", designation_name: "Agent", pnl_bucket: "agent_salary",
           as_of_date: "2026-08-31", amount: "900.00", full_name: "A Person" }],
        [],
      ]);

    const result = await getPnlDrilldown({ metric: "people", period: PERIOD, processId: PROCESS_ID });

    expect(result.total).toBe(900);
    expect(result.hasEstimatedRows, "an accrual is not a posted payslip and must say so").toBe(true);
    expect(sqlCalls()[1].sql).toContain("pnl_running_salary_snapshot");
  });

  it("reports nothing rather than inventing rows when neither source has data", async () => {
    const result = await getPnlDrilldown({ metric: "people", period: PERIOD, branchId: BRANCH_ID });
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasEstimatedRows).toBe(false);
  });
});

describe("people drilldown — bucketed to one statement line", () => {
  it("filters the snapshot by pnl_bucket so the total matches the cell that was clicked", async () => {
    execute.mockResolvedValueOnce([
      [{ id: "s1", employee_code: "E1", designation_name: "Team Leader", pnl_bucket: "dsc_people",
         as_of_date: "2026-08-31", amount: "832603.38", full_name: "A Person" }],
      [],
    ]);

    const result = await getPnlDrilldown({
      metric: "people", period: PERIOD, branchId: BRANCH_ID, peopleBucket: "dsc_people",
    });

    const call = sqlCalls()[0];
    expect(call.sql).toContain("pnl_running_salary_snapshot");
    expect(call.sql).toContain("s.pnl_bucket = ?");
    expect(call.params).toEqual([PERIOD, BRANCH_ID, "dsc_people"]);
    expect(result.total).toBeCloseTo(832603.38, 2);
    expect(result.scope.bucket).toBe("dsc_people");
    // Posted payroll carries no bucket column, so a bucketed request must not consult it at all —
    // otherwise the first (empty) result would suppress the snapshot read.
    expect(sqlCalls().some((c) => c.sql.includes("salary_prep_line"))).toBe(false);
  });

  it("keeps the designation grouping when the caller is not entitled to payroll detail", async () => {
    execute.mockResolvedValueOnce([[{ designation_name: "Team Leader", headcount: 31, amount: "832603.38" }], []]);

    const result = await getPnlDrilldown({
      metric: "people", period: PERIOD, branchId: BRANCH_ID,
      peopleBucket: "dsc_people", aggregatePeople: true,
    });

    expect(result.rows[0].detail).toContain("31 employees");
    expect(sqlCalls()[0].sql).not.toContain("full_name");
  });
});

describe("drilldowns tie to the tiles they open from (audit item 17)", () => {
  it("(a) indirect reads the shared GRN reader — app allocations, ordinary GRNs, mirror with the dedup guard", async () => {
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("grn_cost_allocation a") && q.includes("'consumed'")) {
        return [[
          { branch_id: BRANCH_ID, cost_centre_id: COST_CENTRE_ID, process_id: null, source: "app_allocation", grn_ref: "GRN/1", label: "Vendor A — Rent", bill_date: "2026-08-02", amount: "5000" },
          { branch_id: BRANCH_ID, cost_centre_id: COST_CENTRE_ID, process_id: null, source: "db_bill_mirror", grn_ref: "Mas/5/1", label: "Vendor B", bill_date: null, amount: "1200" },
          { branch_id: "other-branch", cost_centre_id: "cc-9", process_id: null, source: "app_grn", grn_ref: "GRN/9", label: "Elsewhere", bill_date: null, amount: "777" },
        ], []];
      }
      if (q.includes("'reserved'")) {
        return [[{ branch_id: BRANCH_ID, cost_centre_id: COST_CENTRE_ID, process_id: null, source: "app_allocation", grn_ref: "GRN/2", label: "Vendor C", bill_date: null, amount: "300" }], []];
      }
      return [[], []];
    });
    const result = await getPnlDrilldown({ metric: "indirect", period: PERIOD, branchId: BRANCH_ID });

    const consumedSql = sqlCalls().find((c) => c.sql.includes("'consumed'"))!.sql;
    expect(consumedSql).toContain("FROM grn_cost_allocation a");
    expect(consumedSql).toContain("FROM grn_request gr");
    expect(consumedSql).toContain("FROM grn_entry_line_snapshot l");
    expect(consumedSql, "mirror rows for a GRN the app already consumed are excluded").toContain("NOT EXISTS");
    // Branch scope keeps only this branch's rows; reserved (committed) GRN is always included.
    expect(result.total).toBe(5000 + 1200 + 300);
    expect(result.hasEstimatedRows).toBe(true);
    expect(result.rows.find((r) => r.amount === 300)?.detail).toContain("not yet consumed");
  });

  it("(a) indirect includes reserved GRN for a closed month outside the estimate window (owner rule 2026-09-24)", async () => {
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("grn_cost_allocation a") && q.includes("'consumed'")) {
        return [[{ branch_id: BRANCH_ID, cost_centre_id: COST_CENTRE_ID, process_id: null, source: "app_allocation", grn_ref: "GRN/1", label: "Vendor A", bill_date: null, amount: "100" }], []];
      }
      if (q.includes("'reserved'")) {
        return [[{ branch_id: BRANCH_ID, cost_centre_id: COST_CENTRE_ID, process_id: null, source: "app_allocation", grn_ref: "GRN/2", label: "Vendor C", bill_date: null, amount: "40" }], []];
      }
      return [[], []];
    });
    const result = await getPnlDrilldown({ metric: "indirect", period: "2026-03", branchId: BRANCH_ID });
    expect(result.total).toBe(140);
    const reservedSql = sqlCalls().find((c) => c.sql.includes("'reserved'"))!.sql;
    expect(reservedSql, "draft allocations are never committed cost").not.toContain("'draft'");
  });

  it("(b) people under cost-centre scope filters on the EFFECTIVE (post-override) cost centre", async () => {
    await getPnlDrilldown({ metric: "people", period: PERIOD, costCentreId: COST_CENTRE_ID });
    const payrollSql = sqlCalls().find((c) => c.sql.includes("FROM salary_prep_line l"))!.sql;
    expect(payrollSql).toContain("pnl_employee_cost_centre_override");
    expect(payrollSql).toContain("COALESCE(pecco.target_cost_centre_id, e.cost_centre_id) = ?");
    expect(payrollSql).not.toMatch(/AND e\.cost_centre_id = \?/);
  });

  it("(b) people under branch scope uses the effective cost centre's branch, home branch only when unmapped", async () => {
    await getPnlDrilldown({ metric: "people", period: PERIOD, branchId: BRANCH_ID, aggregatePeople: true });
    const payrollSql = sqlCalls().find((c) => c.sql.includes("FROM salary_prep_line l"))!.sql;
    expect(payrollSql).toContain("CASE WHEN pcc.id IS NULL THEN e.branch_id ELSE pcc.branch_id END");
  });

  it("(c) revenue adds GREATEST(provision - invoice, 0) even when the cost centre has invoices", async () => {
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("FROM billing_invoice_particular_snapshot p") && !q.includes("billing_provision_snapshot")) {
        return [[{ bill_source_id: 1, cost_centre_code: "CC/1", cost_centre_name: "CC One", particulars: "Seats", service: "", amount: "70000", source_created_at: null }], []];
      }
      if (q.includes("billing_provision_snapshot")) {
        return [[{ cost_centre_code: "CC/1", cost_centre_name: "CC One", provision_amount: "100000", invoice_amount: "70000" }], []];
      }
      return [[], []];
    });
    const result = await getPnlDrilldown({ metric: "revenue", period: PERIOD, costCentreId: COST_CENTRE_ID });
    expect(result.total, "invoice 70,000 + un-invoiced provision 30,000 = the tile's 100,000").toBe(100000);
    expect(result.rows.find((r) => r.id.startsWith("prov-"))?.amount).toBe(30000);
    // No estimate rows once there is an invoice.
    expect(getSeatBillingEstimate).not.toHaveBeenCalled();
  });

  it("(d) an 'Est' revenue cell shows the seat-rate lines the estimate came from, totalling the cell", async () => {
    getSeatBillingEstimate.mockResolvedValueOnce({
      period: "2026-09", asOfDate: "2026-09-15", daysInMonth: 30, daysElapsed: 15, configurationAvailable: true,
      costCentres: [{
        costCentreId: COST_CENTRE_ID, costCentreCode: "CC/1", costCentreName: "CC One", processName: null,
        branchId: BRANCH_ID, branchName: "B", source: "invoice", sourcePeriod: "2026-08",
        lines: [
          { id: null, lineLabel: "Inbound seat", lineKind: "seat", rateMonthly: 30000, seats: 10, monthlyValue: 300000, effectiveFrom: null, effectiveTo: null, notes: null, sourceBillId: 9 },
          { id: null, lineLabel: "Platform fee", lineKind: "fixed", rateMonthly: 0, seats: 0, monthlyValue: 50000, effectiveFrom: null, effectiveTo: null, notes: null, sourceBillId: 9 },
        ],
        excludedLines: [], seats: 10, monthlyValue: 350000, perDay: 350000 / 30, toDate: 175000,
      }],
      totals: { costCentres: 1, configured: 0, fromInvoice: 1, withoutRate: 0, seats: 10, monthlyValue: 350000, perDay: 350000 / 30, toDate: 175000 },
    });
    execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("AS cc_active")) return [[{ cc_active: 1, branch_active: 1 }], []];
      return [[], []];
    });
    const result = await getPnlDrilldown({ metric: "revenue", period: "2026-09", costCentreId: COST_CENTRE_ID });
    expect(result.rows).toHaveLength(2);
    expect(result.total).toBeCloseTo(175000, 2);
    expect(result.hasEstimatedRows).toBe(true);
    expect(result.rows[0].detail).toContain("ESTIMATE");
    expect(result.rows[0].detail).toContain("15 of 30 days");
  });

  it("(d) no estimate rows outside the open window or for a cost centre closed today", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("AS cc_active")) return [[{ cc_active: 1, branch_active: 0 }], []];
      return [[], []];
    });
    expect((await getPnlDrilldown({ metric: "revenue", period: "2026-09", costCentreId: COST_CENTRE_ID })).rows).toEqual([]);
    expect((await getPnlDrilldown({ metric: "revenue", period: "2026-05", costCentreId: COST_CENTRE_ID })).rows).toEqual([]);
    expect(getSeatBillingEstimate).not.toHaveBeenCalled();
  });
});
