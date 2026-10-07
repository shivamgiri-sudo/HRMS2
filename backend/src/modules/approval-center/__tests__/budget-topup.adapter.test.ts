import { describe, expect, it, vi } from "vitest";
import { fakeCtx, field } from "./finance-test-utils.js";

let roles = ["branch_head"];
vi.mock("../adapters/finance-shared.js", async () => {
  const actual = await vi.importActual<any>("../adapters/finance-shared.js");
  return { ...actual, callerRoles: async () => roles };
});
import { budgetTopupAdapter } from "../adapters/budget-topup.js";

const row = (o: any = {}) => ({ id: "t1", status: "submitted", requested_by: "u-other", requested_by_name: "Asha", requested_amount: 25000, requested_quantity: 1.5, head: "Rent", sub_head: "Office", item_name: "Floor", unit: "Seat", unit_rate: 5000, budget_number: "BB-1", branch_id: "br1", branch_name: "Noida", period_code: "2026-10", reason: "Need more seats", created_at: "2026-10-01T00:00:00Z", pending_with: "Branch Head", is_new_line: 0, ...o });

describe("budget top-up adapter", () => {
  it("maps fields, stage and deep link", async () => {
    roles = ["branch_head"];
    const { ctx } = fakeCtx({ "GET /api/finance/pnl/budget-topups": { success: true, data: [row()] } });
    const [it1] = await budgetTopupAdapter.list(ctx);
    expect(it1.stage).toBe("Stage 1 of 2 — Branch Head");
    expect(field(it1, "Requested amount")).toBe("₹25,000");
    expect(field(it1, "Reason")).toBe("Need more seats");
    expect(field(it1, "Request type")).toBe("Increase to existing line");
    expect(it1.viewPath).toBe("/finance/branch-budget?tab=topups&branchId=br1&period=2026-10&approvalId=t1");
  });
  it("filters by stage role and own requests", async () => {
    roles = ["finance_head"];
    const data = [row({ id: "a" }), row({ id: "b", status: "branch_head_approved" }), row({ id: "c", status: "branch_head_approved", requested_by: "u-me" }), row({ id: "d", status: "applied" })];
    const { ctx } = fakeCtx({ "GET /api/finance/pnl/budget-topups": { data } });
    expect((await budgetTopupAdapter.list(ctx)).map((i) => i.id)).toEqual(["b"]);
  });
  it("no reviewer role -> no call", async () => {
    roles = ["admin"];
    const { ctx, calls } = fakeCtx({});
    expect(await budgetTopupAdapter.list(ctx)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
  it("decide", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/finance/pnl/budget-topups/t1/review": {} });
    await budgetTopupAdapter.decide(ctx, { id: "t1" }, "approve", "ok");
    await budgetTopupAdapter.decide(ctx, { id: "t1" }, "reject", "no");
    expect(calls.map((c) => c.body)).toEqual([{ decision: "approve", remarks: "ok" }, { decision: "reject", remarks: "no" }]);
  });
});
