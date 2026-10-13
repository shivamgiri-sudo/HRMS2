import { describe, expect, it, vi } from "vitest";
import { SaxesParser } from "saxes";

vi.mock("../../../../db/mysql.js", () => ({
  db: { execute: vi.fn(), query: vi.fn(), getConnection: vi.fn() },
}));

import {
  buildSalesDocVoucher,
  getVoucherKind,
  registerVoucherKind,
  listVoucherKinds,
  type SalesDocRow,
} from "../tally-voucher-kinds.js";
import {
  buildVouchersXml,
  deriveVoucherGuid,
  rupees,
  totalsByDrCr,
  xmlText,
} from "../tally-voucher-xml.js";
import {
  DEFAULT_LEDGER_CONFIG,
  type TallyVoucherModel,
} from "../tally-voucher.types.js";

// Real, check-digit-valid registrations (see gst-export.contract.test.ts).
const MAS_UP = "09AAACM5866H1Z6";
const MAS_GJ = "24AAACM5866H1ZE";

const baseDoc = (over: Partial<SalesDocRow> = {}): SalesDocRow => ({
  id: "inv-1",
  docNo: "UP-01/26-27",
  docDate: "2026-10-03",
  taxable: 100000_00,
  igst: 0,
  cgst: 9000_00,
  sgst: 9000_00,
  grandTotal: 118000_00,
  applyGst: true,
  tallyHead: null,
  clientTallyName: null,
  billingClientName: "Acme Telecom Pvt Ltd",
  clientName: "Acme",
  costCentreCode: "BSS/OB/NOIDA/1",
  clientGstinRaw: MAS_UP, // same state as supplier => CGST/SGST
  clientStateCode: "09",
  hsnSac: "998513",
  description: "Manpower supply Sep-26",
  monthLabel: "Sep-26",
  poNo: "PO-77",
  grnNo: null,
  branchStateCode: "09",
  originalBillNo: null,
  ...over,
});

const ctx = {
  companyGstin: MAS_UP,
  config: DEFAULT_LEDGER_CONFIG,
  companyName: "MAS Callnet India Pvt Ltd",
};

/** Strict parse; returns amounts of TOP-LEVEL ledger entries (not bill allocations) and root checks. */
function parse(xml: string) {
  const parser = new SaxesParser();
  const stack: string[] = [];
  const text: string[] = [];
  const ledgerAmounts: number[] = [];
  const billAmounts: number[] = [];
  const vouchers: Array<Record<string, string>> = [];
  let currentVoucher: Record<string, string> | null = null;
  parser.on("error", (e) => {
    throw e;
  });
  parser.on("opentag", (t) => {
    stack.push(t.name);
    text.push("");
    if (t.name === "VOUCHER") {
      currentVoucher = { ...(t.attributes as Record<string, string>) };
      vouchers.push(currentVoucher);
    }
  });
  parser.on("text", (s) => {
    if (text.length) text[text.length - 1] += s;
  });
  parser.on("closetag", (t) => {
    const value = text.pop() ?? "";
    stack.pop();
    if (t.name === "AMOUNT") {
      const parent = stack[stack.length - 1];
      const n = Math.round(Number(value) * 100);
      if (parent === "LEDGERENTRIES.LIST") ledgerAmounts.push(n);
      if (parent === "BILLALLOCATIONS.LIST") billAmounts.push(n);
    }
    if (
      currentVoucher &&
      stack[stack.length - 1] === "VOUCHER" &&
      !(t.name in currentVoucher)
    )
      currentVoucher[t.name] = value;
  });
  parser.write(xml).close();
  return { ledgerAmounts, billAmounts, vouchers, stack };
}

