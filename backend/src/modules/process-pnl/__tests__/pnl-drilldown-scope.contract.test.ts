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
});

/** Every SQL string the call issued, joined — enough to assert on predicates and parameters. */
function sqlCalls(): { sql: string; params: unknown[] }[] {
  return execute.mock.calls.map(([sql, params]) => ({ sql: String(sql), params: (params ?? []) as unknown[] }));
}

describe("budget drilldown scope", () => {
  it("scopes by cost centre through cost_centre_master, since the snapshot has no cost-centre column", async () => {
    await getPnlDrilldown({ metric: "budget", period: PERIOD, costCentreId: COST_CENTRE_ID });

    const lineQuery = sqlCalls().find((c) => c.sql.includes("finance_budget_line_snapshot"));
    expect(lineQuery, "the budget line query should have run").toBeDefined();
    expect(lineQuery!.sql).toContain("expense_type_name");
    expect(lineQuery!.sql).toContain("cost_centre_master");
    expect(lineQuery!.params).toEqual([PERIOD, COST_CENTRE_ID]);
    // Not the old branch predicate.
    expect(lineQuery!.sql).not.toContain("bm.id = ?");
  });

  it("scopes by process through that process's cost centres", async () => {
    await getPnlDrilldown({ metric: "budget", period: PERIOD, processId: PROCESS_ID });

    const lineQuery = sqlCalls().find((c) => c.sql.includes("finance_budget_line_snapshot"));
    expect(lineQuery!.sql).toContain("e.process_id = ?");
    expect(lineQuery!.params).toEqual([PERIOD, PROCESS_ID]);
  });

  it("still scopes by branch, and only then includes header-level top-ups", async () => {
    await getPnlDrilldown({ metric: "budget", period: PERIOD, branchId: BRANCH_ID });

    const calls = sqlCalls();
    expect(calls.find((c) => c.sql.includes("finance_budget_line_snapshot"))!.sql).toContain("bm.id = ?");
    expect(
      calls.some((c) => c.sql.includes("reopen_additional_amount")),
      "a branch-scoped budget drilldown must include sanctioned top-ups or it under-totals",
    ).toBe(true);
  });

  it("omits header-level top-ups under process and cost-centre scope", async () => {
    // A top-up is recorded against the budget header with no cost centre of its own. Attributing
    // it to one process would inflate that process by another scope's money, so it is left out
    // rather than guessed.
    for (const scope of [{ processId: PROCESS_ID }, { costCentreId: COST_CENTRE_ID }]) {
      execute.mockClear();
      await getPnlDrilldown({ metric: "budget", period: PERIOD, ...scope });
      expect(sqlCalls().some((c) => c.sql.includes("reopen_additional_amount"))).toBe(false);
    }
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
