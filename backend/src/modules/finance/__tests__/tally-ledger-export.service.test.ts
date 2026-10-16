import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = { entries: [] as any[], lines: [] as any[], pvs: [] as any[], jvs: [] as any[], topups: [] as any[] };
  const run = vi.fn(async (sql: string, params: any[] = []) => {
    const pick = (rows: any[]) => rows.filter((r) => params.includes(r.id));
    if (/FROM journal_entry\s/.test(sql) && /source_type IN/.test(sql)) return [state.entries, undefined];
    if (/FROM journal_entry\s/.test(sql) && /source_id IN/.test(sql)) return [state.entries.filter((e: any) => params.includes(e.source_id)), undefined];
    if (/FROM journal_entry_line/.test(sql)) return [state.lines, undefined];
    if (/FROM vendor_master/.test(sql)) return [pick([{ id: "v1", n: "OESPL Private Limited" }]), undefined];
    if (/FROM payable_account_master/.test(sql))
      return [pick([
        { id: "tds", n: "TDS Payable", account_name: "TDS Payable", account_type: "payable" },
        { id: "imp", n: "Imprest Float", account_name: "Imprest Float", account_type: "other" },
        { id: "chg", n: "Bank Charges", account_name: "Bank Charges", account_type: "bank_charge" },
      ]), undefined];
    if (/FROM company_bank_account/.test(sql)) return [pick([{ id: "b1", n: "HDFC Bank CA" }, { id: "b2", n: "ICICI Bank CA" }]), undefined];
    if (/FROM finance_expense_sub_head_master/.test(sql)) return [pick([{ id: "s1", n: "Office Rent", pnl_bucket: "bmc_non_people" }]), undefined];
    if (/FROM branch_master/.test(sql)) return [pick([{ id: "br1", n: "NOIDA-2", branch_name: "NOIDA-2", code: null }, { id: "br2", n: "NOIDA-DIALDESK", branch_name: "NOIDA-DIALDESK", code: null }]), undefined];
    if (/FROM tally_legacy_name/.test(sql) && params?.[0] === "branch")
      return [[{ entity_id: "br2", tally_name: "NOIDA-DIALDESK", tally_code: "NOIDAD" }].filter((r) => params.includes(r.entity_id)), undefined];
    if (/FROM payment_voucher/.test(sql)) return [pick(state.pvs), undefined];
    if (/FROM imprest_manager/.test(sql)) return [pick([{ id: "im1", n: "Aman Lawaniya" }]), undefined];
    if (/FROM client_invoice/.test(sql)) return [[], undefined];
    if (/FROM journal_voucher/.test(sql)) return [state.jvs, undefined];
    if (/FROM imprest_allocation/.test(sql)) return [state.topups, undefined];
    return [[], undefined];
  });
  return { state, run };
});
vi.mock("../../../db/mysql.js", () => ({ db: { query: h.run, execute: h.run } }));
vi.mock("../grn-tally-download.service.js", () => ({
  GRN_IMPORT_COLUMNS: ["Vch No", "Date", "Effective Date", "Details", "Debit Amount", "Credit Amount", "Cost Category", "Cost Centre", "Narration for Each Entry", "Narration", "VchType"],
  IMPREST_IMPORT_COLUMNS: ["Vch No", "Date", "Details", "Amount", "DebitCredit", "Cost Category", "Cost Centre", "Narration for Each Entry", "Narration", "VchType"],
  buildGrnTallyXlsx: async () => { const wb = new (await import("exceljs")).default.Workbook(); wb.addWorksheet("Import").addRow(["Vch No"]); return Buffer.from(await wb.xlsx.writeBuffer()); },
  grnImportRows: (data: any) => data.rows.flatMap((r: any) => r.exception || !r.header ? [] : r.entries.map((e: any) => [
    r.header.voucherNumber, r.header.date, r.header.effectiveDate, e.ledger, e.side === "Dr" ? e.amount : "", e.side === "Cr" ? e.amount : "",
    r.header.costCategory, r.header.costCentre, r.header.narrationEntry ?? "", r.header.narration ?? "", r.header.voucherType,
  ])),
  loadGrnTallyDownload: async () => ({
    rows: [{
      grnNumber: "MAS/09/26/0001", grnType: "vendor", exception: null, gross: 517902, voucherXml: '<VOUCHER VCHTYPE="JrnlP"></VOUCHER>',
      header: { voucherNumber: "INV/MAS/09/26/0001", date: "2026-09-30", effectiveDate: "2026-09-01", costCategory: "NOIDA-2", costCentre: "NOIDA-2/2609", narrationEntry: "x", narration: "x", voucherType: "JrnlP" },
      entries: [
        { ledger: "Office Rent", side: "Dr", amount: 438900 },
        { ledger: "Input CGST @9%(Uttar Pradesh)", side: "Dr", amount: 39501 },
        { ledger: "Input SGST @9%(Uttar Pradesh)", side: "Dr", amount: 39501 },
        { ledger: "OESPL Private Limited", side: "Cr", amount: 474012 },
        { ledger: "TDS RENT 2022-23", side: "Cr", amount: 43890 },
      ],
    }],
    vouchersXml: ['<VOUCHER VCHTYPE="JrnlP"></VOUCHER>'],
    truncated: false,
    company: null,
  }),
}));

