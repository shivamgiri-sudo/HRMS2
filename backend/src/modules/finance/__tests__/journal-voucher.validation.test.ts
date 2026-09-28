import { describe, expect, it } from "vitest";
import {
  assertSubmittable,
  isValidIsoDate,
  normalizeJournalVoucherInput,
  totalsOf,
} from "../journal-voucher.validation.js";

const TODAY = "2026-09-22";

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    voucherDate: TODAY,
    jvType: "provision",
    narration: "Accrue September electricity bill not yet received",
    referenceNo: "EB-INV-4471",
    branchId: null,
    costCentreId: null,
    processId: null,
    lines: [
      { accountType: "expense_sub_head", accountId: "11111111-1111-1111-1111-111111111111", debitAmount: 10000, creditAmount: 0 },
      { accountType: "payable_account", accountId: "22222222-2222-2222-2222-222222222222", debitAmount: 0, creditAmount: 10000 },
    ],
    ...overrides,
  };
}

describe("isValidIsoDate", () => {
  it("accepts a real calendar date", () => expect(isValidIsoDate("2026-09-22")).toBe(true));
  it("rejects a non-existent calendar date", () => expect(isValidIsoDate("2026-02-30")).toBe(false));
  it("rejects a non-date string", () => expect(isValidIsoDate("not-a-date")).toBe(false));
  it("rejects undefined", () => expect(isValidIsoDate(undefined)).toBe(false));
});

describe("normalizeJournalVoucherInput", () => {
  it("accepts a well-formed balanced voucher", () => {
    const input = normalizeJournalVoucherInput(baseBody(), TODAY);
    expect(input.lines).toHaveLength(2);
    expect(input.narration).toBe("Accrue September electricity bill not yet received");
  });

  it("rejects a future voucher date", () => {
    expect(() => normalizeJournalVoucherInput(baseBody({ voucherDate: "2026-09-23" }), TODAY)).toThrow(/future/i);
  });

  it("rejects an invalid voucher type", () => {
    expect(() => normalizeJournalVoucherInput(baseBody({ jvType: "made_up" }), TODAY)).toThrow(/valid voucher type/i);
  });

  it("rejects a narration shorter than the minimum", () => {
    expect(() => normalizeJournalVoucherInput(baseBody({ narration: "x" }), TODAY)).toThrow(/narration/i);
  });

  it("rejects a line with both a debit and a credit", () => {
    const body = baseBody({ lines: [
      { accountType: "expense_sub_head", accountId: "11111111-1111-1111-1111-111111111111", debitAmount: 10, creditAmount: 10 },
      { accountType: "payable_account", accountId: "22222222-2222-2222-2222-222222222222", debitAmount: 0, creditAmount: 10 },
    ] });
    expect(() => normalizeJournalVoucherInput(body, TODAY)).toThrow(/both a debit and a credit/i);
  });

  it("rejects a line with no amount on either side", () => {
    const body = baseBody({ lines: [
      { accountType: "expense_sub_head", accountId: "11111111-1111-1111-1111-111111111111", debitAmount: 0, creditAmount: 0 },
      { accountType: "payable_account", accountId: "22222222-2222-2222-2222-222222222222", debitAmount: 0, creditAmount: 10 },
    ] });
    expect(() => normalizeJournalVoucherInput(body, TODAY)).toThrow(/no amount/i);
  });

  it("rejects an account type outside the allowed set (bank_account, vendor)", () => {
    const body = baseBody({ lines: [
      { accountType: "bank_account", accountId: "11111111-1111-1111-1111-111111111111", debitAmount: 10, creditAmount: 0 },
      { accountType: "payable_account", accountId: "22222222-2222-2222-2222-222222222222", debitAmount: 0, creditAmount: 10 },
    ] });
    expect(() => normalizeJournalVoucherInput(body, TODAY)).toThrow(/only expense heads and ledger heads/i);
  });

  it("rejects an amount with more than two decimal places", () => {
    const body = baseBody({ lines: [
      { accountType: "expense_sub_head", accountId: "11111111-1111-1111-1111-111111111111", debitAmount: 10.005, creditAmount: 0 },
      { accountType: "payable_account", accountId: "22222222-2222-2222-2222-222222222222", debitAmount: 0, creditAmount: 10.005 },
    ] });
    expect(() => normalizeJournalVoucherInput(body, TODAY)).toThrow(/two decimal places/i);
  });

  it("rejects a negative amount", () => {
    const body = baseBody({ lines: [
      { accountType: "expense_sub_head", accountId: "11111111-1111-1111-1111-111111111111", debitAmount: -10, creditAmount: 0 },
      { accountType: "payable_account", accountId: "22222222-2222-2222-2222-222222222222", debitAmount: 0, creditAmount: 10 },
    ] });
    expect(() => normalizeJournalVoucherInput(body, TODAY)).toThrow(/positive number/i);
  });

  it("rejects an invalid account id", () => {
    const body = baseBody({ lines: [
      { accountType: "expense_sub_head", accountId: "not-a-uuid", debitAmount: 10, creditAmount: 0 },
      { accountType: "payable_account", accountId: "22222222-2222-2222-2222-222222222222", debitAmount: 0, creditAmount: 10 },
    ] });
    expect(() => normalizeJournalVoucherInput(body, TODAY)).toThrow(/pick an account/i);
  });

  it("does NOT enforce balance — a draft may be saved unbalanced", () => {
    const body = baseBody({ lines: [
      { accountType: "expense_sub_head", accountId: "11111111-1111-1111-1111-111111111111", debitAmount: 10000, creditAmount: 0 },
      { accountType: "payable_account", accountId: "22222222-2222-2222-2222-222222222222", debitAmount: 0, creditAmount: 9000 },
    ] });
    expect(() => normalizeJournalVoucherInput(body, TODAY)).not.toThrow();
  });
});

