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
  finance_year: "2026-27", grand_total: 35400, total_amount: 30000, created_by: "maker-1",
  proforma_approved_at: "2026-10-14 10:00:00", po_numbers: null,
};

beforeEach(() => {
  getConnection.mockReset();
  mintBillNumber.mockReset();
});

describe("two-step approval (legacy View & Approve Proforma -> Invoice Approval)", () => {
  it("approveInvoice refuses to mint a bill number before the proforma is approved", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[{ ...APPROVABLE_INVOICE, is_migrated: 0, proforma_approved_at: null }], []]);
    await expect(
      clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-1" })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/must be approved first/) });
    expect(mintBillNumber).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it("approveProforma stamps the approver, logs proforma_approved and mints nothing", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[{ id: "inv-1", invoice_status: "proforma", is_migrated: 0, proforma_approved_at: null, total_amount: 100, created_by: "maker-1" }], []])
      .mockResolvedValue([{}, []]);
    const r = await clientBillingApprovalService.approveProforma({ invoiceId: "inv-1", userId: "u-9" });
    expect(r.id).toBe("inv-1");
    expect(mintBillNumber).not.toHaveBeenCalled();
    const update = conn.execute.mock.calls.find((c) => String(c[0]).includes("proforma_approved_by = ?"));
    expect(update?.[1]).toEqual(["u-9", "inv-1"]);
    const audit = conn.execute.mock.calls.find((c) => String(c[0]).includes("'proforma_approved'"));
    expect(audit).toBeDefined();
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it("approveProforma refuses an already approved proforma and a non-proforma", async () => {
    let conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[{ id: "inv-1", invoice_status: "proforma", is_migrated: 0, proforma_approved_at: "2026-10-14" }], []]);
    await expect(clientBillingApprovalService.approveProforma({ invoiceId: "inv-1", userId: "u" }))
      .rejects.toThrow(/already approved/);
    conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[{ id: "inv-1", invoice_status: "approved", is_migrated: 0, proforma_approved_at: null }], []]);
    await expect(clientBillingApprovalService.approveProforma({ invoiceId: "inv-1", userId: "u" }))
      .rejects.toThrow(/not in proforma status/);
  });

  it("approveInvoice consumes the PO numbers stored on the proforma when none are sent", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[{ ...APPROVABLE_INVOICE, is_migrated: 0, po_numbers: "PO-1" }], []])
      .mockResolvedValueOnce([[{ id: "po-1", balance_amount: 50000 }], []])
      .mockResolvedValueOnce([[{ companyName: "Mas Callnet India Pvt Ltd", stateCode: "09" }], []])
      .mockResolvedValue([{}, []]);
    mintBillNumber.mockResolvedValueOnce("09-171/26-27");
    const r = await clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-1" });
    expect(r.billNo).toBe("09-171/26-27");
    expect(conn.execute.mock.calls[1][1]).toEqual(["PO-1", "cc-1"]);
    const consume = conn.execute.mock.calls.find((c) => String(c[0]).includes("balance_amount = balance_amount - ?"));
    expect(consume?.[1]).toEqual([35400, "po-1"]);
  });
});

