import { describe, expect, it } from "vitest";
import {
  vendorGrnLines,
  imprestAllocationLines,
  vendorAdvanceLines,
  vendorAdvanceApplicationLines,
  generalLines,
} from "../payment-voucher-journal-lines.js";

function totals(lines: { debitAmount?: number; creditAmount?: number }[]) {
  return {
    debit: lines.reduce((s, l) => s + (l.debitAmount ?? 0), 0),
    credit: lines.reduce((s, l) => s + (l.creditAmount ?? 0), 0),
  };
}

describe("vendorGrnLines", () => {
  it("clears the vendor's full liability (net + tds) even though only net leaves the bank", () => {
    const lines = vendorGrnLines({
      vendorId: "vendor-acme", bankAccountId: "bank-hq",
      netAmount: 9800, tdsAmount: 200, tdsPayableAccountId: "pam-tds",
    });
    expect(lines).toHaveLength(3);
    const { debit, credit } = totals(lines);
    expect(debit).toBe(credit);
    expect(debit).toBe(10000);
    expect(lines[0]).toMatchObject({ accountType: "vendor", debitAmount: 10000 });
    expect(lines[1]).toMatchObject({ accountType: "bank_account", creditAmount: 9800 });
    expect(lines[2]).toMatchObject({ accountType: "payable_account", accountId: "pam-tds", creditAmount: 200 });
  });

  it("posts just two lines when there is no TDS", () => {
    const lines = vendorGrnLines({ vendorId: "v1", bankAccountId: "b1", netAmount: 5000, tdsAmount: 0, tdsPayableAccountId: null });
    expect(lines).toHaveLength(2);
    expect(totals(lines)).toEqual({ debit: 5000, credit: 5000 });
  });

  it("throws if TDS was withheld but no TDS Payable account is configured", () => {
    expect(() => vendorGrnLines({ vendorId: "v1", bankAccountId: "b1", netAmount: 100, tdsAmount: 10, tdsPayableAccountId: null }))
      .toThrow(/TDS Payable/);
  });
});

describe("imprestAllocationLines", () => {
  it("Dr Imprest Float / Cr Bank, balanced", () => {
    const lines = imprestAllocationLines({ imprestFloatAccountId: "pam-imprest", bankAccountId: "bank-hq", amount: 3000 });
    expect(lines).toEqual([
      { accountType: "payable_account", accountId: "pam-imprest", debitAmount: 3000 },
      { accountType: "bank_account", accountId: "bank-hq", creditAmount: 3000 },
    ]);
  });
});

describe("vendorAdvanceLines", () => {
  it("Dr Vendor / Cr Bank, balanced", () => {
    const lines = vendorAdvanceLines({ vendorId: "vendor-acme", bankAccountId: "bank-hq", amount: 2000 });
    expect(totals(lines)).toEqual({ debit: 2000, credit: 2000 });
    expect(lines[0].accountType).toBe("vendor");
    expect(lines[1].accountType).toBe("bank_account");
  });
});

describe("vendorAdvanceApplicationLines", () => {
  it("returns nothing when no TDS is withheld — the principal already nets on the vendor's own ledger", () => {
    expect(vendorAdvanceApplicationLines({ vendorId: "v1", tdsAmount: 0, tdsPayableAccountId: null })).toEqual([]);
  });

  it("posts Dr Vendor / Cr TDS Payable when this installment withholds tax", () => {
    const lines = vendorAdvanceApplicationLines({ vendorId: "vendor-acme", tdsAmount: 50, tdsPayableAccountId: "pam-tds" });
    expect(totals(lines)).toEqual({ debit: 50, credit: 50 });
    expect(lines[0]).toMatchObject({ accountType: "vendor", debitAmount: 50 });
    expect(lines[1]).toMatchObject({ accountType: "payable_account", accountId: "pam-tds", creditAmount: 50 });
  });

  it("throws if TDS was withheld but no TDS Payable account is configured", () => {
    expect(() => vendorAdvanceApplicationLines({ vendorId: "v1", tdsAmount: 10, tdsPayableAccountId: null })).toThrow(/TDS Payable/);
  });
});

describe("generalLines", () => {
  it("Dr the raised-under payable account / Cr Bank, balanced", () => {
    const lines = generalLines({ payableAccountId: "pam-salary-payable", bankAccountId: "bank-hq", amount: 150000 });
    expect(totals(lines)).toEqual({ debit: 150000, credit: 150000 });
    expect(lines[0]).toMatchObject({ accountType: "payable_account", accountId: "pam-salary-payable" });
  });
});
