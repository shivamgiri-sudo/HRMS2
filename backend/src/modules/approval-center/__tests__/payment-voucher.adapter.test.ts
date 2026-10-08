import { describe, expect, it, vi } from "vitest";
import { fakeCtx, field } from "./finance-test-utils.js";

let roles = ["ceo"];
vi.mock("../adapters/finance-shared.js", async () => {
  const actual = await vi.importActual<any>("../adapters/finance-shared.js");
  return { ...actual, callerRoles: async () => roles };
});
import { paymentVoucherAdapter } from "../adapters/payment-voucher.js";

const row = (o: any = {}) => ({ id: "v1", voucher_number: "PV/N/202610/1", voucher_type: "payment", source_type: "vendor_grn", status: "raised", raised_by: "u-fh", amount: 118000, vendor_name: "Acme", grn_number: "G/1", bank_account_name: "HDFC", payable_account_name: "AP", raised_at: "2026-10-05T00:00:00Z", reason: "Monthly", ...o });

describe("payment voucher adapter", () => {
  it("lists raised vouchers for CEO with detail fields", async () => {
    roles = ["ceo"];
    const { ctx, calls } = fakeCtx({
      "GET /api/finance/payment-vouchers": { data: [row(), row({ id: "v2", raised_by: "u-me" }), row({ id: "v3", status: "ceo_approved" })] },
      "GET /api/finance/payment-vouchers/v1": { data: { raised_by_name: "Fin Head", current_bank_balance: 900000, tds_deducted_amount: 2000, head: "Rent", grn_allocations: [{ grn_number: "G/1", vendor_name: "Acme", allocated_amount: 60000, due_amount: 60000 }, { grn_number: "G/2", vendor_name: "Acme", allocated_amount: 58000, due_amount: 58000 }] } },
    });
    const items = await paymentVoucherAdapter.list(ctx);
    expect(calls[0].query).toEqual({ status: "raised", limit: 200 });
    expect(items.map((i) => i.id)).toEqual(["v1"]);
    expect(field(items[0], "Net amount")).toBe("₹1,18,000");
    expect(field(items[0], "Bank balance now")).toBe("₹9,00,000");
    expect(field(items[0], "TDS deducted")).toBe("₹2,000");
    expect(field(items[0], "GRN allocations")).toContain("G/2");
    expect(field(items[0], "Raised by")).toBe("Fin Head");
    expect(items[0].viewPath).toBe("/finance/ledger?tab=payments&approvalId=v1");
    expect(items[0].rejectNeedsReason).toBe(false);
  });
  it("non-CEO gets nothing and no calls", async () => {
    roles = ["finance_head"];
    const { ctx, calls } = fakeCtx({});
    expect(await paymentVoucherAdapter.list(ctx)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
  it("decide approve -> ceo-approve, reject -> reject", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/finance/payment-vouchers/v1/ceo-approve": {}, "POST /api/finance/payment-vouchers/v1/reject": {} });
    await paymentVoucherAdapter.decide(ctx, { id: "v1" }, "approve", "");
    await paymentVoucherAdapter.decide(ctx, { id: "v1" }, "reject", "no funds");
    expect(calls.map((c) => [c.path, c.body])).toEqual([
      ["/api/finance/payment-vouchers/v1/ceo-approve", { note: null }],
      ["/api/finance/payment-vouchers/v1/reject", { note: "no funds" }],
    ]);
  });
});