describe("totalsOf", () => {
  it("sums debit and credit lines in paise-exact arithmetic", () => {
    const totals = totalsOf([
      { debitAmount: 100.1, creditAmount: 0 },
      { debitAmount: 200.2, creditAmount: 0 },
      { debitAmount: 0, creditAmount: 300.3 },
    ]);
    expect(totals.debit).toBeCloseTo(300.3, 2);
    expect(totals.credit).toBeCloseTo(300.3, 2);
    expect(totals.difference).toBeCloseTo(0, 6);
  });

  it("sums many 0.1-scale lines to exact paisa without floating-point drift accumulating", () => {
    // 0.1 has no exact binary representation — naively summing ten of them in plain JS
    // floating point does not land on exactly 1.00. toPaise's round-per-line-then-sum-integers
    // shape must not inherit that drift.
    const lines = Array.from({ length: 10 }, () => ({ debitAmount: 0.1, creditAmount: 0 }));
    const totals = totalsOf([...lines, { debitAmount: 0, creditAmount: 1 }]);
    expect(totals.debit).toBe(1);
    expect(totals.difference).toBe(0);
  });

  it("detects a genuine one-paisa mismatch between debit and credit totals", () => {
    const totals = totalsOf([
      { debitAmount: 100.01, creditAmount: 0 },
      { debitAmount: 0, creditAmount: 100.0 },
    ]);
    expect(totals.difference).toBeCloseTo(0.01, 6);
  });
});

describe("assertSubmittable", () => {
  it("passes a balanced two-line voucher", () => {
    expect(() => assertSubmittable([{ debitAmount: 500, creditAmount: 0 }, { debitAmount: 0, creditAmount: 500 }])).not.toThrow();
  });

  it("refuses fewer than two lines", () => {
    expect(() => assertSubmittable([{ debitAmount: 500, creditAmount: 0 }])).toThrow(/at least two lines/i);
  });

  it("refuses an all-debit voucher (no credit side at all)", () => {
    expect(() => assertSubmittable([{ debitAmount: 300, creditAmount: 0 }, { debitAmount: 200, creditAmount: 0 }])).toThrow(/at least one debit and one credit/i);
  });

  it("refuses an unbalanced voucher and names the exact difference", () => {
    expect(() => assertSubmittable([{ debitAmount: 500, creditAmount: 0 }, { debitAmount: 0, creditAmount: 450 }])).toThrow(/₹50\.00/);
  });
});
