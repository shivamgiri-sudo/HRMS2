import { describe, expect, it } from "vitest";
import {
  buildGrnVoucher,
  effectiveGstRate,
  monthEnd,
  wrapTallyEnvelope,
  type GrnVoucherInput,
} from "../grn-tally-voucher.js";
import {
  grnBranchCode,
  gstStateName,
  normalizeTdsSection,
  resolveGrnTds,
} from "../grn-tally-context.js";

/**
 * Golden cases are vouchers from the legacy billing system's September 2026 GRN import sheet
 * (MASSEP.xlsx, "Import - 2026-09-30"), the file Accounts loads into TallyPrime today.
 */

const base = (over: Partial<GrnVoucherInput> = {}): GrnVoucherInput => ({
  grnId: "g1",
  grnNumber: "Mas/9/26/126",
  grnType: "vendor",
  billDate: "2026-09-01",
  postingDate: "2026-09-14",
  accountingPeriod: "2026-09",
  invoiceNumber: "OESPL/26-27/0511",
  vendorLedger: "OESPL Private Limited",
  imprestLedger: null,
  expenseLedger: "Office Rent",
  headName: "Rent",
  branchName: "NOIDA-2",
  branchCode: "NOIDA-2",
  gstStateName: "Uttar Pradesh",
  narrationText: "Office rental charges f/m of Sep-26 Tower1 302 3rd floor",
  amountWithoutTax: 438900,
  taxAmount: 79002,
  otherCharges: 0,
  roundOff: 0,
  gross: 517902,
  gstType: "cgst_sgst",
  gstRate: 18,
  recoverableTaxPct: 100,
  tds: { section: "194I_LB", ratePct: 10, basis: "Vendor master 194I_LB @ 10%" },
  ...over,
});

const ok = (input: GrnVoucherInput) => {
  const v = buildGrnVoucher(input);
  if (!v.ok) throw new Error(v.reason);
  return v;
};
const net = (entries: { side: string; amount: number }[]) =>
  Math.round(entries.reduce((s, e) => s + (e.side === "Dr" ? e.amount : -e.amount), 0) * 100) / 100 + 0;

