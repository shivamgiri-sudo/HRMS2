import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const conn = {
  execute: vi.fn(),
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};
const { getConnection, poolExecute } = vi.hoisted(() => ({
  getConnection: vi.fn(),
  poolExecute: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: { getConnection, execute: poolExecute },
}));

const { rejectInvoiceInTransaction, approveInvoice } = vi.hoisted(() => ({
  rejectInvoiceInTransaction: vi.fn(),
  approveInvoice: vi.fn(),
}));
vi.mock("../client-billing-approval.service.js", () => ({
  clientBillingApprovalService: { rejectInvoiceInTransaction, approveInvoice },
}));

const { send, isConfigured } = vi.hoisted(() => ({
  send: vi.fn(),
  isConfigured: vi.fn(),
}));
vi.mock("../../communication/email.service.js", () => ({
  emailService: { send, isConfigured },
}));

const { generateInvoicePdf } = vi.hoisted(() => ({
  generateInvoicePdf: vi.fn(),
}));
vi.mock("../client-billing-pdf.service.js", () => ({
  clientBillingPdfService: { generateInvoicePdf },
}));

let changeSvc: (typeof import("../client-billing-change-request.service.js"))["clientBillingChangeRequestService"];
let editSvc: (typeof import("../client-billing-edit.service.js"))["clientBillingEditService"];
let submitSvc: (typeof import("../client-billing-submit.service.js"))["clientBillingSubmitService"];

beforeAll(async () => {
  ({ clientBillingChangeRequestService: changeSvc } =
    await import("../client-billing-change-request.service.js"));
  ({ clientBillingEditService: editSvc } =
    await import("../client-billing-edit.service.js"));
  ({ clientBillingSubmitService: submitSvc } =
    await import("../client-billing-submit.service.js"));
});

beforeEach(() => {
  for (const fn of [
    conn.execute,
    conn.beginTransaction,
    conn.commit,
    conn.rollback,
    conn.release,
    getConnection,
    poolExecute,
    rejectInvoiceInTransaction,
    approveInvoice,
    send,
    generateInvoicePdf,
  ]) {
    fn.mockReset();
  }
  getConnection.mockResolvedValue(conn);
});

