import { describe, expect, it } from "vitest";
import { parseCsv, parseTallyAmount, parseTallyDate, parseTallySheet, parseTallyXml } from "../tally-import-parse.js";
import { matchPayments, reviewPurchases, type OpenBill } from "../tally-import-match.js";

const PAYMENT_XML = `<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
<TALLYMESSAGE xmlns:UDF="TallyUDF">
 <VOUCHER VCHTYPE="Payment" ACTION="Create" REMOTEID="abc-123">
  <DATE>20260921</DATE><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><VOUCHERNUMBER>PV-45</VOUCHERNUMBER>
  <NARRATION>Against OESPL/26-27/0512 &amp; rent</NARRATION><PARTYLEDGERNAME>OESPL Private Limited</PARTYLEDGERNAME>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>OESPL Private Limited</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-250398.00</AMOUNT>
    <BILLALLOCATIONS.LIST><NAME>OESPL/26-27/0512</NAME><BILLTYPE>Agst Ref</BILLTYPE><AMOUNT>-250398.00</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>250398.00</AMOUNT></ALLLEDGERENTRIES.LIST>
 </VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

describe("parsing", () => {
  it("reads dates, amounts and CSV in the shapes Tally produces", () => {
    expect(parseTallyDate("20260921")).toBe("2026-09-21");
    expect(parseTallyDate("21-09-2026")).toBe("2026-09-21");
    expect(parseTallyDate("21-Sep-26")).toBe("2026-09-21");
    expect(parseTallyDate("1-Sep-2026")).toBe("2026-09-01");
    expect(parseTallyDate(46286)).toMatch(/^2026-/);
    expect(parseTallyAmount("2,50,398.50")).toBe(250398.5);
    expect(parseTallyAmount("5,000 Dr")).toBe(5000);
    expect(parseTallyAmount("(500)")).toBe(-500);
    expect(parseCsv('a,"b,c",d\r\n1,"x ""y""",3\n')).toEqual([["a", "b,c", "d"], ["1", 'x "y"', "3"]]);
  });

  it("reads a Tally payment voucher: debit/credit from ISDEEMEDPOSITIVE, bill allocation, GUID", () => {
    const [v] = parseTallyXml(PAYMENT_XML);
    expect(v).toMatchObject({ type: "Payment", number: "PV-45", date: "2026-09-21", party: "OESPL Private Limited", guid: "abc-123" });
    expect(v.narration).toBe("Against OESPL/26-27/0512 & rent");
    expect(v.ledgers).toEqual([{ name: "OESPL Private Limited", debit: 250398, credit: 0 }, { name: "HDFC Bank", debit: 0, credit: 250398 }]);
    expect(v.billRefs).toEqual([{ name: "OESPL/26-27/0512", amount: 250398 }]);
    expect(v.key).toBe("guid:abc-123");
  });

  it("reads a Day Book sheet with title rows above the header", () => {
    const rows = [["MAS Callnet India"], ["Day Book"], [], ["Date", "Particulars", "Vch Type", "Vch No.", "Debit Amount", "Credit Amount"],
      ["21-Sep-2026", "OESPL Private Limited", "Payment", "PV-45", "2,50,398.00", ""], ["", "", "", "", "", ""], ["22-Sep-2026", "Salary A/c", "Journal", "J-1", "", "1,000"]];
    const vs = parseTallySheet(rows);
    expect(vs).toHaveLength(2);
    expect(vs[0]).toMatchObject({ type: "Payment", number: "PV-45", party: "OESPL Private Limited", date: "2026-09-21" });
    expect(vs[0].ledgers[0].debit).toBe(250398);
  });

  it("reads a vendor's Ledger Vouchers sheet: the vendor is in the title, Particulars is the bank", () => {
    const rows = [["Ledger: OESPL Private Limited"], ["Date", "Particulars", "Vch Type", "Vch No.", "Debit", "Credit"],
      ["21-09-2026", "By HDFC Bank", "Payment", "PV-45", "250398", ""], ["01-09-2026", "To Purchase", "Purchase", "P-9", "", "379011"]];
    const [pay, purchase] = parseTallySheet(rows);
    expect(pay.party).toBe("OESPL Private Limited");
    expect(pay.ledgers[0]).toEqual({ name: "OESPL Private Limited", debit: 250398, credit: 0 });
    expect(purchase.ledgers[0].credit).toBe(379011);
  });
});

const bill = (o: Partial<OpenBill> & { trackingId: string; grnNumber: string }): OpenBill => ({ grnId: "g-" + o.trackingId, invoiceNumber: null, vendorKey: "OESPL PRIVATE LIMITED", due: 100, paid: 0, balance: 100, status: "Payment Pending", ...o });
const mapOf = (bills: OpenBill[]) => new Map([["OESPL PRIVATE LIMITED", bills]]);
const pay = (over: object = {}) => ({ key: "k1", guid: null, date: "2026-09-21", type: "Payment", number: "PV-1", narration: "", party: "OESPL Private Limited", billRefs: [], ledgers: [{ name: "OESPL Private Limited", debit: 100, credit: 0 }, { name: "HDFC Bank", debit: 0, credit: 100 }], ...over });

describe("matching payments to bills", () => {
  it("uses the bill name Tally recorded", () => {
    const bills = [bill({ trackingId: "t1", grnNumber: "G1", invoiceNumber: "INV-1", balance: 250398, due: 250398 }), bill({ trackingId: "t2", grnNumber: "G2", invoiceNumber: "INV-2", balance: 250398, due: 250398 })];
    const [r] = matchPayments([pay({ ledgers: [{ name: "OESPL Private Limited", debit: 250398, credit: 0 }], billRefs: [{ name: "inv-2", amount: 250398 }] })] as any, mapOf(bills), mapOf(bills), new Set());
    expect(r.status).toBe("ready");
    expect(r.allocations).toMatchObject([{ grnNumber: "G2", by: "bill_ref", amount: 250398 }]);
  });
  it("uses an invoice number in the narration", () => {
    const bills = [bill({ trackingId: "t1", grnNumber: "G1", invoiceNumber: "OESPL/26-27/0510" }), bill({ trackingId: "t2", grnNumber: "G2", invoiceNumber: "OESPL/26-27/0512" })];
    const [r] = matchPayments([pay({ narration: "Paid bill oespl 26-27 0512 via NEFT" })] as any, mapOf(bills), mapOf(bills), new Set());
    expect(r.allocations[0]).toMatchObject({ grnNumber: "G2", by: "narration" });
  });
  it("matches by amount only when exactly one bill fits, otherwise says ambiguous", () => {
    const one = [bill({ trackingId: "t1", grnNumber: "G1", balance: 100 }), bill({ trackingId: "t2", grnNumber: "G2", balance: 555, due: 555 })];
    expect(matchPayments([pay()] as any, mapOf(one), mapOf(one), new Set())[0]).toMatchObject({ status: "ready", allocations: [{ grnNumber: "G1", by: "amount" }] });
    const two = [bill({ trackingId: "t1", grnNumber: "G1" }), bill({ trackingId: "t2", grnNumber: "G2" })];
    expect(matchPayments([pay()] as any, mapOf(two), mapOf(two), new Set())[0]).toMatchObject({ status: "ambiguous", candidates: ["G1", "G2"] });
  });
  it("treats a gross payment with TDS withheld as the bill amount", () => {
    const bills = [bill({ trackingId: "t1", grnNumber: "G1", balance: 1000, due: 1000 })];
    const v = pay({ ledgers: [{ name: "OESPL Private Limited", debit: 1000, credit: 0 }, { name: "HDFC Bank", debit: 0, credit: 900 }, { name: "TDS Payable", debit: 0, credit: 100 }] });
    const [r] = matchPayments([v] as any, mapOf(bills), mapOf(bills), new Set());
    expect(r).toMatchObject({ status: "ready", amount: 1000, tds: 100 });
  });
  it("never records a voucher twice, and says why nothing matched", () => {
    const bills = [bill({ trackingId: "t1", grnNumber: "G1" })];
    expect(matchPayments([pay()] as any, mapOf(bills), mapOf(bills), new Set(["k1"]))[0].status).toBe("already_imported");
    expect(matchPayments([pay({ party: "Somebody Else", ledgers: [{ name: "Somebody Else", debit: 100, credit: 0 }] })] as any, mapOf(bills), mapOf(bills), new Set())[0].status).toBe("no_vendor");
    const paid = [bill({ trackingId: "t9", grnNumber: "G9", paid: 100, balance: 0 })];
    expect(matchPayments([pay()] as any, mapOf([]), mapOf(paid), new Set())[0].status).toBe("already_paid");
    expect(matchPayments([pay({ ledgers: [{ name: "OESPL Private Limited", debit: 7777, credit: 0 }] })] as any, mapOf(bills), mapOf(bills), new Set())[0].status).toBe("no_open_bill");
  });
  it("refuses a payment bigger than the bill's open balance", () => {
    const bills = [bill({ trackingId: "t1", grnNumber: "G1", invoiceNumber: "INV-1", balance: 50, due: 100 })];
    const [r] = matchPayments([pay({ billRefs: [{ name: "INV-1", amount: 100 }] })] as any, mapOf(bills), mapOf(bills), new Set());
    expect(r.status).toBe("amount_mismatch");
  });
  it("reports purchase invoices that have no GRN, without creating anything", () => {
    const bills = [bill({ trackingId: "t1", grnNumber: "G1", invoiceNumber: "INV-1" })];
    const vs = [
      { key: "p1", guid: null, date: "2026-09-01", type: "Purchase", number: "P-1", narration: "", party: "OESPL Private Limited", billRefs: [{ name: "INV-1", amount: 5 }], ledgers: [{ name: "OESPL Private Limited", debit: 0, credit: 5 }] },
      { key: "p2", guid: null, date: "2026-09-02", type: "Purchase", number: "P-2", narration: "", party: "OESPL Private Limited", billRefs: [{ name: "INV-9", amount: 9 }], ledgers: [{ name: "OESPL Private Limited", debit: 0, credit: 9 }] },
    ];
    expect(reviewPurchases(vs as any, mapOf(bills)).map((r) => r.status)).toEqual(["in_hrms", "not_in_hrms"]);
  });
});