describe("buildGrnVoucher — legacy JrnlP import shape", () => {
  it("rent with CGST/SGST and TDS matches the legacy voucher OESPL/26-27/0511/Mas/9/26/126 line for line", () => {
    const v = ok(base());
    expect(v.header).toEqual({
      voucherNumber: "OESPL/26-27/0511/Mas/9/26/126",
      date: "2026-09-30",
      effectiveDate: "2026-09-01",
      costCategory: "NOIDA-2",
      costCentre: "NOIDA-2/2609",
      narrationEntry: "Office rental charges f/m of Sep-26 Tower1 302 3rd floor",
      narration:
        "Office rental charges f/m of Sep-26 Tower1 302 3rd floor GRN NO.: Mas/9/26/126, Bill No.:OESPL/26-27/0511 , Bill Date.:01-09-2026",
      voucherType: "JrnlP",
    });
    expect(v.entries).toEqual([
      { ledger: "Office Rent", side: "Dr", amount: 438900 },
      { ledger: "Input CGST @9%(Uttar Pradesh)", side: "Dr", amount: 39501 },
      { ledger: "Input SGST @9%(Uttar Pradesh)", side: "Dr", amount: 39501 },
      { ledger: "OESPL Private Limited", side: "Cr", amount: 474012 },
      { ledger: "TDS RENT 2022-23", side: "Cr", amount: 43890 },
    ]);
    expect(net(v.entries)).toBe(0);
  });

  it("IGST without TDS matches 1292/Mas/9/26/125 (HEAD OFFICE, UP registration)", () => {
    const v = ok(
      base({
        grnNumber: "Mas/9/26/125",
        invoiceNumber: "1292",
        vendorLedger: "TULSI INFOTECH",
        expenseLedger: "Computer & Peripherals Maintenance",
        branchName: "HEAD OFFICE",
        branchCode: "HO",
        narrationText: "Laptop repair Trampozid",
        amountWithoutTax: 1650,
        taxAmount: 297,
        gross: 1947,
        gstType: "igst",
        tds: null,
      }),
    );
    expect(v.header.voucherNumber).toBe("1292/Mas/9/26/125");
    expect(v.header.costCentre).toBe("HO/2609");
    expect(v.entries).toEqual([
      { ledger: "Computer & Peripherals Maintenance", side: "Dr", amount: 1650 },
      { ledger: "Input IGST @18%(Uttar Pradesh)", side: "Dr", amount: 297 },
      { ledger: "TULSI INFOTECH", side: "Cr", amount: 1947 },
    ]);
  });

  it("cost centre follows the accounting month, the voucher date the approval month (Mas/7/26/337 -> HO/2607, dated 30-Sep)", () => {
    const v = ok(base({ accountingPeriod: "2026-07", billDate: "2026-04-27", postingDate: "2026-09-02", tds: null }));
    expect(v.header.costCentre).toBe("NOIDA-2/2607");
    expect(v.header.date).toBe("2026-09-30");
    expect(v.header.effectiveDate).toBe("2026-04-27");
  });

  it("round off goes to Short/Excess Written off (Dr 0.01 on MF2709I006522784)", () => {
    const v = ok(
      base({
        expenseLedger: "Company Owned Voice",
        amountWithoutTax: 5111.16,
        taxAmount: 920,
        roundOff: 0.01,
        gross: 6031.17,
        tds: null,
      }),
    );
    expect(v.entries.at(-1)).toEqual({ ledger: "Short/Excess Written off", side: "Dr", amount: 0.01 });
    expect(v.entries[0]).toEqual({ ledger: "Company Owned Voice", side: "Dr", amount: 5111.16 });
    expect(net(v.entries)).toBe(0);
  });

  it("negative round off is a credit", () => {
    const v = ok(base({ amountWithoutTax: 5830.52, taxAmount: 1049.5, roundOff: -0.01, gross: 6880.01, tds: null }));
    expect(v.entries).toContainEqual({ ledger: "Short/Excess Written off", side: "Cr", amount: 0.01 });
    expect(net(v.entries)).toBe(0);
  });

  it("no GST, contractor TDS at 2% (OPEN AI 9840 -> 9643.20 + 196.80)", () => {
    const v = ok(
      base({
        vendorLedger: "OPEN AI",
        expenseLedger: "Fee & Subscription",
        amountWithoutTax: 9840,
        taxAmount: 0,
        gross: 9840,
        gstType: "none",
        gstRate: null,
        tds: { section: "194J_TECH", ratePct: 2, basis: "" },
      }),
    );
    expect(v.entries).toEqual([
      { ledger: "Fee & Subscription", side: "Dr", amount: 9840 },
      { ledger: "OPEN AI", side: "Cr", amount: 9643.2 },
      { ledger: "TDS CONTRACTOR 2021-22", side: "Cr", amount: 196.8 },
    ]);
  });

  it("imprest GRN credits the holder's Imp A/C", () => {
    const v = ok(
      base({
        grnType: "imprest",
        vendorLedger: null,
        imprestLedger: "Deepak Kashyap Imp A/C",
        invoiceNumber: "DK AXIS CARD",
        expenseLedger: "Tour Expenses",
        amountWithoutTax: 13038,
        taxAmount: 0,
        gross: 13038,
        gstType: "none",
        tds: null,
      }),
    );
    expect(v.entries.at(-1)).toEqual({ ledger: "Deepak Kashyap Imp A/C", side: "Cr", amount: 13038 });
    expect(v.header.voucherNumber).toBe("DK AXIS CARD/Mas/9/26/126");
  });

  it("missing bill number prints NA, as the legacy sheet does", () => {
    expect(ok(base({ invoiceNumber: null, tds: null })).header.voucherNumber).toBe("NA/Mas/9/26/126");
  });

  it("XML: JrnlP, month-end date, effective date, cost category/centre on every line, balanced", () => {
    const v = ok(base());
    expect(v.xml).toContain(`VCHTYPE="JrnlP"`);
    expect(v.xml).toContain("<DATE>20260930</DATE>");
    // A fixed id per GRN: importing the same file twice leaves one voucher in Tally.
    expect(v.xml).toContain('<VOUCHER REMOTEID="HRMS-GRN-g1"');
    expect(v.xml).toContain("<EFFECTIVEDATE>20260901</EFFECTIVEDATE>");
    expect(v.xml).toContain("<VOUCHERNUMBER>OESPL/26-27/0511/Mas/9/26/126</VOUCHERNUMBER>");
    expect(v.xml.match(/<COSTCENTREALLOCATIONS\.LIST><NAME>NOIDA-2\/2609<\/NAME>/g)).toHaveLength(5);
    const amounts = [...v.xml.matchAll(/<ALLLEDGERENTRIES\.LIST>.*?<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].map((m) => Number(m[1]));
    expect(Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100).toBe(0);
  });

  it("non-recoverable GST stays in the expense and gets no input ledger", () => {
    const v = ok(base({ recoverableTaxPct: 0, tds: null }));
    expect(v.entries).toEqual([
      { ledger: "Office Rent", side: "Dr", amount: 517902 },
      { ledger: "OESPL Private Limited", side: "Cr", amount: 517902 },
    ]);
  });

  it("exceptions instead of a questionable voucher", () => {
    const reason = (over: Partial<GrnVoucherInput>) => {
      const v = buildGrnVoucher(base(over));
      return v.ok ? null : v.reason;
    };
    expect(reason({ gross: 600000 })).toMatch(/do not add up/);
    expect(reason({ gstStateName: null })).toMatch(/GST state/);
    expect(reason({ grnType: "imprest", imprestLedger: null })).toMatch(/float holder/);
    expect(reason({ tds: { section: "194H", ratePct: 2, basis: "" } })).toMatch(/No Tally TDS ledger.*194H/);
    expect(reason({ postingDate: null })).toMatch(/Approval date/);
    expect(reason({ branchName: null })).toMatch(/Branch/);
    expect(reason({ expenseLedger: "" })).toMatch(/Sub-head/);
  });

  it("escapes names and wraps vouchers in the import envelope", () => {
    const v = ok(base({ vendorLedger: "A & B <Co>" }));
    expect(v.xml).toContain("A &amp; B &lt;Co&gt;");
    const env = wrapTallyEnvelope([v.xml], "MAS CALLNET INDIA PRIVATE LIMITED-2026-27");
    expect(env).toContain("<SVCURRENTCOMPANY>MAS CALLNET INDIA PRIVATE LIMITED-2026-27</SVCURRENTCOMPANY>");
    expect(env.match(/<TALLYMESSAGE/g)).toHaveLength(1);
    // An existing master is left as it is (without this Tally re-groups it on "Create").
    expect(env).toContain("<REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><IMPORTDUPS>@@DUPIGNORE</IMPORTDUPS>");
  });
});

describe("helpers", () => {
  it("monthEnd", () => {
    expect(monthEnd("2026-09-14")).toBe("2026-09-30");
    expect(monthEnd("2028-02-01")).toBe("2028-02-29");
  });

  it("GST rate: stored, else nearest standard slab, else unknown", () => {
    expect(effectiveGstRate({ gstRate: 5, taxAmount: 0, amountWithoutTax: 0 })).toBe(5);
    expect(effectiveGstRate({ gstRate: null, taxAmount: 920, amountWithoutTax: 5111.16 })).toBe(18);
    expect(effectiveGstRate({ gstRate: null, taxAmount: 17.01, amountWithoutTax: 18994.5 })).toBeNull();
    // A typed effective rate (17.42 seen on prod) is not a slab: read the slab from the figures.
    expect(effectiveGstRate({ gstRate: 17.42, taxAmount: 1742, amountWithoutTax: 10000 })).toBe(18);
    expect(effectiveGstRate({ gstRate: 8.32, taxAmount: 832, amountWithoutTax: 10000 })).toBeNull();
  });

  it("branch cost-centre codes as the legacy sheet prints them", () => {
    expect(grnBranchCode("HEAD OFFICE")).toBe("HO");
    expect(grnBranchCode("Ahmedabad-Jaldarshan")).toBe("AHM-JD");
    expect(grnBranchCode("NOIDA")).toBe("Noida");
    expect(grnBranchCode("NOIDA-2")).toBe("NOIDA-2");
    expect(grnBranchCode("Jaipur", { JAIPUR: "JPR" })).toBe("JPR");
  });

  it("GST state names", () => {
    expect(gstStateName("09")).toBe("Uttar Pradesh");
    expect(gstStateName(24)).toBe("Gujarat");
    expect(gstStateName("7")).toBe("Delhi");
    expect(gstStateName(null)).toBeNull();
  });

  it("TDS section names fold onto the section master codes", () => {
    expect(normalizeTdsSection("194 C")).toBe("194C");
    expect(normalizeTdsSection("194J")).toBe("194J_PROF");
    expect(normalizeTdsSection("194J", "194J_TECH")).toBe("194J_TECH");
    expect(normalizeTdsSection("194I(b)")).toBe("194I_LB");
    expect(normalizeTdsSection("194I", "194I_PM")).toBe("194I_PM");
    expect(normalizeTdsSection("")).toBeNull();
  });

  it("TDS rule: vendor master first, then a firm sub-head default, never a review default", () => {
    const ctx = {
      subHeadTds: new Map([
        ["office rent", { section: "194I_LB", confidence: "firm" }],
        ["fee & subscription", { section: "194J_TECH", confidence: "review" }],
      ]),
      sectionRates: new Map([["194I_LB", 10], ["194C", 2], ["194J_TECH", 2]]),
    };
    const vendor = (s: string | null, rate: number | null, enabled: number | null = 1) =>
      ({ ledger: "V", tdsEnabled: enabled, tdsSection: s, tdsRate: rate });
    expect(resolveGrnTds(vendor("194C", 2.5), "Parking Charges", ctx).rule).toMatchObject({ section: "194C", ratePct: 2.5 });
    expect(resolveGrnTds(vendor("194C", null), "Parking Charges", ctx).rule).toMatchObject({ ratePct: 2 });
    expect(resolveGrnTds(undefined, "Office Rent", ctx).rule).toMatchObject({ section: "194I_LB", ratePct: 10 });
    const review = resolveGrnTds(undefined, "Fee & Subscription", ctx);
    expect(review.rule).toBeNull();
    expect(review.basis).toMatch(/needs Accounts review/);
    expect(resolveGrnTds(vendor("194C", 2, 0), "Tea", ctx).rule).toBeNull();
  });
});
