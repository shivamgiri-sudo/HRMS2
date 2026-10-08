import { describe, expect, it, vi } from "vitest";
import { fakeCtx, field } from "./finance-test-utils.js";

let roles = ["finance_head"];
vi.mock("../adapters/finance-shared.js", async () => {
  const actual = await vi.importActual<any>("../adapters/finance-shared.js");
  return { ...actual, callerRoles: async () => roles };
});
import { imprestAllocationAdapter } from "../adapters/imprest-allocation.js";
import { beforeEach as __scopeBeforeEach } from "vitest";
import { useScope, ORG_WIDE } from "./scope-fixture.js";
__scopeBeforeEach(() => useScope(ORG_WIDE));

const row = (o: any = {}) => ({ id: "a1", allocation_no: "IMP/1", status: "submitted", manager_name: "Ravi", branch_name: "Noida", amount: 50000, allocation_date: "2026-10-03", payment_mode: "NEFT", bank_name: "HDFC", reference_no: "UTR1", remarks: "Top-up", submitted_at: "2026-10-03T00:00:00Z", ...o });

describe("imprest allocation adapter", () => {
  it("lists pending allocations for finance head; maps fields", async () => {
    roles = ["finance_head"];
    const { ctx, calls } = fakeCtx({ "GET /api/finance/imprest/allocations": (o: any) => ({ data: o.query.status === "submitted" ? [row(), row({ id: "a2", status: "disbursed" })] : [] }) });
    const items = await imprestAllocationAdapter.list(ctx);
    expect(calls.map((c) => c.query.status)).toEqual(["submitted", "branch_head_approved"]);
    expect(items.map((i) => i.id)).toEqual(["a1"]);
    expect(field(items[0], "Amount")).toBe("₹50,000");
    expect(field(items[0], "Imprest holder")).toBe("Ravi");
    expect(field(items[0], "Remarks")).toBe("Top-up");
    expect(items[0].viewPath).toBe("/finance/grn?tab=imprest&pane=allocation&approvalId=a1");
  });
  it("other roles get nothing", async () => {
    roles = ["accounts_head"];
    const { ctx, calls } = fakeCtx({});
    expect(await imprestAllocationAdapter.list(ctx)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
  it("decide", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/finance/imprest/allocations/a1/review": {} });
    await imprestAllocationAdapter.decide(ctx, { id: "a1" }, "approve", "");
    await imprestAllocationAdapter.decide(ctx, { id: "a1" }, "reject", "no budget");
    expect(calls.map((c) => c.body)).toEqual([{ decision: "approve", remarks: undefined }, { decision: "reject", remarks: "no budget" }]);
  });
});
