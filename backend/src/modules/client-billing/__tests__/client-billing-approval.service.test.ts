import { randomUUID } from "crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { getConnection } = vi.hoisted(() => ({ getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { getConnection } }));

const { mintBillNumber } = vi.hoisted(() => ({ mintBillNumber: vi.fn() }));
vi.mock("../client-billing-numbering.service.js", () => ({
  clientBillingNumberingService: { mintBillNumber, mintProformaNumber: vi.fn() },
}));

let clientBillingApprovalService: typeof import("../client-billing-approval.service.js")["clientBillingApprovalService"];
beforeAll(async () => {
  ({ clientBillingApprovalService } = await import("../client-billing-approval.service.js"));
});

function mockConnection() {
  const conn = {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    execute: vi.fn(),
  };
  getConnection.mockResolvedValue(conn);
  return conn;
}

const APPROVABLE_INVOICE = {
  id: "inv-1", invoice_status: "proforma", cost_centre_id: "cc-1",
  finance_year: "2026-27", grand_total: 35400,
};

beforeEach(() => {
  getConnection.mockReset();
  mintBillNumber.mockReset();
});

describe("approveInvoice", () => {
  it("refuses when the invoice is not in proforma status", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[{ ...APPROVABLE_INVOICE, invoice_status: "approved" }], []]);

    await expect(
      clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-1" })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/not in proforma status/) });

    expect(mintBillNumber).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it("throws when the invoice does not exist", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[], []]);

    await expect(
      clientBillingApprovalService.approveInvoice({ invoiceId: "missing", userId: "u-1" })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/not found/) });
  });

  it("mints a bill number, resolves stateCode/companyName via cost_centre_master + branch_master, and marks the invoice approved", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[APPROVABLE_INVOICE], []]) // invoice lookup
      .mockResolvedValueOnce([[{ companyName: "Mas Callnet India Pvt Ltd", stateCode: "09" }], []]) // cost centre + branch lookup
      .mockResolvedValueOnce([{}, []]) // UPDATE client_invoice
      .mockResolvedValueOnce([{}, []]); // INSERT client_invoice_audit_log
    mintBillNumber.mockResolvedValueOnce("09-01/26-27");

    const result = await clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-1" });

    // Gap 3 fix: approveInvoice passes its own open-transaction `conn` through so the mint
    // runs on that connection instead of a separate pool-level call (avoids mixing pool-level
    // execute with an open transaction while a FOR UPDATE lock is held).
    expect(mintBillNumber).toHaveBeenCalledWith("09", "Mas Callnet India Pvt Ltd", "2026-27", conn);
    expect(result).toEqual({ id: "inv-1", billNo: "09-01/26-27", invoiceStatus: "approved" });
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);

    const auditCall = conn.execute.mock.calls[3];
    expect(String(auditCall[0])).toMatch(/INSERT INTO client_invoice_audit_log/);
    expect(auditCall[1]).toEqual(expect.arrayContaining(["inv-1", "approved", "u-1"]));
  });

  it("rejects more than 4 PO numbers before touching the database further", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[APPROVABLE_INVOICE], []]);

    await expect(
      clientBillingApprovalService.approveInvoice({
        invoiceId: "inv-1", userId: "u-1",
        poNumbers: ["PO1", "PO2", "PO3", "PO4", "PO5"],
      })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/more than 4/) });
  });

  it("rejects when the sum of PO balances is less than the invoice grand total", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[APPROVABLE_INVOICE], []]) // invoice lookup
      .mockResolvedValueOnce([[{ id: "po-1", balance_amount: 10000 }], []]); // PO lookup, one PO, insufficient

    await expect(
      clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-1", poNumbers: ["PO1"] })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/PO balance/) });

    expect(mintBillNumber).not.toHaveBeenCalled();
  });

  it("consumes PO balances and records client_po_particular rows when POs cover the total", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[APPROVABLE_INVOICE], []]) // invoice lookup
      .mockResolvedValueOnce([[{ id: "po-1", balance_amount: 40000 }], []]) // PO lookup
      .mockResolvedValueOnce([[{ companyName: "Mas Callnet India Pvt Ltd", stateCode: "09" }], []]) // cost centre lookup
      .mockResolvedValueOnce([{}, []]) // UPDATE client_po_number balance
      .mockResolvedValueOnce([{}, []]) // INSERT client_po_particular
      .mockResolvedValueOnce([{}, []]) // UPDATE client_invoice
      .mockResolvedValueOnce([{}, []]); // INSERT audit log
    mintBillNumber.mockResolvedValueOnce("09-01/26-27");

    await clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-1", poNumbers: ["PO1"] });

    const poUpdateCall = conn.execute.mock.calls[3];
    expect(String(poUpdateCall[0])).toMatch(/UPDATE client_po_number/);
    const poParticularCall = conn.execute.mock.calls[4];
    expect(String(poParticularCall[0])).toMatch(/INSERT INTO client_po_particular/);
  });
});

