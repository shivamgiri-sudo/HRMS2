import { describe, expect, it, vi } from "vitest";
import { fakeCtx, field } from "./finance-test-utils.js";

let roles = ["finance_head"];
vi.mock("../adapters/finance-shared.js", async () => {
  const actual = await vi.importActual<any>("../adapters/finance-shared.js");
  return { ...actual, callerRoles: async () => roles };
});
import { vendorApprovalAdapter } from "../adapters/vendor-approval.js";
import { vendorBankChangeAdapter } from "../adapters/vendor-bank-change.js";

const req = (o: any = {}) => ({ id: "r1", request_type: "create", status: "pending", raised_by: "u-ba", raised_by_name: "Branch Admin", branch_name: "Noida", raised_at: "2026-10-04T00:00:00Z",
  payload: { vendor_name: "Acme", vendor_type: "supplier", gst_number: "07AAA", pan_number: "AAAAA0000A", payment_terms: "Net 30", contact_email: "a@b.c", expense_head_code: "RM", tds_applicable: true }, ...o });

describe("vendor approval adapter", () => {
  it("maps every payload key; object payload strings also parse", async () => {
    roles = ["finance_head"];
    const { ctx, calls } = fakeCtx({ "GET /api/finance/vendor-approval/requests": { data: [req(), req({ id: "r2", raised_by: "u-me" }), req({ id: "r3", payload: JSON.stringify({ vendor_name: "Zed" }) })] } });
    const items = await vendorApprovalAdapter.list(ctx);
    expect(calls[0].query).toEqual({ status: "pending", limit: 200 });
    expect(items.map((i) => i.id)).toEqual(["r1", "r3"]);
    expect(field(items[0], "GST number")).toBe("07AAA");
    expect(field(items[0], "Payment terms")).toBe("Net 30");
    expect(field(items[0], "TDS applicable")).toBe("Yes");
    expect(field(items[0], "Suggested expense head")).toBe("RM");
    expect(field(items[1], "Vendor name")).toBe("Zed");
    expect(items[0].viewPath).toBe("/finance/masters?tab=approvals&approvalId=r1");
  });
  it("role gate", async () => {
    roles = ["accounts_head"];
    const { ctx, calls } = fakeCtx({});
    expect(await vendorApprovalAdapter.list(ctx)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
  it("approve sends no editedPayload; reject requires reviewNotes", async () => {
    const { ctx, calls } = fakeCtx({ "PATCH /api/finance/vendor-approval/r1/approve": {}, "PATCH /api/finance/vendor-approval/r1/reject": {} });
    await vendorApprovalAdapter.decide(ctx, { id: "r1" }, "approve", "");
    await vendorApprovalAdapter.decide(ctx, { id: "r1" }, "reject", "dup vendor");
    expect(calls[0].body).toEqual({ reviewNotes: undefined });
    expect("editedPayload" in calls[0].body).toBe(false);
    expect(calls[1].body).toEqual({ reviewNotes: "dup vendor" });
    expect(vendorApprovalAdapter.kind).toBe("vendor_approval");
  });
});

describe("vendor bank change adapter", () => {
  const row = (o: any = {}) => ({ id: "b1", vendor_id: "v1", vendor_code: "V001", vendor_name: "Acme", action: "change", account_holder_name: "Acme Pvt", account_number_masked: "XXXXXX1234", ifsc: "HDFC0001", bank_name: "HDFC", branch_name: "Noida", reason: "New account", requested_by: "u-x", requested_by_role: "accounts_head", requested_at: "2026-10-05T00:00:00Z", previous_account_masked: "XXXXXX9999", previous_ifsc: "ICIC0001", ...o });
  it("lists others' requests with masked numbers; super_admin excluded by role gate", async () => {
    roles = ["accounts_head"];
    const { ctx } = fakeCtx({ "GET /api/finance/vendor-bank/requests": { data: [row(), row({ id: "b2", requested_by: "u-me" })] } });
    const items = await vendorBankChangeAdapter.list(ctx);
    expect(items.map((i) => i.id)).toEqual(["b1"]);
    expect(field(items[0], "New account")).toBe("XXXXXX1234");
    expect(field(items[0], "Current account")).toBe("XXXXXX9999");
    expect(field(items[0], "Reason")).toBe("New account");
    expect(items[0].viewPath).toBe("/finance/vendor-bank-details?approvalId=b1");
    roles = ["super_admin"];
    const { ctx: c2, calls } = fakeCtx({});
    expect(await vendorBankChangeAdapter.list(c2)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
  it("decide", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/finance/vendor-bank/requests/b1/approve": {}, "POST /api/finance/vendor-bank/requests/b1/reject": {} });
    await vendorBankChangeAdapter.decide(ctx, { id: "b1" }, "approve", "");
    await vendorBankChangeAdapter.decide(ctx, { id: "b1" }, "reject", "mismatch");
    expect(calls.map((c) => [c.path.split("/").pop(), c.body])).toEqual([["approve", { reason: undefined }], ["reject", { reason: "mismatch" }]]);
  });
});