describe("sales voucher model", () => {
  it("balances to the paisa and Dr party equals Cr sales + tax", () => {
    const { model, errors } = buildSalesDocVoucher(baseDoc(), "sales", ctx);
    const { debit, credit } = totalsByDrCr(model.entries);
    expect(debit).toBe(credit);
    expect(debit).toBe(118000_00);
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    expect(model.entries.map((e) => [e.ledgerName, e.side])).toEqual([
      ["Acme Telecom Pvt Ltd", "Dr"],
      ["Sales", "Cr"],
      ["Output CGST", "Cr"],
      ["Output SGST", "Cr"],
    ]);
    expect(model.entries[0].billAllocations).toEqual([
      { name: "UP-01/26-27", type: "New Ref", paise: 118000_00 },
    ]);
  });

  it("uses IGST for an inter-state supply and the invoice tally_head as sales ledger", () => {
    const doc = baseDoc({
      cgst: 0,
      sgst: 0,
      igst: 18000_00,
      clientGstinRaw: MAS_GJ,
      clientStateCode: "24",
      tallyHead: "Sales - Manpower",
    });
    const { model, errors } = buildSalesDocVoucher(doc, "sales", ctx);
    expect(model.entries.map((e) => e.ledgerName)).toEqual([
      "Acme Telecom Pvt Ltd",
      "Sales - Manpower",
      "Output IGST",
    ]);
    expect(model.placeOfSupply).toBe("Gujarat");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
  });

  it("books a sub-rupee difference to the round-off ledger and still balances", () => {
    const doc = baseDoc({ grandTotal: 118000_00 - 40 });
    const { model, errors } = buildSalesDocVoucher(doc, "sales", ctx);
    const { debit, credit } = totalsByDrCr(model.entries);
    expect(debit).toBe(credit);
    const ro = model.entries.find((e) => e.role === "round_off")!;
    expect(ro.paise).toBe(40);
    expect(ro.side).toBe("Dr"); // total is LOWER than components: debit side
    expect(errors.find((e) => e.code === "TOTAL_MISMATCH")).toBeUndefined();
  });

  it("flags a document total that disagrees by more than a rupee", () => {
    const { errors } = buildSalesDocVoucher(
      baseDoc({ grandTotal: 117000_00 }),
      "sales",
      ctx,
    );
    expect(
      errors.some((e) => e.code === "TOTAL_MISMATCH" && e.severity === "error"),
    ).toBe(true);
  });
});

describe("credit note voucher", () => {
  it("reverses the sales voucher and settles Agst Ref the original bill", () => {
    const doc = baseDoc({
      id: "cn-1",
      docNo: "CN-1/26-27",
      originalBillNo: "UP-01/26-27",
    });
    const { model, errors } = buildSalesDocVoucher(doc, "credit_note", ctx);
    expect(model.voucherType).toBe("Credit Note");
    expect(model.entries[0]).toMatchObject({ role: "party", side: "Cr" });
    expect(model.entries[0].billAllocations).toEqual([
      { name: "UP-01/26-27", type: "Agst Ref", paise: 118000_00 },
    ]);
    expect(
      model.entries.filter((e) => e.side === "Dr").map((e) => e.ledgerName),
    ).toEqual(["Sales Returns", "Output CGST", "Output SGST"]);
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
  });

  it("is an exception when the credit note has no original bill number", () => {
    const { errors } = buildSalesDocVoucher(
      baseDoc({ docNo: "CN-2", originalBillNo: null }),
      "credit_note",
      ctx,
    );
    expect(errors.some((e) => e.code === "ORIGINAL_BILL_MISSING")).toBe(true);
  });
});

describe("exceptions", () => {
  it("flags missing party ledger, invalid GSTIN, split/state mismatch, missing company", () => {
    const { errors } = buildSalesDocVoucher(
      baseDoc({
        billingClientName: null,
        clientTallyName: null,
        clientName: null,
        clientGstinRaw: "09AAACM5866H1Z7", // bad check digit
        igst: 18000_00,
        cgst: 0,
        sgst: 0,
      }),
      "sales",
      { ...ctx, companyName: null },
    );
    const codes = errors.map((e) => e.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "COMPANY_NAME_MISSING",
        "PARTY_LEDGER_MISSING",
        "RECIPIENT_GSTIN_INVALID",
        "SPLIT_STATE_MISMATCH",
      ]),
    );
  });

  it("warns, but does not block, on missing client GSTIN and HSN/SAC", () => {
    const { errors } = buildSalesDocVoucher(
      baseDoc({ clientGstinRaw: "NA", hsnSac: null }),
      "sales",
      ctx,
    );
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    expect(errors.map((e) => e.code)).toEqual(
      expect.arrayContaining(["RECIPIENT_GSTIN_MISSING", "HSN_SAC_MISSING"]),
    );
  });

  it("flags a blank configured tax ledger", () => {
    const { errors } = buildSalesDocVoucher(baseDoc(), "sales", {
      ...ctx,
      config: { ...DEFAULT_LEDGER_CONFIG, cgstLedger: "" },
    });
    expect(errors.some((e) => e.code === "TAX_LEDGER_MISSING")).toBe(true);
  });
});

