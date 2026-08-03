import { describe, expect, it } from "vitest";
import { getCompanyBudgetConsolidation } from "../branch-budget.service.js";

interface FakeRow {
  branch_id: string;
  branch_name: string;
  budget_status: string;
  line_id: string;
  head: string;
  sub_head: string | null;
  item_name: string;
  unit: string;
  quantity: number;
  gross_amount: number;
  pnl_cost_amount: number;
  reserved_amount: number;
  consumed_amount: number;
}

interface FakeGrnActualRow {
  budget_line_id: string;
  paid_amount: number;
  booked_amount: number;
}

function fakeExecutor(rows: FakeRow[], grnActuals: FakeGrnActualRow[] = []) {
  return {
    async execute(sql: string, params?: unknown[]) {
      if (sql.includes("FROM finance_budget_header")) {
        const [periodCode] = params as [string];
        // The real query filters by period_code in SQL; the fake just returns everything since
        // the test data below is already period-scoped per test.
        void periodCode;
        return [rows, []];
      }
      if (sql.includes("FROM grn_cost_allocation")) {
        return [grnActuals, []];
      }
      throw new Error(`fakeExecutor: unexpected query — ${sql}`);
    },
  } as any;
}

let nextLineId = 1;
function row(overrides: Partial<FakeRow>): FakeRow {
  return {
    branch_id: "b1",
    branch_name: "Noida",
    budget_status: "active",
    line_id: `line-${nextLineId++}`,
    head: "IT",
    sub_head: "Software",
    item_name: "Process-specific software",
    unit: "Licence",
    quantity: 5,
    gross_amount: 11800,
    pnl_cost_amount: 10000,
    reserved_amount: 0,
    consumed_amount: 0,
    ...overrides,
  };
}

describe("getCompanyBudgetConsolidation", () => {
  it("groups lines sharing head/sub-head/item across branches and sums company totals exactly", async () => {
    const rows = [
      row({ branch_id: "b1", branch_name: "Noida", quantity: 5, gross_amount: 11800, pnl_cost_amount: 10000 }),
      row({ branch_id: "b2", branch_name: "Pune", quantity: 3, gross_amount: 7080, pnl_cost_amount: 6000 }),
    ];
    const result = await getCompanyBudgetConsolidation("2026-08", fakeExecutor(rows));
    expect(result).toHaveLength(1);
    const group = result[0];
    expect(group.head).toBe("IT");
    expect(group.companyUnit).toBe(8);
    expect(group.companyGrossAmount).toBe(18880);
    expect(group.companyPnlCostAmount).toBe(16000);
    expect(group.branchCount).toBe(2);
    expect(group.branches.map((b) => b.branchId).sort()).toEqual(["b1", "b2"]);
  });

  it("merges multiple lines from the same branch into a single branch entry within a group", async () => {
    const rows = [
      row({ branch_id: "b1", quantity: 5, gross_amount: 11800, pnl_cost_amount: 10000 }),
      row({ branch_id: "b1", quantity: 2, gross_amount: 4720, pnl_cost_amount: 4000 }),
    ];
    const result = await getCompanyBudgetConsolidation("2026-08", fakeExecutor(rows));
    expect(result).toHaveLength(1);
    expect(result[0].branchCount).toBe(1);
    expect(result[0].branches).toHaveLength(1);
    expect(result[0].branches[0].quantity).toBe(7);
    expect(result[0].branches[0].grossAmount).toBe(16520);
  });

  it("keeps separate groups for different head/sub-head/item combinations", async () => {
    const rows = [
      row({ item_name: "Process-specific software" }),
      row({ item_name: "Direct travel", sub_head: "Travel", unit: "Trip", quantity: 2, gross_amount: 3540, pnl_cost_amount: 3000 }),
    ];
    const result = await getCompanyBudgetConsolidation("2026-08", fakeExecutor(rows));
    expect(result).toHaveLength(2);
  });

  it("flags unitConsistent = false when branches use different units, without silently summing incorrectly", async () => {
    const rows = [
      row({ branch_id: "b1", unit: "Licence", quantity: 5 }),
      row({ branch_id: "b2", unit: "Seat", quantity: 3 }),
    ];
    const result = await getCompanyBudgetConsolidation("2026-08", fakeExecutor(rows));
    expect(result[0].unitConsistent).toBe(false);
    expect(result[0].companyUnit).toBe(8);
  });

  it("includes a branch whose budget is still in draft status, not silently excluded", async () => {
    const rows = [
      row({ branch_id: "b1", budget_status: "active" }),
      row({ branch_id: "b2", budget_status: "draft" }),
    ];
    const result = await getCompanyBudgetConsolidation("2026-08", fakeExecutor(rows));
    const draftBranch = result[0].branches.find((b) => b.branchId === "b2");
    expect(draftBranch?.budgetStatus).toBe("draft");
  });

  it("returns an empty array when no branch has budget lines for the period", async () => {
    const result = await getCompanyBudgetConsolidation("2026-08", fakeExecutor([]));
    expect(result).toEqual([]);
  });

  it("rolls up reserved/consumed from the budget line and paid/booked from GRN actuals, per branch and company-wide", async () => {
    const rows = [
      row({ branch_id: "b1", line_id: "line-b1", reserved_amount: 2000, consumed_amount: 1500 }),
      row({ branch_id: "b2", line_id: "line-b2", reserved_amount: 1000, consumed_amount: 800 }),
    ];
    const grnActuals = [
      { budget_line_id: "line-b1", paid_amount: 900, booked_amount: 1500 },
      { budget_line_id: "line-b2", paid_amount: 300, booked_amount: 800 },
      // A row for a budget line outside this consolidation's result set must be ignored, not
      // thrown or double-counted into whichever group happens to iterate last.
      { budget_line_id: "line-unrelated", paid_amount: 5000, booked_amount: 5000 },
    ];
    const result = await getCompanyBudgetConsolidation("2026-08", fakeExecutor(rows, grnActuals));
    expect(result).toHaveLength(1);
    const group = result[0];
    expect(group.companyReservedAmount).toBe(3000);
    expect(group.companyConsumedAmount).toBe(2300);
    expect(group.companyPaidAmount).toBe(1200);
    expect(group.companyBookedToPnlAmount).toBe(2300);
    const b1 = group.branches.find((b) => b.branchId === "b1");
    expect(b1?.paidAmount).toBe(900);
    expect(b1?.bookedToPnlAmount).toBe(1500);
  });

  it("treats a budget line with no matching GRN activity as zero paid/booked, not undefined", async () => {
    const result = await getCompanyBudgetConsolidation("2026-08", fakeExecutor([row({ line_id: "line-x" })], []));
    expect(result[0].companyPaidAmount).toBe(0);
    expect(result[0].companyBookedToPnlAmount).toBe(0);
    expect(result[0].branches[0].paidAmount).toBe(0);
  });
});