import ExcelJS from "exceljs";
import { buildLedgerTallyExport, buildLedgerTallyXlsx, buildPaymentVoucherTallyXml } from "../tally-ledger-export.service.js";

const entry = (id: string, source: string, sourceId: string | null, branch: string | null = null) =>
  ({ id, entry_date: "2026-09-15", narration: `${source} ${id}`, source_type: source, source_id: sourceId, branch_id: branch });
const line = (je: string, order: number, type: string, acc: string, dr: number, cr: number) =>
  ({ journal_entry_id: je, line_order: order, account_type: type, account_id: acc, debit_amount: dr, credit_amount: cr });
const vouchers = (xml: string) => [...xml.matchAll(/<VOUCHER [^>]*>[\s\S]*?<\/VOUCHER>/g)].map((m) => m[0]);
const amounts = (v: string) => [...v.matchAll(/<\/ISDEEMEDPOSITIVE><AMOUNT>(-?[\d.]+)/g)].map((m) => Number(m[1]));

beforeEach(() => {
  Object.assign(h.state, { entries: [], lines: [], pvs: [], jvs: [], topups: [] });
});

describe("buildLedgerTallyExport", () => {
  it("vendor payment: TDS booked on the GRN, so the vendor is debited net and there is no TDS line", async () => {
    h.state.entries = [entry("je1", "payment_voucher", "pv1")];
    h.state.lines = [line("je1", 1, "vendor", "v1", 50000, 0), line("je1", 2, "bank_account", "b1", 0, 45000), line("je1", 3, "payable_account", "tds", 0, 5000)];
    h.state.pvs = [{ id: "pv1", voucher_number: "PV/HQ/202609/0001", voucher_type: "payment", source_type: "vendor_grn", transaction_ref: "UTR1" }];
    const { xml, summary } = await buildLedgerTallyExport({ month: "2026-09", kind: "payments" });
    const [v] = vouchers(xml);
    expect(v).toContain('VCHTYPE="Payment"');
    expect(v).toContain("<VOUCHERNUMBER>PV/HQ/202609/0001</VOUCHERNUMBER>");
    expect(v).toMatch(/<LEDGERNAME>OESPL Private Limited<\/LEDGERNAME><ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE><AMOUNT>-45000.00/);
    expect(v).not.toContain("TDS Payable");
    expect(amounts(v).reduce((a, b) => a + b, 0)).toBe(0);
    expect(summary.counts.payments).toBe(1);
  });

  it("imprest top-up via payment voucher: the generic float becomes the holder's own ledger", async () => {
    h.state.entries = [entry("je2", "payment_voucher", "pv2")];
    h.state.lines = [line("je2", 1, "payable_account", "imp", 30000, 0), line("je2", 2, "bank_account", "b1", 0, 30000)];
    h.state.pvs = [{ id: "pv2", voucher_number: "PV/2", voucher_type: "payment", source_type: "imprest_allocation", linked_imprest_manager_id: "im1" }];
    const { xml } = await buildLedgerTallyExport({ month: "2026-09", kind: "all" });
    expect(xml).toContain("<LEDGERNAME>Aman Lawaniya</LEDGERNAME>");
    expect(xml).not.toContain("<LEDGERNAME>Imprest Float</LEDGERNAME>");
    expect(xml).toContain('<LEDGER NAME="Aman Lawaniya" ACTION="Create"><NAME>Aman Lawaniya</NAME><PARENT>Loans &amp; Advances (Asset)</PARENT>');
  });

  it("internal transfer is a Contra; a journal voucher keeps its number and gets a cost centre on the expense line", async () => {
    h.state.entries = [entry("je3", "payment_voucher", "pv3"), entry("je4", "manual", null, "br1")];
    h.state.lines = [
      line("je3", 1, "bank_account", "b2", 100000, 0), line("je3", 2, "bank_account", "b1", 0, 100000),
      line("je4", 1, "expense_sub_head", "s1", 1200, 0), line("je4", 2, "payable_account", "chg", 0, 1200),
    ];
    h.state.pvs = [{ id: "pv3", voucher_number: "PV/3", voucher_type: "payment", source_type: "internal_transfer" }];
    h.state.jvs = [{ journal_entry_id: "je4", reversal_entry_id: null, voucher_number: "JV/2026/0007", narration: "Rent accrual" }];
    const { xml, summary } = await buildLedgerTallyExport({ month: "2026-09", kind: "all" });
    const vs = vouchers(xml);
    expect(vs.find((v) => v.includes("PV/3"))).toContain('VCHTYPE="Contra"');
    const jv = vs.find((v) => v.includes("JV/2026/0007"))!;
    expect(jv).toContain('VCHTYPE="Journal"');
    expect(jv).toContain("<NARRATION>Rent accrual</NARRATION>");
    expect(jv).toContain("<CATEGORY>NOIDA-2</CATEGORY><COSTCENTREALLOCATIONS.LIST><NAME>NOIDA-2/2609</NAME>");
    expect(summary.counts).toMatchObject({ grn: 1, payments: 1, journals: 1, exceptions: 0 });
  });

  it("everything file: masters first (cost categories, centres, ledgers in Tally groups, JrnlP type), then vouchers", async () => {
    const { xml, summary } = await buildLedgerTallyExport({ month: "2026-09", kind: "all" });
    expect(xml.indexOf("<COSTCATEGORY")).toBeLessThan(xml.indexOf("<VOUCHER "));
    expect(xml).toContain('<LEDGER NAME="TDS RENT 2022-23" ACTION="Create"><NAME>TDS RENT 2022-23</NAME><PARENT>Duties &amp; Taxes</PARENT>');
    expect(xml).toContain('<LEDGER NAME="OESPL Private Limited" ACTION="Create"><NAME>OESPL Private Limited</NAME><PARENT>Sundry Creditors</PARENT>');
    expect(xml).toContain('<LEDGER NAME="Office Rent" ACTION="Create"><NAME>Office Rent</NAME><PARENT>Indirect Expenses</PARENT><ISCOSTCENTRESON>Yes</ISCOSTCENTRESON>');
    expect(xml).toContain('<VOUCHERTYPE NAME="JrnlP" ACTION="Create"><NAME>JrnlP</NAME><PARENT>Journal</PARENT>');
    expect(summary.masters.ledgers).toBe(5);
  });

  it("uses the Tally company's own cost-centre code for the branch (legacy db_bill tally_code)", async () => {
    h.state.entries = [entry("je6", "manual", null, "br2")];
    h.state.lines = [line("je6", 1, "expense_sub_head", "s1", 500, 0), line("je6", 2, "payable_account", "chg", 0, 500)];
    const { xml } = await buildLedgerTallyExport({ month: "2026-09", kind: "journals" });
    expect(xml).toContain("<CATEGORY>NOIDA-DIALDESK</CATEGORY><COSTCENTREALLOCATIONS.LIST><NAME>NOIDAD/2609</NAME>");
  });

  it("a line with no Tally ledger name is left out with the reason", async () => {
    h.state.entries = [entry("je5", "payment_voucher", "pv5")];
    h.state.lines = [line("je5", 1, "vendor", "unknown", 100, 0), line("je5", 2, "bank_account", "b1", 0, 100)];
    h.state.pvs = [{ id: "pv5", voucher_number: "PV/5", voucher_type: "payment", source_type: "vendor_advance" }];
    const { xml, summary } = await buildLedgerTallyExport({ month: "2026-09", kind: "payments" });
    expect(vouchers(xml)).toHaveLength(0);
    expect(summary.exceptions).toEqual([{ kind: "payments", ref: "PV/5", reason: expect.stringMatching(/no Tally ledger name/) }]);
  });

  it("Bank Ledger file: chosen payment vouchers, same voucher and REMOTEID as the month file, with masters", async () => {
    h.state.entries = [entry("je1", "payment_voucher", "pv1"), entry("je9", "payment_voucher", "pv9")];
    h.state.lines = [line("je1", 1, "vendor", "v1", 50000, 0), line("je1", 2, "bank_account", "b1", 0, 45000), line("je1", 3, "payable_account", "tds", 0, 5000)];
    h.state.pvs = [{ id: "pv1", voucher_number: "PV/HQ/202609/0001", voucher_type: "payment", source_type: "vendor_grn" }];
    const bank = await buildPaymentVoucherTallyXml(["pv1"]);
    const month = await buildLedgerTallyExport({ month: "2026-09", kind: "payments" });
    expect(bank.count).toBe(1);
    expect(bank.exceptions).toEqual([]);
    const [v] = vouchers(bank.xml);
    expect(v).toContain('REMOTEID="HRMS-JE-je1"');
    expect(v).toBe(vouchers(month.xml).find((x) => x.includes("HRMS-JE-je1")));
    expect(bank.xml).toContain("<IMPORTDUPS>@@DUPIGNORE</IMPORTDUPS>");
    expect(bank.xml).toContain('<LEDGER NAME="OESPL Private Limited" ACTION="Create">');
    expect(bank.xml).not.toContain("je9");
  });
});