describe("approveInvoice", () => {
  it("design §3 guard: refuses to approve a migrated historical invoice (is_migrated=1)", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[{ ...APPROVABLE_INVOICE, is_migrated: 1 }], []]);

    await expect(
      clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-1" })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/migrated historical record/) });

    expect(mintBillNumber).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it("design §3 guard: does NOT refuse a normal is_migrated=0 invoice on that basis (mints normally)", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[{ ...APPROVABLE_INVOICE, is_migrated: 0 }], []])
      .mockResolvedValueOnce([[{ companyName: "Mas Callnet India Pvt Ltd", stateCode: "09" }], []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []]);
    mintBillNumber.mockResolvedValueOnce("09-01/26-27");

    const result = await clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-1" });
    expect(result).toEqual({ id: "inv-1", billNo: "09-01/26-27", invoiceStatus: "approved" });
  });

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
      .mockResolvedValueOnce([[], []]) // minted bill number not used by another live bill
      .mockResolvedValueOnce([[{ payment_terms: "45 days" }], []]) // payment terms -> due date
      .mockResolvedValueOnce([{}, []]) // UPDATE client_invoice
      .mockResolvedValueOnce([{}, []]); // INSERT client_invoice_audit_log
    mintBillNumber.mockResolvedValueOnce("09-01/26-27");

    const result = await clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-1" });

    // Due date fixed at billing: invoice date + 45 credit days from the cost centre's terms.
    const dupCheck = conn.execute.mock.calls[2];
    expect(String(dupCheck[0])).toMatch(/WHERE ci.bill_no = \? AND ci.id <> \? AND ci.invoice_status <> 'rejected'/);
    expect(dupCheck[1]).toEqual(["09-01/26-27", "inv-1", "mascallnetindiapvtltd"]);
    const billUpdate = conn.execute.mock.calls[4];
    expect(String(billUpdate[0])).toMatch(/due_date = DATE_ADD\(invoice_date, INTERVAL \? DAY\)/);
    expect(billUpdate[1]).toEqual(["09-01/26-27", 45, "u-1", "inv-1"]);
    expect(String(billUpdate[0])).toMatch(/approved_by = \?, approved_at = NOW\(\)/);

    // Gap 3 fix: approveInvoice passes its own open-transaction `conn` through so the mint
    // runs on that connection instead of a separate pool-level call (avoids mixing pool-level
    // execute with an open transaction while a FOR UPDATE lock is held).
    expect(mintBillNumber).toHaveBeenCalledWith("09", "Mas Callnet India Pvt Ltd", "2026-27", conn);
    expect(result).toEqual({ id: "inv-1", billNo: "09-01/26-27", invoiceStatus: "approved" });
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);

    const auditCall = conn.execute.mock.calls[5];
    expect(String(auditCall[0])).toMatch(/INSERT INTO client_invoice_audit_log/);
    expect(auditCall[1]).toEqual(expect.arrayContaining(["inv-1", "approved", "u-1"]));
  });

  it("rejects more than 4 stored PO numbers before touching the database further", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[{ ...APPROVABLE_INVOICE, po_numbers: "PO1,PO2,PO3,PO4,PO5" }], []]);

    await expect(
      clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-1" })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/more than 4/) });
    expect(conn.execute).toHaveBeenCalledTimes(1);
  });

  it("rejects when the sum of PO balances is less than the invoice grand total", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[{ ...APPROVABLE_INVOICE, po_numbers: "PO1" }], []]) // invoice lookup
      .mockResolvedValueOnce([[{ id: "po-1", balance_amount: 10000 }], []]); // PO lookup, one PO, insufficient

    await expect(
      clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-1" })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/PO balance/) });

    expect(mintBillNumber).not.toHaveBeenCalled();
  });

  it("re-checks the PO under locks: unknown or out-of-period POs are refused, not silently dropped", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[{ ...APPROVABLE_INVOICE, invoice_date: "2026-10-14", po_numbers: "PO1,PO-GHOST" }], []])
      .mockResolvedValueOnce([[{ id: "po-1", po_number: "PO1", period_from: "2026-04-01", period_to: "2026-09-30", balance_amount: 900000 }], []]);
    await expect(
      clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-1" })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/PO-GHOST not matched.*|PO1 does not cover/) });
    expect(mintBillNumber).not.toHaveBeenCalled();
  });

  it("consumes PO balances and records client_po_particular rows when POs cover the total", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[{ ...APPROVABLE_INVOICE, po_numbers: "PO1" }], []]) // invoice lookup
      .mockResolvedValueOnce([[{ id: "po-1", balance_amount: 40000 }], []]) // PO lookup
      .mockResolvedValueOnce([[{ companyName: "Mas Callnet India Pvt Ltd", stateCode: "09" }], []]) // cost centre lookup
      .mockResolvedValueOnce([[], []]) // bill-number duplicate check
      .mockResolvedValueOnce([{}, []]) // UPDATE client_po_number balance
      .mockResolvedValueOnce([{}, []]) // INSERT client_po_particular
      .mockResolvedValueOnce([{}, []]) // UPDATE client_invoice
      .mockResolvedValueOnce([{}, []]); // INSERT audit log
    mintBillNumber.mockResolvedValueOnce("09-01/26-27");

    await clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-1" });

    const poUpdateCall = conn.execute.mock.calls[4];
    expect(String(poUpdateCall[0])).toMatch(/UPDATE client_po_number/);
    const poParticularCall = conn.execute.mock.calls[5];
    expect(String(poParticularCall[0])).toMatch(/INSERT INTO client_po_particular/);
  });
});

