import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const conn = { execute: vi.fn(), query: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
const { getConnection, poolQuery, poolExecute } = vi.hoisted(() => ({ getConnection: vi.fn(), poolQuery: vi.fn(), poolExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { getConnection, query: poolQuery, execute: poolExecute, escape: (v: string) => `'${v}'` } }));
const { raise, withdraw } = vi.hoisted(() => ({ raise: vi.fn(), withdraw: vi.fn() }));
vi.mock("../../finance/payment-voucher.service.js", () => ({ paymentVoucherService: { raise, withdraw } }));

let mod: typeof import("../client-billing-receipt.service.js");
beforeAll(async () => { mod = await import("../client-billing-receipt.service.js"); });
beforeEach(() => {
  for (const f of [...Object.values(conn), getConnection, poolQuery, poolExecute, raise, withdraw]) f.mockReset();
  getConnection.mockResolvedValue(conn);
});

const today = new Date().toISOString().slice(0, 10);
const bill = (o: Record<string, unknown> = {}) => ({ id: "i1", bill_no: "09-192/26-27", invoice_status: "approved", is_migrated: 0, grand_total: "425000.00", cost_centre_id: "cc", company_name: "Mas Callnet India Pvt Ltd", branch_id: "b1", client_name: "Onfido Limited", is_mas: 1, ...o });

describe("rules", () => {
  it("credit days from free-text payment terms, default 30", () => {
    expect(mod.creditDays("45 days")).toBe(45);
    expect(mod.creditDays("Net 60")).toBe(60);
    expect(mod.creditDays("")).toBe(30);
    expect(mod.creditDays("immediate")).toBe(30);
    expect(mod.creditDays("999 days")).toBe(30);
  });
  it("finance year of a receipt date", () => {
    expect(mod.financeYearOf("2026-10-14")).toBe("2026-27");
    expect(mod.financeYearOf("2027-03-31")).toBe("2026-27");
    expect(mod.financeYearOf("2027-04-01")).toBe("2027-28");
  });
});

describe("createReceipt", () => {
  const base = { receiptDate: today, bankAccountId: "bank", paymentMode: "NEFT", userId: "u" };

  function scriptHappyPath(outstandingSettled = "0") {
    conn.query
      .mockResolvedValueOnce([[{ id: "bank", active_status: 1 }], []]) // bank
      .mockResolvedValueOnce([[bill()], []]) // lock bills
      .mockResolvedValueOnce([[{ id: "i1", settled: outstandingSettled, credited: "0" }], []]) // settled
      .mockResolvedValue([[{ id: "i1", grand_total: "425000.00", legacy_id: null, received: "382500", tds: "42500", deduction: "0", settled: "425000", last_receipt_date: today, credited: "0" }], []]);
    conn.execute.mockResolvedValueOnce([{ insertId: 7 }, []]).mockResolvedValue([{}, []]);
    poolQuery.mockResolvedValue([[{ bill_no: "09-192/26-27", id: "r1", allocations: [] }], []]);
    poolExecute.mockResolvedValue([{}, []]);
    raise.mockResolvedValue({ id: "pv1" });
  }

  it("records received + TDS against a bill, numbers it RCPT/26-27/00007 and raises one bank voucher for the received part", async () => {
    scriptHappyPath();
    await mod.clientBillingReceiptService.createReceipt({ ...base, amountReceived: 382500, allocations: [{ invoiceId: "i1", received: 382500, tds: 42500 }] });
    const insert = conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO client_receipt\n"));
    expect(insert?.[1]?.[1]).toMatch(/^RCPT\/\d{2}-\d{2}\/00007$/);
    expect(insert?.[1]?.slice(7, 10)).toEqual([382500, 42500, 0]);
    const alloc = conn.execute.mock.calls.find((c) => String(c[0]).includes("client_receipt_allocation"));
    expect(alloc?.[1]?.slice(3)).toEqual([382500, 42500, 0]);
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ sourceType: "sales_receipt", amount: 382500, clientName: "Onfido Limited", paymentMode: "NEFT" }), "u", undefined);
    expect(poolExecute).toHaveBeenCalledWith("UPDATE client_receipt SET voucher_id = ? WHERE id = ?", ["pv1", expect.any(String)]);
    const status = conn.execute.mock.calls.find((c) => String(c[0]).includes("client_invoice_payment_status"));
    expect(status?.[1]?.[3]).toBe("paid");
  });

  it("refuses settling more than the outstanding", async () => {
    scriptHappyPath("400000");
    await expect(mod.clientBillingReceiptService.createReceipt({ ...base, allocations: [{ invoiceId: "i1", received: 30000 }] }))
      .rejects.toThrow(/more than its outstanding 25000/);
    expect(conn.rollback).toHaveBeenCalled();
    expect(raise).not.toHaveBeenCalled();
  });

  it("refuses a declared amount that does not match the allocations, future dates, bad modes", async () => {
    await expect(mod.clientBillingReceiptService.createReceipt({ ...base, amountReceived: 100, allocations: [{ invoiceId: "i1", received: 99 }] })).rejects.toThrow(/does not match/);
    await expect(mod.clientBillingReceiptService.createReceipt({ ...base, receiptDate: "2999-01-01", allocations: [{ invoiceId: "i1", received: 1 }] })).rejects.toThrow(/future/);
    await expect(mod.clientBillingReceiptService.createReceipt({ ...base, paymentMode: "Bitcoin", allocations: [{ invoiceId: "i1", received: 1 }] })).rejects.toThrow(/Payment mode/);
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("refuses a bill of another company (IDC): MAS Callnet only", async () => {
    conn.query.mockResolvedValueOnce([[{ id: "bank", active_status: 1 }], []]).mockResolvedValueOnce([[bill({ is_mas: 0, company_name: "IDC" })], []]).mockResolvedValueOnce([[{ id: "i1", settled: "0", credited: "0" }], []]);
    await expect(mod.clientBillingReceiptService.createReceipt({ ...base, allocations: [{ invoiceId: "i1", received: 10 }] })).rejects.toThrow(/not a MAS Callnet/);
  });

  it("refuses I-Spark (migrated) bills until the legacy collections import is done", async () => {
    conn.query.mockResolvedValueOnce([[{ id: "bank", active_status: 1 }], []]).mockResolvedValueOnce([[bill({ is_migrated: 1 })], []]).mockResolvedValueOnce([[{ id: "i1", settled: "0", credited: "0" }], []]);
    await expect(mod.clientBillingReceiptService.createReceipt({ ...base, allocations: [{ invoiceId: "i1", received: 10 }] })).rejects.toThrow(/legacy import/);
  });

  it("voids the receipt when the bank voucher cannot be raised", async () => {
    scriptHappyPath();
    raise.mockRejectedValueOnce(new Error("Bank account is closed"));
    await expect(mod.clientBillingReceiptService.createReceipt({ ...base, allocations: [{ invoiceId: "i1", received: 1000 }] })).rejects.toThrow(/could not be raised/);
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("SET status = 'void'"))).toBe(true);
  });
});

describe("voidReceipt", () => {
  it("refuses after the voucher is released, withdraws a pending voucher otherwise", async () => {
    poolQuery.mockResolvedValueOnce([[{ id: "r1", status: "recorded", is_migrated: 0, voucher_id: "pv1", voucher_status: "released", receipt_no: "RCPT/26-27/00001" }], []]);
    await expect(mod.clientBillingReceiptService.voidReceipt("r1", "client paid twice", "u")).rejects.toThrow(/journal/);
    poolQuery.mockReset();
    poolQuery
      .mockResolvedValueOnce([[{ id: "r1", status: "recorded", is_migrated: 0, voucher_id: "pv1", voucher_status: "raised", receipt_no: "RCPT/26-27/00001" }], []])
      .mockResolvedValue([[{ id: "r1", allocations: [] }], []]);
    conn.query.mockResolvedValue([[], []]);
    conn.execute.mockResolvedValue([{}, []]);
    await mod.clientBillingReceiptService.voidReceipt("r1", "entered twice by mistake", "u", "finance_head");
    expect(withdraw).toHaveBeenCalledWith("pv1", "u", "finance_head", expect.stringContaining("voided"));
  });
});