describe("createChangeRequest", () => {
  it("requires a real reason and a valid requested type", async () => {
    await expect(
      changeSvc.createChangeRequest({
        invoiceId: "i",
        requestType: "void",
        reason: "no",
        userId: "u",
      }),
    ).rejects.toThrow(/reason/);
    await expect(
      changeSvc.createChangeRequest({
        invoiceId: "i",
        requestType: "status_change",
        reason: "wrong type chosen",
        requestedValue: "Nonsense",
        userId: "u",
      }),
    ).rejects.toThrow(/requestedValue must be one of/);
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("refuses a migrated historical invoice and a duplicate pending request", async () => {
    conn.execute.mockResolvedValueOnce([
      [
        {
          id: "i",
          invoice_status: "approved",
          category: "Others",
          is_migrated: 1,
        },
      ],
      [],
    ]);
    await expect(
      changeSvc.createChangeRequest({
        invoiceId: "i",
        requestType: "void",
        reason: "duplicate bill",
        userId: "u",
      }),
    ).rejects.toThrow(/migrated/);
    expect(conn.rollback).toHaveBeenCalled();

    conn.execute.mockReset();
    conn.execute
      .mockResolvedValueOnce([
        [
          {
            id: "i",
            invoice_status: "approved",
            category: "Others",
            is_migrated: 0,
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([[{ id: "r1" }], []]);
    await expect(
      changeSvc.createChangeRequest({
        invoiceId: "i",
        requestType: "void",
        reason: "duplicate bill",
        userId: "u",
      }),
    ).rejects.toThrow(/already pending/);
  });

  it("records the request and a void_requested audit row", async () => {
    conn.execute
      .mockResolvedValueOnce([
        [
          {
            id: "i",
            invoice_status: "approved",
            category: "Others",
            is_migrated: 0,
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValue([{}, []]);
    const r = await changeSvc.createChangeRequest({
      invoiceId: "i",
      requestType: "void",
      reason: "billed twice",
      userId: "maker",
    });
    expect(r.id).toEqual(expect.any(String));
    const audit = conn.execute.mock.calls.find((c) =>
      /client_invoice_audit_log/.test(String(c[0])),
    );
    expect(audit?.[1]).toEqual(
      expect.arrayContaining(["void_requested", "maker"]),
    );
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });
});

describe("decideChangeRequest (maker-checker)", () => {
  const pendingVoid = {
    id: "r1",
    invoice_id: "i",
    request_type: "void",
    request_status: "pending",
    requested_by: "maker",
    reason: "billed twice",
    current_value: "approved",
    requested_value: null,
  };

  it("blocks the requester from deciding their own request", async () => {
    conn.execute.mockResolvedValueOnce([[pendingVoid], []]);
    await expect(
      changeSvc.decideChangeRequest({
        requestId: "r1",
        decision: "approve",
        userId: "maker",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(rejectInvoiceInTransaction).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalled();
  });

  it("approving a void reverses balances through the shared reject path and closes the request", async () => {
    conn.execute
      .mockResolvedValueOnce([[pendingVoid], []]) // request lock
      .mockResolvedValueOnce([
        [{ id: "i", invoice_status: "approved", is_migrated: 0 }],
        [],
      ]) // invoice lock
      .mockResolvedValueOnce([[{ n: 0 }], []]) // approved credit notes
      .mockResolvedValueOnce([[], []]) // receipt table absent
      .mockResolvedValue([{}, []]);
    rejectInvoiceInTransaction.mockResolvedValueOnce({
      id: "i",
      invoiceStatus: "rejected",
    });
    const r = await changeSvc.decideChangeRequest({
      requestId: "r1",
      decision: "approve",
      userId: "checker",
    });
    expect(r.requestStatus).toBe("approved");
    expect(rejectInvoiceInTransaction).toHaveBeenCalledWith(
      conn,
      expect.objectContaining({ invoiceId: "i", userId: "checker" }),
      "void_approved",
    );
    const upd = conn.execute.mock.calls.at(-1)!;
    expect(String(upd[0])).toMatch(/UPDATE client_invoice_change_request/);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it("blocks a void when an approved credit note exists", async () => {
    conn.execute
      .mockResolvedValueOnce([[pendingVoid], []])
      .mockResolvedValueOnce([
        [{ id: "i", invoice_status: "approved", is_migrated: 0 }],
        [],
      ])
      .mockResolvedValueOnce([[{ n: 1 }], []]);
    await expect(
      changeSvc.decideChangeRequest({
        requestId: "r1",
        decision: "approve",
        userId: "checker",
      }),
    ).rejects.toThrow(/credit note/);
    expect(rejectInvoiceInTransaction).not.toHaveBeenCalled();
  });

  it("declining needs a note and does not touch the invoice", async () => {
    await expect(
      changeSvc.decideChangeRequest({
        requestId: "r1",
        decision: "decline",
        userId: "checker",
      }),
    ).rejects.toThrow(/note is required/);
    conn.execute
      .mockResolvedValueOnce([[pendingVoid], []])
      .mockResolvedValue([{}, []]);
    const r = await changeSvc.decideChangeRequest({
      requestId: "r1",
      decision: "decline",
      note: "bill is valid",
      userId: "checker",
    });
    expect(r.requestStatus).toBe("declined");
    expect(rejectInvoiceInTransaction).not.toHaveBeenCalled();
  });
});

describe("bulkApprove", () => {
  it("continues after a failure and reports each result", async () => {
    approveInvoice
      .mockResolvedValueOnce({
        id: "a",
        billNo: "09-01/26-27",
        invoiceStatus: "approved",
      })
      .mockRejectedValueOnce(new Error("not in proforma status"));
    const results = await changeSvc.bulkApprove(["a", "b", "a"], "u");
    expect(results).toEqual([
      { invoiceId: "a", ok: true, billNo: "09-01/26-27" },
      { invoiceId: "b", ok: false, error: "not in proforma status" },
    ]);
    await expect(changeSvc.bulkApprove([], "u")).rejects.toThrow(/required/);
  });
});

describe("updateProforma", () => {
  const proforma = {
    id: "i",
    cost_centre_id: "cc",
    invoice_status: "proforma",
    is_migrated: 0,
    finance_year: "2026-27",
    month_label: "Aug-26",
    invoice_date: "2026-08-18",
    category: "Subscription",
    description: null,
    apply_gst: 1,
    gst_type: "Integrated",
    total_amount: 30000,
    grand_total: 35400,
    po_numbers: null,
    grn_no: null,
    jcc_no: null,
    rcm_applicable: 0,
  };

  it("only edits live proformas", async () => {
    conn.execute.mockResolvedValueOnce([
      [{ ...proforma, invoice_status: "approved" }],
      [],
    ]);
    await expect(
      editSvc.updateProforma({
        invoiceId: "i",
        userId: "u",
        category: "Topup",
      }),
    ).rejects.toThrow(/Only a proforma/);
    conn.execute.mockReset();
    conn.execute.mockResolvedValueOnce([[{ ...proforma, is_migrated: 1 }], []]);
    await expect(
      editSvc.updateProforma({ invoiceId: "i", userId: "u" }),
    ).rejects.toThrow(/migrated/);
  });

  it("recomputes amounts from the new lines, re-derives GST and writes an edited audit row", async () => {
    conn.execute
      .mockResolvedValueOnce([[proforma], []]) // lock
      .mockResolvedValueOnce([
        [
          {
            gstType: "Integrated",
            stateCode: "09",
            supplierGstin: "09AAACM5866H1Z6",
            clientGstin: "09AAACM5866H1Z6",
          },
        ],
        [],
      ]) // same state -> Intrastate
      .mockResolvedValue([{}, []]);
    const r = await editSvc.updateProforma({
      invoiceId: "i",
      userId: "u",
      lines: [{ particulars: "Seats", qty: 2, rate: 5000 }],
    });
    expect(r).toMatchObject({
      totalAmount: 10000,
      cgstAmount: 900,
      sgstAmount: 900,
      igstAmount: 0,
      grandTotal: 11800,
      gstType: "Intrastate",
    });
    expect(r.changed.join(" ")).toMatch(/gstType: Integrated → Intrastate/);
    const audit = conn.execute.mock.calls.find((c) =>
      /client_invoice_audit_log/.test(String(c[0])),
    );
    expect(audit?.[1]).toEqual(expect.arrayContaining(["u"]));
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it("rejects bad finance-year / month combinations before writing", async () => {
    conn.execute.mockResolvedValueOnce([[proforma], []]);
    await expect(
      editSvc.updateProforma({
        invoiceId: "i",
        userId: "u",
        financeYear: "2026-2027",
      }),
    ).rejects.toThrow(/financeYear/);
    expect(conn.commit).not.toHaveBeenCalled();
  });
});

describe("submitToClient", () => {
  const approved = {
    id: "i",
    invoice_status: "approved",
    bill_no: "09-172/26-27",
    grand_total: 168504,
    month_label: "Sep-26",
  };

  it("refuses a proforma", async () => {
    poolExecute.mockResolvedValueOnce([
      [{ ...approved, invoice_status: "proforma", bill_no: null }],
      [],
    ]);
    await expect(
      submitSvc.submitToClient({ invoiceId: "i", to: "a@b.com", userId: "u" }),
    ).rejects.toThrow(/approved tax invoice/);
    expect(send).not.toHaveBeenCalled();
  });

  it("emails the PDF, logs the submission and stamps last_sent_at", async () => {
    poolExecute
      .mockResolvedValueOnce([[approved], []])
      .mockResolvedValue([{}, []]);
    generateInvoicePdf.mockResolvedValueOnce(Buffer.from("%PDF-1.3"));
    send.mockResolvedValueOnce({ messageId: "<m1>" });
    const r = await submitSvc.submitToClient({
      invoiceId: "i",
      to: ["Client@Corp.com"],
      cc: "ar@corp.com",
      userId: "u",
    });
    expect(r).toMatchObject({
      billNo: "09-172/26-27",
      to: ["client@corp.com"],
      cc: ["ar@corp.com"],
    });
    const mail = send.mock.calls[0][0];
    expect(mail.attachments[0]).toMatchObject({
      filename: "09-172_26-27.pdf",
      contentType: "application/pdf",
    });
    const sqls = poolExecute.mock.calls.map((c) => String(c[0]));
    expect(
      sqls.some((q) => /INSERT INTO client_invoice_submission/.test(q)),
    ).toBe(true);
    expect(sqls.some((q) => /SET last_sent_at/.test(q))).toBe(true);
  });

  it("logs a failed attempt and surfaces a 502 instead of swallowing it", async () => {
    poolExecute
      .mockResolvedValueOnce([[approved], []])
      .mockResolvedValue([{}, []]);
    generateInvoicePdf.mockResolvedValueOnce(Buffer.from("%PDF-1.3"));
    send.mockRejectedValueOnce(new Error("SMTP is not configured"));
    await expect(
      submitSvc.submitToClient({ invoiceId: "i", to: "a@b.com", userId: "u" }),
    ).rejects.toMatchObject({ statusCode: 502 });
    const insert = poolExecute.mock.calls.find((c) =>
      /INSERT INTO client_invoice_submission/.test(String(c[0])),
    );
    expect(insert?.[1]).toEqual(expect.arrayContaining(["failed"]));
    expect(
      poolExecute.mock.calls.some((c) => /SET last_sent_at/.test(String(c[0]))),
    ).toBe(false);
  });
});
