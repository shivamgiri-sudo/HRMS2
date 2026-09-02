import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Company-wide ruling: a GRN's Finance Month / P&L period is `grn_request.accounting_period`,
 * never `bill_date` (or any date-fallback chain). grn-report.service.ts already implements this
 * correctly; ceo-overview.service.ts's spendByBranch() previously filtered on
 * `DATE_FORMAT(gr.bill_date, '%Y-%m')` instead.
 *
 * This models one GRN whose bill_date (2026-06) and accounting_period (2026-07) fall in
 * different months. It must be attributed to July (accounting_period), not June (bill_date).
 * The mock plays the role of the database: it inspects the SQL text spendByBranch's app-side
 * query actually issues, and answers as a real `grn_cost_allocation`/`grn_request` table would —
 * matching the bound period against whichever column the query filters on.
 */

const { execute, tableExists } = vi.hoisted(() => ({ execute: vi.fn(), tableExists: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists, queryRows: vi.fn() }));

const BRANCH_ID = "branch-1";
const GRN_BILL_DATE_MONTH = "2026-06";
const GRN_ACCOUNTING_PERIOD = "2026-07";
const GRN_AMOUNT = 500000;

beforeEach(() => {
  vi.resetModules();
  execute.mockReset();
  tableExists.mockReset();
  tableExists.mockResolvedValue(true);

  execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const q = String(sql);

    if (q.includes("FROM branch_master") && !q.includes("JOIN")) {
      return [[{ id: BRANCH_ID, branch_name: "TEST BRANCH", active_status: 1 }], []];
    }

    // spendByBranch's app-side query: grn_cost_allocation joined to grn_request. Answer as a real
    // table would, keyed on whichever date column the query text actually filters on.
    if (q.includes("FROM grn_cost_allocation") && q.includes("pnl_cost_amount")) {
      const period = params[0];
      const matches = q.includes("gr.accounting_period = ?")
        ? period === GRN_ACCOUNTING_PERIOD
        : q.includes("DATE_FORMAT(gr.bill_date")
        ? period === GRN_BILL_DATE_MONTH
        : false;
      return [matches ? [{ branch_id: BRANCH_ID, amount: GRN_AMOUNT }] : [], []];
    }

    // Everything else spendByBranch/getCeoOverview touches: no data, no crash.
    return [[], []];
  });
});

describe("GRN Finance Month attribution (accounting_period, not bill_date)", () => {
  it("attributes a GRN to its accounting_period month even when bill_date falls in a different month", async () => {
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    const out = await getCeoOverview(GRN_ACCOUNTING_PERIOD);
    const branch = out.branches.find((b) => b.branchId === BRANCH_ID);
    expect(
      branch?.indirectCost,
      "the GRN's accounting_period (2026-07) must drive attribution, not its bill_date (2026-06)",
    ).toBe(GRN_AMOUNT);
  });

  it("does not attribute the GRN to its bill_date month", async () => {
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    const out = await getCeoOverview(GRN_BILL_DATE_MONTH);
    const branch = out.branches.find((b) => b.branchId === BRANCH_ID);
    expect(branch, "no spend happened in the bill_date month per the accounting_period rule").toBeUndefined();
  });
});