describe("buildLedgerTallyXlsx", () => {
  const sheet = async (buffer: Buffer) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    return wb;
  };
  const rowsOf = (ws: ExcelJS.Worksheet) => {
    const out: unknown[][] = [];
    ws.eachRow((r) => out.push((r.values as unknown[]).slice(1)));
    return out;
  };

  it("carries the same month as the XML: GRN lines in the legacy columns, then payments and journals, with a summary", async () => {
    h.state.entries = [entry("je1", "payment_voucher", "pv1"), entry("je4", "manual", null, "br1")];
    h.state.lines = [
      line("je1", 1, "vendor", "v1", 50000, 0), line("je1", 2, "bank_account", "b1", 0, 45000), line("je1", 3, "payable_account", "tds", 0, 5000),
      line("je4", 1, "expense_sub_head", "s1", 1200, 0), line("je4", 2, "payable_account", "chg", 0, 1200),
    ];
    h.state.pvs = [{ id: "pv1", voucher_number: "PV/HQ/202609/0001", voucher_type: "payment", source_type: "vendor_grn" }];
    h.state.jvs = [{ journal_entry_id: "je4", reversal_entry_id: null, voucher_number: "JV/2026/0007", narration: "Rent accrual" }];
    const { buffer, summary } = await buildLedgerTallyXlsx({ month: "2026-09", kind: "all" });
    const wb = await sheet(buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Import", "Vouchers", "Masters", "Summary", "Exceptions"]);
    const imp = rowsOf(wb.getWorksheet("Import")!);
    expect(imp[0]).toEqual(["Vch No", "Date", "Effective Date", "Details", "Debit Amount", "Credit Amount", "Cost Category", "Cost Centre", "Narration for Each Entry", "Narration", "VchType"]);
    expect(imp.filter((r) => r[0] === "INV/MAS/09/26/0001")).toHaveLength(5); // one row per GRN ledger line
    const pay = imp.filter((r) => r[0] === "PV/HQ/202609/0001");
    expect(pay.map((r) => [r[3], r[4], r[5]])).toEqual([["OESPL Private Limited", 45000, undefined], ["HDFC Bank CA", undefined, 45000]]); // TDS booked on the GRN, vendor net
    expect(imp.some((r) => r[0] === "JV/2026/0007" && r[10] === "Journal")).toBe(true);
    const vs = rowsOf(wb.getWorksheet("Vouchers")!);
    expect(vs.length - 1).toBe(summary.counts.grn + summary.counts.payments + summary.counts.journals);
    expect(summary.counts).toMatchObject({ grn: 1, payments: 1, journals: 1 });
  });

  it("one kind only: GRN scope has no payments, and masters scope has no Import sheet", async () => {
    h.state.entries = [entry("je1", "payment_voucher", "pv1")];
    h.state.lines = [line("je1", 1, "vendor", "v1", 100, 0), line("je1", 2, "bank_account", "b1", 0, 100)];
    h.state.pvs = [{ id: "pv1", voucher_number: "PV/9", voucher_type: "payment", source_type: "vendor_grn" }];
    const grn = await sheet((await buildLedgerTallyXlsx({ month: "2026-09", kind: "grn" })).buffer);
    expect(rowsOf(grn.getWorksheet("Import")!).some((r) => r[0] === "PV/9")).toBe(false);
    const masters = await sheet((await buildLedgerTallyXlsx({ month: "2026-09", kind: "masters" })).buffer);
    expect(masters.getWorksheet("Import")).toBeUndefined();
    expect(rowsOf(masters.getWorksheet("Masters")!).some((r) => r[0] === "Ledger" && r[1] === "Office Rent")).toBe(true);
  });

  it("a text cell that starts with = + - @ is stored as text, not as a formula", async () => {
    h.state.entries = [entry("je7", "manual", null, "br1")];
    h.state.lines = [line("je7", 1, "expense_sub_head", "s1", 10, 0), line("je7", 2, "payable_account", "chg", 0, 10)];
    h.state.jvs = [{ journal_entry_id: "je7", reversal_entry_id: null, voucher_number: "JV/8", narration: "=HYPERLINK(\"http://x\")" }];
    const wb = await sheet((await buildLedgerTallyXlsx({ month: "2026-09", kind: "journals" })).buffer);
    const row = rowsOf(wb.getWorksheet("Import")!).find((r) => r[0] === "JV/8")!;
    expect(String(row[9]).startsWith("'=")).toBe(true);
  });
});
