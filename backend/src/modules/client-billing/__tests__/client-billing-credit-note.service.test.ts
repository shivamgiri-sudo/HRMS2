import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { getConnection } = vi.hoisted(() => ({ getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { getConnection } }));

const { mintCreditNoteNumber } = vi.hoisted(() => ({ mintCreditNoteNumber: vi.fn() }));
vi.mock("../client-billing-numbering.service.js", () => ({
  clientBillingNumberingService: { mintCreditNoteNumber, mintProformaNumber: vi.fn(), mintBillNumber: vi.fn() },
}));
vi.mock("../../finance/payment-voucher.service.js", () => ({ paymentVoucherService: {} }));

let clientBillingCreditNoteService: typeof import("../client-billing-credit-note.service.js")["clientBillingCreditNoteService"];
beforeAll(async () => {
  ({ clientBillingCreditNoteService } = await import("../client-billing-credit-note.service.js"));
});

type Row = Record<string, unknown>;
interface World {
  invoice?: Row | null;
  creditNote?: Row | null;
  costCentre?: Row;
  settled?: number;
  otherCredits?: number;
}

/** A connection that answers each statement by what it is, so the tests do not depend on call order. */
function mockConnection(w: World) {
  const conn = {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    execute: vi.fn(async (sql: string) => {
      if (/FROM client_invoice WHERE id = \? LIMIT 1 FOR UPDATE/.test(sql)) return [w.invoice ? [w.invoice] : [], []];
      if (/FROM client_credit_note WHERE id = \? LIMIT 1 FOR UPDATE/.test(sql)) return [w.creditNote ? [w.creditNote] : [], []];
      if (/cc.tally_head AS tallyHead/.test(sql)) return [[w.costCentre ?? {}], []];
      if (/AS companyName, b.gst_state_code AS stateCode/.test(sql)) return [[{ companyName: "Mas Callnet India Pvt Ltd", stateCode: "09", ...(w.costCentre ?? {}) }], []];
      if (/s.invoice_id = \?/.test(sql)) return [w.settled ? [{ settled: w.settled }] : [], []];
      if (/AS credited FROM client_credit_note/.test(sql)) return [[{ credited: w.otherCredits ?? 0 }], []];
      return [{ affectedRows: 1 }, []];
    }),
  };
  getConnection.mockResolvedValue(conn);
  return conn;
}

const APPROVED_INVOICE = {
  id: "inv-1", invoice_status: "approved", cost_centre_id: "cc-1", finance_year: "2026-27", is_migrated: 0,
  gst_type: "Integrated", apply_gst: 1, apply_tax_calc: 1, grand_total: "11800.00",
};
const INPUT = {
  invoiceId: "inv-1", category: "Subscription", financeYear: "2026-27", monthLabel: "Aug-26", creditDate: "2026-08-19",
  lines: [{ particulars: "Service credit", qty: 1, rate: 4500 }], userId: "maker",
};
const DRAFT = {
  id: "cn-1", invoice_id: "inv-1", cost_centre_id: "cc-1", finance_year: "2026-27", credit_status: "draft", credit_no: null,
  created_by: "maker", is_migrated: 0, total_amount: 4500, igst_amount: 810, cgst_amount: 0, sgst_amount: 0, grand_total: 5310,
};
const sqlOf = (conn: ReturnType<typeof mockConnection>, re: RegExp) => conn.execute.mock.calls.filter((c) => re.test(String(c[0])));

beforeEach(() => {
  getConnection.mockReset();
  mintCreditNoteNumber.mockReset();
});

