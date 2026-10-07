import { describe, expect, it, vi } from "vitest";
import { fakeCtx, field } from "./finance-test-utils.js";

let roles = ["branch_head"];
vi.mock("../adapters/finance-shared.js", async () => {
  const actual = await vi.importActual<any>("../adapters/finance-shared.js");
  return { ...actual, callerRoles: async () => roles };
});
import { branchBudgetAdapter } from "../adapters/branch-budget.js";

const inbox = (o: any = {}) => ({ id: "b1", budget_number: "BB-1", period_code: "2026-10", status: "submitted", gross_budget: 500000, pnl_budget: 450000, revision_number: 2, updated_at: "2026-10-01 10:00:00", branch_id: "br1", branch_name: "Noida", ...o });
const detail = (o: any = {}) => ({ success: true, data: { id: "b1", status: "submitted", submitted_by: "u-maker", financial_year: "2026-27", base_budget_amount: 400000, tax_budget_amount: 100000, submitted_at: "2026-10-01T05:00:00Z",
  lines: [{ head: "Rent", sub_head: "Office", item_name: "Floor 2", quantity: 1, unit: "Month", unit_rate: 300000, tax_amount: 54000, gross_amount: 354000, cost_centre_name: "CC1" }, { head: "Utilities", gross_amount: 146000 }],
  corrections: [], exceptions: [], ...o } });

const routes = (inb: any[], det: any = detail()) => ({
  "GET /api/finance/pnl/budgets/pending-my-review": { success: true, data: inb },
  "GET /api/finance/pnl/budgets/b1": det,
});

describe("branch budget adapter", () => {
  it("maps all components and deep-links to the review dialog", async () => {
    roles = ["branch_head"];
    const { ctx } = fakeCtx(routes([inbox()]));
    const [it1] = await branchBudgetAdapter.list(ctx);
    expect(it1.stage).toBe("Stage 1 of 2 — Branch Head");
    expect(field(it1, "Gross budget")).toBe("₹5,00,000");
    expect(field(it1, "Budget lines")).toBe("2");
    expect(field(it1, "Totals by head")).toContain("Rent ₹3,54,000");
    expect(field(it1, "Line detail")).toContain("Rent > Office > Floor 2");
    expect(it1.viewPath).toBe("/finance/branch-budget?tab=approval&branchId=br1&period=2026-10&approvalId=b1");
    expect(it1.rejectNeedsReason).toBe(true);
  });
  it("drops budgets the (non-exempt) caller submitted themselves", async () => {
    roles = ["branch_head"];
    const { ctx } = fakeCtx(routes([inbox()], detail({ submitted_by: "u-me" })));
    expect(await branchBudgetAdapter.list(ctx)).toEqual([]);
  });
  it("finance_head is maker-checker exempt", async () => {
    roles = ["finance_head"];
    const { ctx } = fakeCtx(routes([inbox({ status: "branch_head_approved" })], detail({ submitted_by: "u-me", status: "branch_head_approved" })));
    const items = await branchBudgetAdapter.list(ctx);
    expect(items).toHaveLength(1);
    expect(items[0].stage).toBe("Stage 2 of 2 — Finance Head");
  });
  it("decide approve / reject", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/finance/pnl/budgets/b1/review": {} });
    await branchBudgetAdapter.decide(ctx, { id: "b1" }, "approve", "");
    await branchBudgetAdapter.decide(ctx, { id: "b1" }, "reject", "no");
    expect(calls[0].body).toEqual({ decision: "approve", remarks: undefined });
    expect(calls[1].body).toEqual({ decision: "reject", remarks: "no" });
  });
});
