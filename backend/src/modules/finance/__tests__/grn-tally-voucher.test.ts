import { describe, expect, it } from "vitest";
import {
  buildGrnVoucher,
  wrapTallyEnvelope,
  type GrnVoucherInput,
} from "../grn-tally-voucher.js";

const base: GrnVoucherInput = {
  grnId: "g1",
  grnNumber: "Mas/9/26/209",
  grnType: "vendor",
  billDate: "2026-09-01",
  invoiceNumber: "INV-1",
  vendorLedger: "OESPL Private Limited",
  expenseLedger: "Office Rent",
  headName: "Office Rent",
  branchName: "NOIDA",
  narrationText: null,
  amountWithoutTax: 100000,
  taxAmount: 18000,
  otherCharges: 0,
  roundOff: 0,
  gross: 118000,
  gstType: "cgst_sgst",
  recoverableTaxPct: 100,
};

const amounts = (xml: string) =>
  [...xml.matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].map((m) => Number(m[1]));

describe("buildGrnVoucher", () => {
  it("vendor GRN: Purchase voucher, expense and split input GST debited, vendor credited, balanced", () => {
    const v = buildGrnVoucher(base);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.xml).toContain('VCHTYPE="Purchase"');
    expect(v.xml).toContain("<VOUCHERNUMBER>Mas/9/26/209</VOUCHERNUMBER>");
    expect(v.xml).toContain("<DATE>20260901</DATE>");
    expect(v.xml).toContain("<REFERENCE>INV-1</REFERENCE>");
    expect(amounts(v.xml)).toEqual([-100000, -9000, -9000, 118000]);
    expect(amounts(v.xml).reduce((a, b) => a + b, 0)).toBeCloseTo(0, 2);
  });

  it("IGST goes to one input ledger", () => {
    const v = buildGrnVoucher({ ...base, gstType: "igst" });
    expect(v.ok && amounts(v.xml)).toEqual([-100000, -18000, 118000]);
    expect(v.ok && v.xml).toContain("Input IGST");
  });

  it("non-recoverable GST stays in the expense", () => {
    const v = buildGrnVoucher({ ...base, recoverableTaxPct: 0 });
    expect(v.ok && amounts(v.xml)).toEqual([-118000, 118000]);
  });

  it("round off is its own line and the voucher still balances", () => {
    const v = buildGrnVoucher({
      ...base,
      amountWithoutTax: 99999.6,
      taxAmount: 17999.93,
      gross: 118000,
      roundOff: 0.47,
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.xml).toContain("Round Off");
    expect(amounts(v.xml).reduce((a, b) => a + b, 0)).toBeCloseTo(0, 2);
  });

  it("imprest GRN: Journal voucher crediting Imprest Float", () => {
    const v = buildGrnVoucher({
      ...base,
      grnType: "imprest",
      vendorLedger: null,
      gstType: "none",
      taxAmount: 0,
      amountWithoutTax: 500,
      gross: 500,
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.xml).toContain('VCHTYPE="Journal"');
    expect(v.xml).toContain("<LEDGERNAME>Imprest Float</LEDGERNAME>");
    expect(amounts(v.xml)).toEqual([-500, 500]);
  });

  it("escapes names", () => {
    const v = buildGrnVoucher({ ...base, vendorLedger: "A & B <Traders>" });
    expect(v.ok && v.xml).toContain("A &amp; B &lt;Traders&gt;");
  });

  it("returns an exception, not a voucher, when the figures do not add up", () => {
    const v = buildGrnVoucher({ ...base, amountWithoutTax: 50000 });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/do not add up/);
  });

  it("returns an exception for missing essentials", () => {
    expect(buildGrnVoucher({ ...base, grnNumber: "" }).ok).toBe(false);
    expect(buildGrnVoucher({ ...base, gross: 0 }).ok).toBe(false);
    expect(buildGrnVoucher({ ...base, vendorLedger: " " }).ok).toBe(false);
    expect(buildGrnVoucher({ ...base, expenseLedger: "" }).ok).toBe(false);
  });

  it("wraps vouchers in the import envelope", () => {
    const xml = wrapTallyEnvelope(["<VOUCHER/>"], "MAS Business Solutions");
    expect(xml).toContain("<TALLYREQUEST>Import Data</TALLYREQUEST>");
    expect(xml).toContain(
      "<SVCURRENTCOMPANY>MAS Business Solutions</SVCURRENTCOMPANY>",
    );
    expect(xml).toContain(
      '<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER/></TALLYMESSAGE>',
    );
  });
});
