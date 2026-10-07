import { describe, expect, it } from "vitest";
import { fakeCtx, field } from "./finance-test-utils.js";
import { clientCreditNoteAdapter, clientInvoiceAdapter } from "../adapters/client-billing.js";

const inv = (o: any = {}) => ({ id: "i1", invoice_status: "proforma", is_migrated: 0, proforma_no: "PF/1", cost_centre_display_name: "Acme Ltd", cost_centre_code: "CC1", category: "Manpower", finance_year: "2026-27", month_label: "Sep", invoice_date: "2026-10-01", gst_type: "cgst_sgst", apply_gst: 1, total_amount: 100000, igst_amount: 0, cgst_amount: 9000, sgst_amount: 9000, grand_total: 118000, created_at: "2026-09-25T00:00:00Z", description: "Sep seats", ...o });

describe("client invoice adapter", () => {
  it("lists non-migrated proformas with lines; deep link", async () => {
    const { ctx, calls } = fakeCtx({
      "GET /api/client-billing/proformas": { data: [inv(), inv({ id: "i2", is_migrated: 1 })] },
      "GET /api/client-billing/proformas/i1": { data: { lines: [{ line_type: "charge", particulars: "Seats", qty: 10, rate: 10000, amount: 100000 }] } },
    });
    const items = await clientInvoiceAdapter.list(ctx);
    expect(calls[0].query).toEqual({ status: "proforma", limit: 200 });
    expect(items.map((i) => i.id)).toEqual(["i1"]);
    expect(field(items[0], "Grand total")).toBe("₹1,18,000");
    expect(field(items[0], "CGST")).toBe("₹9,000");
    expect(field(items[0], "Line detail")).toBe("Seats — 10 x ₹10,000 = ₹1,00,000");
    expect(items[0].viewPath).toBe("/finance/client-billing?tab=proformas&approvalId=i1");
    expect(items[0].rejectNeedsReason).toBe(true);
  });
  it("decide approve (no PO) / reject reason", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/client-billing/invoices/i1/approve": {}, "POST /api/client-billing/invoices/i1/reject": {} });
    await clientInvoiceAdapter.decide(ctx, { id: "i1" }, "approve", "");
    await clientInvoiceAdapter.decide(ctx, { id: "i1" }, "reject", "wrong rate");
    expect(calls.map((c) => c.body)).toEqual([{}, { reason: "wrong rate" }]);
  });
});

describe("client credit note adapter", () => {
  it("lists drafts; approve works, reject is refused", async () => {
    const { ctx, calls } = fakeCtx({
      "GET /api/client-billing/credit-notes": { data: [{ id: "c1", credit_status: "draft", is_migrated: 0, credit_no: "CN/1", against_invoice_number: "09-100/26-27", cost_centre_display_name: "Acme", grand_total: 5900, total_amount: 5000, igst_amount: 900, apply_gst: 1, gst_type: "igst", credit_date: "2026-10-02", created_at: "2026-10-02T00:00:00Z" }] },
      "GET /api/client-billing/credit-notes/c1": { data: { lines: [{ particulars: "SLA credit", qty: 1, rate: 5000, amount: 5000 }] } },
      "POST /api/client-billing/credit-notes/c1/approve": {},
    });
    const items = await clientCreditNoteAdapter.list(ctx);
    expect(calls[0].query).toEqual({ status: "draft", limit: 200 });
    expect(field(items[0], "Against invoice")).toBe("09-100/26-27");
    expect(field(items[0], "Line detail")).toContain("SLA credit");
    expect(items[0].meta).toEqual({ approveOnly: true });
    expect(items[0].viewPath).toBe("/finance/client-billing?tab=credit-notes&approvalId=c1");
    await clientCreditNoteAdapter.decide(ctx, { id: "c1" }, "approve", "");
    await expect(clientCreditNoteAdapter.decide(ctx, { id: "c1" }, "reject", "x")).rejects.toThrow(/only be approved/);
  });
});
