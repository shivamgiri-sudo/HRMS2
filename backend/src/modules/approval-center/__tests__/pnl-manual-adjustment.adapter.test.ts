import { describe, expect, it, vi } from "vitest";
import { fakeCtx, field } from "./finance-test-utils.js";

let roles = ["finance_head"];
vi.mock("../adapters/finance-shared.js", async () => {
  const actual = await vi.importActual<any>("../adapters/finance-shared.js");
  return { ...actual, callerRoles: async () => roles };
});
import { pnlManualAdjustmentAdapter } from "../adapters/pnl-manual-adjustment.js";

const row = (o: any = {}) => ({ id: "m1", process_id: "p1", process_name: "Acme BPO", branch_name: "Noida", period_code: "2026-09", adjustment_type: "penalty", amount: 12000, reason: "SLA breach", status: "pending", created_by: "u-other", created_at: "2026-10-02T00:00:00Z", ...o });

describe("pnl manual adjustment adapter", () => {
  it("maps, filters own and non-pending", async () => {
    roles = ["finance_head"];
    const { ctx, calls } = fakeCtx({ "GET /api/finance/pnl/manual-adjustments": { data: [row(), row({ id: "m2", created_by: "u-me" }), row({ id: "m3", status: "approved" })] } });
    const items = await pnlManualAdjustmentAdapter.list(ctx);
    expect(calls[0].query).toEqual({ status: "pending" });
    expect(items.map((i) => i.id)).toEqual(["m1"]);
    expect(field(items[0], "Amount")).toBe("₹12,000");
    expect(field(items[0], "Adjustment type")).toBe("Penalty");
    expect(field(items[0], "Reason")).toBe("SLA breach");
    expect(items[0].viewPath).toBe("/finance/process-pnl/p1?period=2026-09&approvalId=m1");
  });
  it("role gate", async () => {
    roles = ["branch_head"];
    const { ctx, calls } = fakeCtx({});
    expect(await pnlManualAdjustmentAdapter.list(ctx)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
  it("decide uses PUT approve / reject with reason", async () => {
    const { ctx, calls } = fakeCtx({ "PUT /api/finance/pnl/manual-adjustments/m1/approve": {}, "PUT /api/finance/pnl/manual-adjustments/m1/reject": {} });
    await pnlManualAdjustmentAdapter.decide(ctx, { id: "m1" }, "approve", "");
    await pnlManualAdjustmentAdapter.decide(ctx, { id: "m1" }, "reject", "bad");
    expect(calls[1].body).toEqual({ reason: "bad" });
  });
});
