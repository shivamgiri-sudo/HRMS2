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
  it("design §3 guard: refuses to create a credit note against a migrated historical invoice (is_migrated=1)", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[{ ...APPROVED_INVOICE, is_migrated: 1 }], []]);

    await expect(
      clientBillingCreditNoteService.createCreditNote({
        invoiceId: "inv-1", category: "Subscription", financeYear: "2026-27",
        monthLabel: "Aug-26", creditDate: "2026-08-19",
        lines: [{ particulars: "Refund", qty: 1, rate: 1000 }], userId: "u-1",
      })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/migrated historical record/) });
    expect(mintCreditNoteNumber).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it("design §3 guard: does NOT refuse a normal is_migrated=0 invoice on that basis", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[{ ...APPROVED_INVOICE, is_migrated: 0 }], []])
      .mockResolvedValueOnce([[COST_CENTRE], []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []]);
    mintCreditNoteNumber.mockResolvedValueOnce("CN-09-01/26-27");

    const result = await clientBillingCreditNoteService.createCreditNote({
      invoiceId: "inv-1", category: "Subscription", financeYear: "2026-27",
      monthLabel: "Aug-26", creditDate: "2026-08-19",
      lines: [{ particulars: "Service credit", qty: 1, rate: 4500 }], userId: "u-1",
    });
    expect(result.creditNo).toBe("CN-09-01/26-27");
  });

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

  it("resolves tally_head/client_tally_name live from cost_centre_master at creation time", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[APPROVED_INVOICE], []])
      .mockResolvedValueOnce([[{
        ...COST_CENTRE,
        tallyHead: "VODAFONE MOBILE SERVICES LTD. (DELHI)",
        clientTallyName: "Vodafone Mobile Services Ltd",
      }], []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []]);
    mintCreditNoteNumber.mockResolvedValueOnce("CN-09-02/26-27");

    await clientBillingCreditNoteService.createCreditNote({
      invoiceId: "inv-1", category: "Subscription", financeYear: "2026-27",
      monthLabel: "Aug-26", creditDate: "2026-08-19",
      lines: [{ particulars: "Service credit", qty: 1, rate: 4500 }], userId: "u-1",
    });

    // Third conn.execute call is the client_credit_note INSERT; its last two positional
    // params are tally_head/client_tally_name per the INSERT column list.
    const params = conn.execute.mock.calls[2][1] as unknown[];
    expect(params[params.length - 2]).toBe("VODAFONE MOBILE SERVICES LTD. (DELHI)");
    expect(params[params.length - 1]).toBe("Vodafone Mobile Services Ltd");
  });
});

describe("approveCreditNote", () => {
  it("design §3 guard: refuses to approve a migrated historical credit note (is_migrated=1)", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[{ id: "cn-1", credit_status: "draft", is_migrated: 1 }], []]);
    await expect(
      clientBillingCreditNoteService.approveCreditNote({ creditNoteId: "cn-1", userId: "u-1" })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/migrated historical record/) });
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it("design §3 guard: does NOT refuse a normal is_migrated=0 credit note on that basis", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[{ id: "cn-1", credit_status: "draft", credit_no: "CN-09-01/26-27", total_amount: 4500, igst_amount: 810, cgst_amount: 0, sgst_amount: 0, grand_total: 5310, is_migrated: 0 }], []])
      .mockResolvedValueOnce([{}, []]);
    const result = await clientBillingCreditNoteService.approveCreditNote({ creditNoteId: "cn-1", userId: "u-2" });
    expect(result.creditStatus).toBe("approved");
  });

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
