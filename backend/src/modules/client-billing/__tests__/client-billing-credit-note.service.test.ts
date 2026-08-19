import { randomUUID } from "crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { getConnection } = vi.hoisted(() => ({ getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { getConnection } }));

const { mintCreditNoteNumber } = vi.hoisted(() => ({ mintCreditNoteNumber: vi.fn() }));
vi.mock("../client-billing-numbering.service.js", () => ({
  clientBillingNumberingService: { mintCreditNoteNumber, mintProformaNumber: vi.fn(), mintBillNumber: vi.fn() },
}));

let clientBillingCreditNoteService: typeof import("../client-billing-credit-note.service.js")["clientBillingCreditNoteService"];
beforeAll(async () => {
  ({ clientBillingCreditNoteService } = await import("../client-billing-credit-note.service.js"));
});

function mockConnection() {
  const conn = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute: vi.fn() };
  getConnection.mockResolvedValue(conn);
  return conn;
}

const APPROVED_INVOICE = {
  id: "inv-1", invoice_status: "approved", cost_centre_id: "cc-1",
  finance_year: "2026-27",
};
const COST_CENTRE = { companyName: "Mas Callnet India Pvt Ltd", gstType: "Integrated", stateCode: "09" };

beforeEach(() => {
  getConnection.mockReset();
  mintCreditNoteNumber.mockReset();
});

describe("createCreditNote", () => {
  it("rejects an empty line list before touching the database", async () => {
    const conn = mockConnection();
    await expect(
      clientBillingCreditNoteService.createCreditNote({
        invoiceId: "inv-1", category: "Subscription", financeYear: "2026-27",
        monthLabel: "Aug-26", creditDate: "2026-08-19", lines: [], userId: "u-1",
      })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/line item/) });
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it("refuses when the invoice is not approved", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[{ ...APPROVED_INVOICE, invoice_status: "proforma" }], []]);

    await expect(
      clientBillingCreditNoteService.createCreditNote({
        invoiceId: "inv-1", category: "Subscription", financeYear: "2026-27",
        monthLabel: "Aug-26", creditDate: "2026-08-19",
        lines: [{ particulars: "Refund", qty: 1, rate: 1000 }], userId: "u-1",
      })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/not approved/) });
    expect(mintCreditNoteNumber).not.toHaveBeenCalled();
  });

  it("throws when the invoice does not exist", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[], []]);
    await expect(
      clientBillingCreditNoteService.createCreditNote({
        invoiceId: "missing", category: "Subscription", financeYear: "2026-27",
        monthLabel: "Aug-26", creditDate: "2026-08-19",
        lines: [{ particulars: "Refund", qty: 1, rate: 1000 }], userId: "u-1",
      })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/not found/) });
  });

  it("mints a credit number, computes GST, and creates a draft credit note", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[APPROVED_INVOICE], []])
      .mockResolvedValueOnce([[COST_CENTRE], []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []]);
    mintCreditNoteNumber.mockResolvedValueOnce("CN-09-01/26-27");

    const result = await clientBillingCreditNoteService.createCreditNote({
      invoiceId: "inv-1", category: "Subscription", financeYear: "2026-27",
      monthLabel: "Aug-26", creditDate: "2026-08-19",
      lines: [{ particulars: "Service credit", qty: 1, rate: 4500 }], userId: "u-1",
    });

    expect(mintCreditNoteNumber).toHaveBeenCalledWith("09", "Mas Callnet India Pvt Ltd", "2026-27");
    expect(result).toEqual({
      id: expect.any(String), creditNo: "CN-09-01/26-27", totalAmount: 4500,
      igstAmount: 810, cgstAmount: 0, sgstAmount: 0, grandTotal: 5310, creditStatus: "draft",
    });
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
});

describe("approveCreditNote", () => {
  it("refuses when already approved", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[{ id: "cn-1", credit_status: "approved" }], []]);
    await expect(
      clientBillingCreditNoteService.approveCreditNote({ creditNoteId: "cn-1", userId: "u-1" })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/already approved/) });
  });

  it("throws when the credit note does not exist", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[], []]);
    await expect(
      clientBillingCreditNoteService.approveCreditNote({ creditNoteId: "missing", userId: "u-1" })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/not found/) });
  });

  it("approves a draft credit note", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[{ id: "cn-1", credit_status: "draft", credit_no: "CN-09-01/26-27", total_amount: 4500, igst_amount: 810, cgst_amount: 0, sgst_amount: 0, grand_total: 5310 }], []])
      .mockResolvedValueOnce([{}, []]);

    const result = await clientBillingCreditNoteService.approveCreditNote({ creditNoteId: "cn-1", userId: "u-2" });

    expect(result).toEqual({
      id: "cn-1", creditNo: "CN-09-01/26-27", totalAmount: 4500,
      igstAmount: 810, cgstAmount: 0, sgstAmount: 0, grandTotal: 5310, creditStatus: "approved",
    });

    const updateCall = conn.execute.mock.calls[1];
    expect(String(updateCall[0])).toMatch(/UPDATE client_credit_note SET credit_status = 'approved'/);
    expect(updateCall[1]).toEqual(["u-2", "cn-1"]);
  });
});
