import { describe, expect, it } from "vitest";
import {
  assertFinanceYear,
  assertMonthLabelInFinanceYear,
  computeInvoiceAmounts,
  deriveGstType,
  round2,
  stateCodeFromGstin,
  toPaise,
} from "../client-billing-tax.js";
import {
  assertPoNumbersShape,
  normaliseReferences,
  parsePoNumbers,
  validatePoCoverage,
} from "../client-billing-po.js";
import { parseRecipients } from "../client-billing-submit.service.js";
import { amountInWords } from "../client-billing-pdf.service.js";

describe("single rounding rule", () => {
  it("rounds half-up in paise without float artefacts", () => {
    expect(toPaise(1.005)).toBe(101); // 1.005*100 = 100.49999999999999 in binary float
    expect(round2(2.675)).toBe(2.68);
    expect(round2(-2.675)).toBe(-2.68);
  });

  it("matches the DownloadPdf.pdf sample: 4.08 x 35000 = 142800, IGST 25704, total 168504", () => {
    const r = computeInvoiceAmounts(
      [{ qty: 4.08, rate: 35000 }],
      "Integrated",
      true,
    );
    expect(r.totalAmount).toBe(142800);
    expect(r.igstAmount).toBe(25704);
    expect(r.grandTotal).toBe(168504);
  });

  it("total is the sum of rounded lines; deductions subtract; CGST == SGST", () => {
    const r = computeInvoiceAmounts(
      [
        { qty: 3, rate: 33.335 }, // 100.005 -> 100.01
        { qty: 1, rate: 0.5, lineType: "deduction" },
      ],
      "Intrastate",
      true,
    );
    expect(r.lineAmounts).toEqual([100.01, 0.5]);
    expect(r.totalAmount).toBe(99.51);
    expect(r.cgstAmount).toBe(r.sgstAmount);
    expect(r.grandTotal).toBe(
      round2(r.totalAmount + r.cgstAmount + r.sgstAmount),
    );
  });

  it("no tax when applyGst is false", () => {
    const r = computeInvoiceAmounts(
      [{ qty: 1, rate: 1000 }],
      "Integrated",
      false,
    );
    expect(r.grandTotal).toBe(1000);
    expect(r.igstAmount).toBe(0);
  });
});

describe("GST type from supplier state vs place of supply", () => {
  it("Noida supplier (09) to a Telangana GSTIN (36) is Integrated even if the flag says Intrastate", () => {
    const r = deriveGstType({
      supplierGstin: "09AAACM5866H1Z6",
      clientGstin: "36AALCB0248H2ZQ",
      clientStateCode: "09", // stale free-text column disagrees with the GSTIN
      fallbackFlag: "Intrastate",
    });
    expect(r).toMatchObject({
      gstType: "Integrated",
      derived: true,
      placeOfSupplyState: "36",
    });
  });

  it("same state is Intrastate", () => {
    expect(
      deriveGstType({
        supplierStateCode: "9",
        clientStateCode: "09",
        fallbackFlag: "Integrated",
      }).gstType,
    ).toBe("Intrastate");
  });

  it("falls back to the stored flag only when a state is unknown", () => {
    const r = deriveGstType({
      supplierStateCode: "09",
      clientGstin: "bad",
      fallbackFlag: "Integrated",
    });
    expect(r).toMatchObject({ gstType: "Integrated", derived: false });
    expect(deriveGstType({ fallbackFlag: "weird" }).gstType).toBeNull();
  });

  it("reads the state from a well-formed GSTIN only", () => {
    expect(stateCodeFromGstin("36AALCB0248H2ZQ")).toBe("36");
    expect(stateCodeFromGstin("36AALCB0248H2")).toBeNull();
  });
});

describe("finance year / month label guards (numbering-fork bug)", () => {
  it("accepts 2026-27 and rejects 2026-2027 / 26-27 / wrong successor", () => {
    expect(() => assertFinanceYear("2026-27")).not.toThrow();
    expect(() => assertFinanceYear("2026-2027")).toThrow(/financeYear/);
    expect(() => assertFinanceYear("26-27")).toThrow(/financeYear/);
    expect(() => assertFinanceYear("2026-28")).toThrow(/financeYear/);
  });

  it("month label must belong to the finance year", () => {
    expect(() =>
      assertMonthLabelInFinanceYear("Aug-26", "2026-27"),
    ).not.toThrow();
    expect(() =>
      assertMonthLabelInFinanceYear("Mar-27", "2026-27"),
    ).not.toThrow();
    expect(() => assertMonthLabelInFinanceYear("Mar-26", "2026-27")).toThrow(
      /outside/,
    );
    expect(() => assertMonthLabelInFinanceYear("March-16", "2026-27")).toThrow(
      /monthLabel/,
    );
  });
});