describe("maker-checker, taxable total, PO approval and bill-number guard (audit 2026-10-14)", () => {
  it("approveProforma: the creator cannot approve their own proforma (403, nothing written)", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[{ id: "inv-1", invoice_status: "proforma", is_migrated: 0, proforma_approved_at: null, total_amount: 100, created_by: "u-1" }], []]);
    await expect(clientBillingApprovalService.approveProforma({ invoiceId: "inv-1", userId: "u-1" }))
      .rejects.toMatchObject({ statusCode: 403, message: "You created this proforma — another approver must approve it" });
    expect(conn.execute).toHaveBeenCalledTimes(1);
    expect(String(conn.execute.mock.calls[0][0])).toMatch(/created_by[\s\S]*FOR UPDATE/);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it("approveInvoice (step 2 and bulk): the creator cannot approve; someone else who did step 1 may", async () => {
    let conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[{ ...APPROVABLE_INVOICE, is_migrated: 0, created_by: "u-1" }], []]);
    await expect(clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-1" }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(mintBillNumber).not.toHaveBeenCalled();

    conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[{ ...APPROVABLE_INVOICE, is_migrated: 0, proforma_approved_by: "u-2" }], []])
      .mockResolvedValueOnce([[{ companyName: "Mas", stateCode: "09" }], []])
      .mockResolvedValue([[], []]);
    mintBillNumber.mockResolvedValueOnce("09-02/26-27");
    await expect(clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-2" }))
      .resolves.toMatchObject({ billNo: "09-02/26-27" });
  });

  it("refuses a zero / negative taxable total at both steps", async () => {
    let conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[{ id: "inv-1", invoice_status: "proforma", is_migrated: 0, proforma_approved_at: null, total_amount: "0.00", created_by: "m" }], []]);
    await expect(clientBillingApprovalService.approveProforma({ invoiceId: "inv-1", userId: "u-9" })).rejects.toThrow(/taxable total must be greater than zero/);
    conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[{ ...APPROVABLE_INVOICE, is_migrated: 0, total_amount: -500 }], []]);
    await expect(clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-9" })).rejects.toThrow(/taxable total must be greater than zero/);
    expect(mintBillNumber).not.toHaveBeenCalled();
  });

  it("ignores any PO override: only the stored PO numbers are locked and consumed", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[{ ...APPROVABLE_INVOICE, is_migrated: 0, po_numbers: "PO-STORED" }], []])
      .mockResolvedValueOnce([[{ id: "po-1", po_number: "PO-STORED", balance_amount: 50000 }], []])
      .mockResolvedValueOnce([[{ companyName: "Mas", stateCode: "09" }], []])
      .mockResolvedValue([[], []]);
    mintBillNumber.mockResolvedValueOnce("09-03/26-27");
    await clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-9", poNumbers: ["PO-OTHER"] } as never);
    expect(conn.execute.mock.calls[1][1]).toEqual(["PO-STORED", "cc-1"]);
  });

  it("refuses a PO that is still waiting for approval in the PO master", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[{ ...APPROVABLE_INVOICE, is_migrated: 0, po_numbers: "PO1" }], []])
      .mockResolvedValueOnce([[{ id: "po-1", po_number: "PO1", balance_amount: 900000, approval_status: "pending" }], []]);
    await expect(clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-9" }))
      .rejects.toThrow(/PO1 is waiting for approval in the PO master/);
    expect(String(conn.execute.mock.calls[1][0])).toMatch(/approval_status/);
    expect(mintBillNumber).not.toHaveBeenCalled();
  });

  it("refuses (409) a minted bill number another live bill of the same company carries, rolling back the counter", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[{ ...APPROVABLE_INVOICE, is_migrated: 0 }], []])
      .mockResolvedValueOnce([[{ companyName: "MAS Callnet India Pvt. Ltd.", stateCode: "09" }], []])
      .mockResolvedValueOnce([[{ id: "other-bill" }], []]);
    mintBillNumber.mockResolvedValueOnce("09-05/26-27");
    await expect(clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-9" }))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/09-05\/26-27 is already used/) });
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("SET invoice_status = 'approved'"))).toBe(false);
  });
});