describe("createCreditNote", () => {
  it("validates lines before touching the database (H2)", async () => {
    const conn = mockConnection({ invoice: APPROVED_INVOICE });
    for (const [lines, msg] of [
      [[], /line item/],
      [[{ particulars: "  ", qty: 1, rate: 1 }], /particulars are required/],
      [[{ particulars: "x", qty: 0, rate: 1 }], /quantity must be greater than zero/],
      [[{ particulars: "x", qty: 1, rate: -1 }], /rate must be zero or more/],
      [[{ particulars: "x".repeat(256), qty: 1, rate: 1 }], /at most 255/],
    ] as const) {
      await expect(clientBillingCreditNoteService.createCreditNote({ ...INPUT, lines: lines as never }))
        .rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(msg) });
    }
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it("refuses a zero total", async () => {
    mockConnection({ invoice: APPROVED_INVOICE });
    await expect(clientBillingCreditNoteService.createCreditNote({ ...INPUT, lines: [{ particulars: "x", qty: 1, rate: 0 }] }))
      .rejects.toThrow(/total must be greater than zero/);
  });

  it("validates the finance year, month, credit date (inside the FY) and category length", async () => {
    mockConnection({ invoice: APPROVED_INVOICE });
    await expect(clientBillingCreditNoteService.createCreditNote({ ...INPUT, financeYear: "2026-2027" })).rejects.toThrow(/financeYear/);
    await expect(clientBillingCreditNoteService.createCreditNote({ ...INPUT, creditDate: "2027-04-01" })).rejects.toThrow(/outside finance year/);
    await expect(clientBillingCreditNoteService.createCreditNote({ ...INPUT, creditDate: "19-08-2026" })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(clientBillingCreditNoteService.createCreditNote({ ...INPUT, category: "c".repeat(51) })).rejects.toThrow(/category/);
  });

  it("design §3 guard: refuses a migrated historical invoice; locks the invoice FOR UPDATE", async () => {
    const conn = mockConnection({ invoice: { ...APPROVED_INVOICE, is_migrated: 1 } });
    await expect(clientBillingCreditNoteService.createCreditNote(INPUT))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/migrated historical record/) });
    expect(sqlOf(conn, /FROM client_invoice WHERE id = \? LIMIT 1 FOR UPDATE/)).toHaveLength(1);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it("refuses a bill that is not approved (proforma or voided) and a missing bill", async () => {
    mockConnection({ invoice: { ...APPROVED_INVOICE, invoice_status: "rejected" } });
    await expect(clientBillingCreditNoteService.createCreditNote(INPUT)).rejects.toThrow(/not approved/);
    mockConnection({ invoice: null });
    await expect(clientBillingCreditNoteService.createCreditNote(INPUT)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("creates an UNNUMBERED draft, GST type from the bill, whole-rupee tax, audit row", async () => {
    const conn = mockConnection({ invoice: { ...APPROVED_INVOICE, gst_type: "Intrastate" }, costCentre: { tallyHead: "VODAFONE (DELHI)", clientTallyName: "Vodafone" } });
    const result = await clientBillingCreditNoteService.createCreditNote({ ...INPUT, lines: [{ particulars: "Credit", qty: 1, rate: 1001 }] });
    expect(mintCreditNoteNumber).not.toHaveBeenCalled();
    // 1001 x 9% = 90.09 -> 90 each (whole rupee, same rule as the bill).
    expect(result).toEqual({
      id: expect.any(String), creditNo: null, totalAmount: 1001, igstAmount: 0, cgstAmount: 90, sgstAmount: 90,
      grandTotal: 1181, creditStatus: "draft",
    });
    const insert = sqlOf(conn, /INSERT INTO client_credit_note\s/)[0];
    expect(String(insert[0])).toMatch(/NULL, 'draft'/);
    const params = insert[1] as unknown[];
    expect(params).toContain("Intrastate");
    expect(params[params.length - 2]).toBe("VODAFONE (DELHI)");
    expect(params[params.length - 1]).toBe("Vodafone");
    expect(sqlOf(conn, /INSERT INTO client_credit_note_audit/)[0][1]).toEqual(expect.arrayContaining(["created", "maker"]));
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it("no tax when the bill carried none (apply_gst / apply_tax_calc off)", async () => {
    mockConnection({ invoice: { ...APPROVED_INVOICE, apply_tax_calc: 0 } });
    const r = await clientBillingCreditNoteService.createCreditNote(INPUT);
    expect(r).toMatchObject({ igstAmount: 0, cgstAmount: 0, sgstAmount: 0, grandTotal: 4500 });
  });

  it("caps the credit at bill total - settled - other draft/approved credit notes (H3)", async () => {
    // 11,800 - 5,000 settled - 1,500 other credits = 5,300 left; 4,500 + 18% = 5,310 is over by 10.
    const conn = mockConnection({ invoice: APPROVED_INVOICE, settled: 5000, otherCredits: 1500 });
    await expect(clientBillingCreditNoteService.createCreditNote(INPUT)).rejects.toThrow(/more than what can still be credited/);
    expect(sqlOf(conn, /INSERT INTO client_credit_note\s/)).toHaveLength(0);
    mockConnection({ invoice: APPROVED_INVOICE, settled: 5000, otherCredits: 1490 });
    await expect(clientBillingCreditNoteService.createCreditNote(INPUT)).resolves.toMatchObject({ grandTotal: 5310 });
  });
});

describe("approveCreditNote", () => {
  it("design §3 guard: refuses a migrated historical credit note", async () => {
    const conn = mockConnection({ creditNote: { ...DRAFT, is_migrated: 1 } });
    await expect(clientBillingCreditNoteService.approveCreditNote({ creditNoteId: "cn-1", userId: "checker" }))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/migrated historical record/) });
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it("maker-checker: the creator cannot approve (403)", async () => {
    mockConnection({ creditNote: DRAFT, invoice: APPROVED_INVOICE });
    await expect(clientBillingCreditNoteService.approveCreditNote({ creditNoteId: "cn-1", userId: "maker" }))
      .rejects.toMatchObject({ statusCode: 403, message: "You created this credit note — another approver must approve it" });
    expect(mintCreditNoteNumber).not.toHaveBeenCalled();
  });

  it("refuses an approved / rejected / missing credit note", async () => {
    mockConnection({ creditNote: { ...DRAFT, credit_status: "approved" } });
    await expect(clientBillingCreditNoteService.approveCreditNote({ creditNoteId: "cn-1", userId: "c" })).rejects.toThrow(/already approved/);
    mockConnection({ creditNote: { ...DRAFT, credit_status: "rejected" } });
    await expect(clientBillingCreditNoteService.approveCreditNote({ creditNoteId: "cn-1", userId: "c" })).rejects.toThrow(/already rejected/);
    mockConnection({ creditNote: null });
    await expect(clientBillingCreditNoteService.approveCreditNote({ creditNoteId: "x", userId: "c" })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("re-checks the bill is still approved and the cap still holds", async () => {
    mockConnection({ creditNote: DRAFT, invoice: { ...APPROVED_INVOICE, invoice_status: "rejected" } });
    await expect(clientBillingCreditNoteService.approveCreditNote({ creditNoteId: "cn-1", userId: "checker" })).rejects.toThrow(/not approved/);
    const conn = mockConnection({ creditNote: DRAFT, invoice: APPROVED_INVOICE, settled: 8000 });
    await expect(clientBillingCreditNoteService.approveCreditNote({ creditNoteId: "cn-1", userId: "checker" })).rejects.toThrow(/more than what can still be credited/);
    // The note itself is excluded from "other credit notes".
    expect(sqlOf(conn, /AS credited FROM client_credit_note/)[0][1]).toEqual(["inv-1", "cn-1"]);
    expect(mintCreditNoteNumber).not.toHaveBeenCalled();
  });

  it("mints the number at approval, on the open connection, and audits", async () => {
    const conn = mockConnection({ creditNote: DRAFT, invoice: APPROVED_INVOICE });
    mintCreditNoteNumber.mockResolvedValueOnce("CN-09-01/26-27");
    const result = await clientBillingCreditNoteService.approveCreditNote({ creditNoteId: "cn-1", userId: "checker" });
    expect(mintCreditNoteNumber).toHaveBeenCalledWith("09", "Mas Callnet India Pvt Ltd", "2026-27", conn);
    expect(result).toEqual({
      id: "cn-1", creditNo: "CN-09-01/26-27", totalAmount: 4500, igstAmount: 810, cgstAmount: 0, sgstAmount: 0,
      grandTotal: 5310, creditStatus: "approved",
    });
    const update = sqlOf(conn, /UPDATE client_credit_note SET credit_status = 'approved'/)[0];
    expect(update[1]).toEqual(["CN-09-01/26-27", "checker", "cn-1"]);
    expect(sqlOf(conn, /INSERT INTO client_credit_note_audit/)[0][1]).toEqual(expect.arrayContaining(["approved", "checker"]));
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });
});

describe("rejectCreditNote", () => {
  it("needs a reason, rejects a draft (the creator may withdraw it), records rejected_by and audits", async () => {
    mockConnection({ creditNote: DRAFT });
    await expect(clientBillingCreditNoteService.rejectCreditNote({ creditNoteId: "cn-1", reason: "no", userId: "maker" })).rejects.toThrow(/at least 5/);
    const conn = mockConnection({ creditNote: DRAFT });
    const r = await clientBillingCreditNoteService.rejectCreditNote({ creditNoteId: "cn-1", reason: "duplicate of CN-7", userId: "maker" });
    expect(r).toMatchObject({ creditStatus: "rejected", creditNo: null });
    expect(sqlOf(conn, /SET credit_status = 'rejected', rejected_by = \?/)[0][1]).toEqual(["maker", "duplicate of CN-7", "cn-1"]);
    expect(sqlOf(conn, /INSERT INTO client_credit_note_audit/)[0][1]).toEqual(expect.arrayContaining(["rejected", "duplicate of CN-7"]));
    expect(mintCreditNoteNumber).not.toHaveBeenCalled();
  });

  it("refuses an approved credit note", async () => {
    mockConnection({ creditNote: { ...DRAFT, credit_status: "approved" } });
    await expect(clientBillingCreditNoteService.rejectCreditNote({ creditNoteId: "cn-1", reason: "changed mind", userId: "c" })).rejects.toThrow(/already approved/);
  });
});