describe("XML", () => {
  const model = (over: Partial<SalesDocRow> = {}) =>
    buildSalesDocVoucher(baseDoc(over), "sales", ctx).model;

  it("is well-formed and its ledger amounts sum to zero", () => {
    const xml = buildVouchersXml(
      "MAS Callnet India Pvt Ltd",
      [model()],
      () => "Create",
    );
    const { ledgerAmounts, billAmounts, vouchers } = parse(xml);
    expect(ledgerAmounts.reduce((a, b) => a + b, 0)).toBe(0);
    expect(ledgerAmounts[0]).toBe(-118000_00); // Dr party is negative
    expect(billAmounts).toEqual([-118000_00]);
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0]).toMatchObject({
      VCHTYPE: "Sales",
      ACTION: "Create",
      VOUCHERNUMBER: "UP-01/26-27",
      DATE: "20261003",
      PARTYGSTIN: MAS_UP,
      PLACEOFSUPPLY: "Uttar Pradesh",
    });
    expect(xml).toContain("<BILLTYPE>New Ref</BILLTYPE>");
    expect(xml).toContain(
      "<SVCURRENTCOMPANY>MAS Callnet India Pvt Ltd</SVCURRENTCOMPANY>",
    );
  });

  it("re-export is ALTER with the same GUID, never a second Create", () => {
    const m = model();
    const first = parse(buildVouchersXml("C", [m], () => "Create")).vouchers[0];
    const again = parse(buildVouchersXml("C", [m], () => "Alter")).vouchers[0];
    expect(first.REMOTEID).toBe(again.REMOTEID);
    expect(again.ACTION).toBe("Alter");
    expect(first.REMOTEID).toBe(deriveVoucherGuid("invoice", "inv-1"));
    expect(deriveVoucherGuid("invoice", "inv-2")).not.toBe(first.REMOTEID);
  });

  it("scrubs control characters and escapes markup from legacy text", () => {
    const m = model({
      description: "Fees \u000b& <more>\r\n\u0000 \"q\" 'a'",
      billingClientName: "A&B \u0007Ltd",
    });
    const xml = buildVouchersXml("Co \u0001 & Sons", [m], () => "Create");
    expect(() => parse(xml)).not.toThrow();
    expect(xml).toContain("A&amp;B Ltd");
  });

  it("credit-note XML is balanced and carries Agst Ref", () => {
    const { model: cn } = buildSalesDocVoucher(
      baseDoc({ id: "cn-1", docNo: "CN-1", originalBillNo: "UP-01/26-27" }),
      "credit_note",
      ctx,
    );
    const xml = buildVouchersXml("C", [cn], () => "Create");
    const { ledgerAmounts, vouchers } = parse(xml);
    expect(ledgerAmounts.reduce((a, b) => a + b, 0)).toBe(0);
    expect(ledgerAmounts[0]).toBe(118000_00); // Cr party is positive
    expect(vouchers[0].VCHTYPE).toBe("Credit Note");
    expect(xml).toContain("<BILLTYPE>Agst Ref</BILLTYPE>");
    expect(xml).toContain("<NAME>UP-01/26-27</NAME>");
  });

  it("formats paise exactly", () => {
    expect(rupees(-5)).toBe("-0.05");
    expect(rupees(100000_01)).toBe("100000.01");
    expect(xmlText("a\u0000b")).toBe("ab");
  });
});

describe("voucher kind registry", () => {
  it("ships sales and credit_note, and accepts a receipt builder without other changes", async () => {
    expect(getVoucherKind("sales")).toBeDefined();
    expect(getVoucherKind("credit_note")).toBeDefined();
    expect(getVoucherKind("receipt")).toBeUndefined();
    const stub: TallyVoucherModel = {
      kind: "receipt",
      sourceType: "receipt",
      sourceId: "r1",
      guid: deriveVoucherGuid("receipt", "r1"),
      voucherType: "Receipt",
      voucherNumber: "RC-1",
      date: "2026-10-04",
      narration: "UTR 1",
      partyLedger: "Acme",
      partyGstin: null,
      partyStateName: null,
      placeOfSupply: null,
      companyGstin: MAS_UP,
      companyStateName: null,
      entries: [
        { ledgerName: "HDFC Bank", side: "Dr", paise: 1000, role: "other" },
        {
          ledgerName: "Acme",
          side: "Cr",
          paise: 1000,
          role: "party",
          billAllocations: [
            { name: "UP-01/26-27", type: "Agst Ref", paise: 1000 },
          ],
        },
      ],
      display: {
        clientName: "Acme",
        costCentreCode: null,
        amountPaise: 1000,
        taxablePaise: 0,
        taxPaise: 0,
      },
    };
    registerVoucherKind({
      kind: "receipt",
      label: "Receipts",
      sourceType: "receipt",
      collect: async () => [{ model: stub, errors: [] }],
    });
    expect(listVoucherKinds().map((k) => k.kind)).toContain("receipt");
    const built = await getVoucherKind("receipt")!.collect({} as never);
    const { ledgerAmounts } = parse(
      buildVouchersXml("C", [built[0].model], () => "Create"),
    );
    expect(ledgerAmounts).toEqual([-1000, 1000]);
  });
});