describe("rejectInvoice", () => {
  it("design §3 guard: refuses to reject a migrated historical invoice (is_migrated=1)", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[{ id: "inv-1", invoice_status: "approved", is_migrated: 1 }], []]);

    await expect(
      clientBillingApprovalService.rejectInvoice({ invoiceId: "inv-1", reason: "test", userId: "u-1" })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/migrated historical record/) });
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it("design §3 guard: does NOT refuse a normal is_migrated=0 invoice on that basis", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[{ id: "inv-1", invoice_status: "proforma", is_migrated: 0 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []]);

    const result = await clientBillingApprovalService.rejectInvoice({
      invoiceId: "inv-1", reason: "no longer needed", userId: "u-1",
    });
    expect(result).toEqual({ id: "inv-1", invoiceStatus: "rejected" });
  });

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

  it("refuses to reject a billed (approved) invoice: that goes through the guarded void request", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[{ id: "inv-1", invoice_status: "approved", is_migrated: 0 }], []]);
    await expect(clientBillingApprovalService.rejectInvoice({ invoiceId: "inv-1", reason: "client disputed", userId: "u-1" }))
      .rejects.toThrow(/raise a delete \(void\) request/);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it("refunds every linked provision deduction, marks the proforma rejected, and writes one audit row", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[{ id: "inv-1", invoice_status: "proforma" }], []]) // invoice lookup
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
    // Billed invoices are reversed by the approved void request, which calls rejectInvoiceInTransaction.
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[], []]) // no provision deductions on this invoice
      .mockResolvedValueOnce([[ // PO particulars linked to this invoice
        { id: "part-1", po_id: "po-1", amount_consumed: 12000 },
      ], []])
      .mockResolvedValueOnce([{}, []]) // refund PO balance
      .mockResolvedValueOnce([{}, []]) // delete the particular row
      .mockResolvedValueOnce([{}, []]) // UPDATE client_invoice
      .mockResolvedValueOnce([{}, []]); // INSERT audit log

    await clientBillingApprovalService.rejectInvoiceInTransaction(conn as never, {
      invoiceId: "inv-1", reason: "PO cancelled by client", userId: "u-1",
    }, "void_approved");

    const poRefundCall = conn.execute.mock.calls[2];
    expect(String(poRefundCall[0])).toMatch(/UPDATE client_po_number SET balance_amount = balance_amount \+ \?/);
    expect(poRefundCall[1]).toEqual([12000, "po-1"]);

    const deleteParticularCall = conn.execute.mock.calls[3];
    expect(String(deleteParticularCall[0])).toMatch(/DELETE FROM client_po_particular WHERE id = \?/);
    expect(deleteParticularCall[1]).toEqual(["part-1"]);
  });
});