describe("PO coverage (legacy check was inverted)", () => {
  const poRow = (over: Record<string, unknown> = {}) => ({
    id: "po-1",
    po_number: "PO1",
    period_from: "2026-04-01",
    period_to: "2027-03-31",
    balance_amount: 200000,
    ...over,
  });

  it("allows an invoice that equals the remaining balance", () => {
    const r = validatePoCoverage({
      poNumbers: ["PO1"],
      poRows: [poRow({ balance_amount: 168504 })],
      invoiceDate: "2026-09-30",
      grandTotal: 168504,
    });
    expect(r.ok).toBe(true);
  });

  it("blocks when invoice total exceeds the remaining balance", () => {
    const r = validatePoCoverage({
      poNumbers: ["PO1"],
      poRows: [poRow({ balance_amount: 168503.99 })],
      invoiceDate: "2026-09-30",
      grandTotal: 168504,
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/PO balance/);
  });

  it("blocks an invoice dated outside the PO period", () => {
    const r = validatePoCoverage({
      poNumbers: ["PO1"],
      poRows: [poRow({ period_to: "2026-08-31" })],
      invoiceDate: "2026-09-30",
      grandTotal: 100,
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/does not cover the invoice date/);
  });

  it("blocks an unknown PO number and sums balances across POs", () => {
    const missing = validatePoCoverage({
      poNumbers: ["PO1", "PO2"],
      poRows: [poRow()],
      invoiceDate: "2026-09-30",
      grandTotal: 100,
    });
    expect(missing.errors.join()).toMatch(/PO Number PO2 not matched/);

    const two = validatePoCoverage({
      poNumbers: ["PO1", "PO2"],
      poRows: [
        poRow({ balance_amount: 60 }),
        poRow({ id: "po-2", po_number: "PO2", balance_amount: 50 }),
      ],
      invoiceDate: "2026-09-30",
      grandTotal: 100,
    });
    expect(two.ok).toBe(true);
    expect(two.totalBalance).toBe(110);
  });

  it("parses CSV, de-duplicates and caps at 4", () => {
    expect(parsePoNumbers(" A, b ,a,,C ")).toEqual(["A", "b", "C"]);
    expect(() => assertPoNumbersShape(["1", "2", "3", "4", "5"])).toThrow(
      /more than 4/,
    );
    expect(() => normaliseReferences({ grnDate: "30/09/2026" })).toThrow(
      /GRN date/,
    );
    expect(
      normaliseReferences({
        poNumbers: "X,Y",
        grnNo: " G1 ",
        rcmApplicable: true,
      }),
    ).toMatchObject({
      poNumbers: ["X", "Y"],
      grnNo: "G1",
      rcmApplicable: true,
    });
  });
});

describe("submit-to-client recipients", () => {
  it("parses, lowercases and de-duplicates", () => {
    expect(parseRecipients("A@x.com; a@x.com, b@y.org", "To")).toEqual([
      "a@x.com",
      "b@y.org",
    ]);
  });
  it("rejects a malformed address", () => {
    expect(() => parseRecipients(["nope"], "To")).toThrow(/valid email/);
  });
});

describe("amount in words (Indian)", () => {
  it("matches the sample wording", () => {
    expect(amountInWords(168504)).toBe(
      "Rupees One Lakh Sixty Eight Thousand Five Hundred Four Only",
    );
  });
  it("spells out paise and crore", () => {
    expect(amountInWords(5520.04)).toBe(
      "Rupees Five Thousand Five Hundred Twenty and Four Paise Only",
    );
    expect(amountInWords(12345678.5)).toBe(
      "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Fifty Paise Only",
    );
    expect(amountInWords(0.5)).toBe("Rupees Zero and Fifty Paise Only");
  });
});