describe("rejectInvoice", () => {
  it("requires a non-empty reason", async () => {
    const conn = mockConnection();

    await expect(
      clientBillingApprovalService.rejectInvoice({ invoiceId: "inv-1", reason: "", userId: "u-1" })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/reason is required/) });

    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it("refuses when the invoice is already rejected", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[{ id: "inv-1", invoice_status: "rejected" }], []]);

    await expect(
      clientBillingApprovalService.rejectInvoice({ invoiceId: "inv-1", reason: "duplicate entry", userId: "u-1" })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/already rejected/) });
  });

  it("refunds every linked provision deduction, marks the invoice rejected, and writes one audit row", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[{ id: "inv-1", invoice_status: "approved" }], []]) // invoice lookup
      .mockResolvedValueOnce([[ // deductions for this invoice
        { id: "ded-1", provision_id: "prov-1", amount_used: 5000 },
        { id: "ded-2", provision_id: "prov-2", amount_used: 3000 },
      ], []])
      .mockResolvedValueOnce([{}, []]) // refund provision 1
      .mockResolvedValueOnce([{}, []]) // delete deduction 1
      .mockResolvedValueOnce([{}, []]) // refund provision 2
      .mockResolvedValueOnce([{}, []]) // delete deduction 2
      .mockResolvedValueOnce([[], []]) // PO particulars lookup (none for this invoice)
      .mockResolvedValueOnce([{}, []]) // UPDATE client_invoice
      .mockResolvedValueOnce([{}, []]); // INSERT audit log

    const result = await clientBillingApprovalService.rejectInvoice({
      invoiceId: "inv-1", reason: "client disputed the charge", userId: "u-1",
    });

    expect(result).toEqual({ id: "inv-1", invoiceStatus: "rejected" });

    const refund1 = conn.execute.mock.calls[2];
    expect(String(refund1[0])).toMatch(/UPDATE client_provision SET provision_balance = provision_balance \+ \?/);
    expect(refund1[1]).toEqual([5000, "prov-1"]);

    const refund2 = conn.execute.mock.calls[4];
    expect(refund2[1]).toEqual([3000, "prov-2"]);

    const auditCall = conn.execute.mock.calls[8];
    expect(String(auditCall[0])).toMatch(/INSERT INTO client_invoice_audit_log/);
    expect(auditCall[1]).toEqual(expect.arrayContaining(["inv-1", "rejected", "u-1", "client disputed the charge"]));

    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it("works with zero linked deductions or PO particulars (a proforma never drew any provision or PO)", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[{ id: "inv-1", invoice_status: "proforma" }], []])
      .mockResolvedValueOnce([[], []]) // no deductions
      .mockResolvedValueOnce([[], []]) // no PO particulars
      .mockResolvedValueOnce([{}, []]) // UPDATE client_invoice
      .mockResolvedValueOnce([{}, []]); // INSERT audit log

    const result = await clientBillingApprovalService.rejectInvoice({
      invoiceId: "inv-1", reason: "no longer needed", userId: "u-1",
    });
    expect(result).toEqual({ id: "inv-1", invoiceStatus: "rejected" });
  });

  it("Gap 1 fix: reversing an approved invoice's rejection also refunds every linked PO particular, not just provisions", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[{ id: "inv-1", invoice_status: "approved" }], []]) // invoice lookup
      .mockResolvedValueOnce([[], []]) // no provision deductions on this invoice
      .mockResolvedValueOnce([[ // PO particulars linked to this invoice
        { id: "part-1", po_id: "po-1", amount_consumed: 12000 },
      ], []])
      .mockResolvedValueOnce([{}, []]) // refund PO balance
      .mockResolvedValueOnce([{}, []]) // delete the particular row
      .mockResolvedValueOnce([{}, []]) // UPDATE client_invoice
      .mockResolvedValueOnce([{}, []]); // INSERT audit log

    const result = await clientBillingApprovalService.rejectInvoice({
      invoiceId: "inv-1", reason: "PO cancelled by client", userId: "u-1",
    });

    expect(result).toEqual({ id: "inv-1", invoiceStatus: "rejected" });

    const poRefundCall = conn.execute.mock.calls[3];
    expect(String(poRefundCall[0])).toMatch(/UPDATE client_po_number SET balance_amount = balance_amount \+ \?/);
    expect(poRefundCall[1]).toEqual([12000, "po-1"]);

    const deleteParticularCall = conn.execute.mock.calls[4];
    expect(String(deleteParticularCall[0])).toMatch(/DELETE FROM client_po_particular WHERE id = \?/);
    expect(deleteParticularCall[1]).toEqual(["part-1"]);

    expect(conn.commit).toHaveBeenCalledTimes(1);
  });
});
