import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    calls: [] as { sql: string; params: any[] }[],
    rows: [] as any[],
    legacyNames: false,
  };
  const run = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });
    if (/FROM grn_request g/.test(sql)) return [state.rows, undefined];
    if (/SELECT id, vendor_code/.test(sql))
      return [[{ id: "v1", vendor_code: "DB_BILL_1537", n: "OESPL Private Limited" }, { id: "v9", vendor_code: "DB_BILL_9", n: "x" }, { id: "v5", vendor_code: "V00005", n: "Travelling" }], undefined];
    if (/FROM vendor_master/.test(sql))
      return [[{ id: "v1", n: "OESPL Private Limited", tds_enabled: 1, tds_section: "194I", tds_rate: null }], undefined];
    if (/FROM tally_legacy_name WHERE entity_type = 'branch'/.test(sql) && h.state.legacyNames)
      return [[{ entity_id: "b1", tally_name: "Noida", tally_code: "Noida" }], undefined];
    if (/FROM tally_legacy_name t/.test(sql) && h.state.legacyNames)
      return [[{ sub_head_name: "Office Rent", tally_name: "Office Rent (Tally)" }], undefined];
    if (/FROM branch_master/.test(sql))
      return [[{ id: "b1", branch_name: "NOIDA", gst_state_code: "09", state: "UP" }], undefined];
    if (/FROM tds_sub_head_default/.test(sql))
      return [[{ sub_head_name: "Office Rent", section_code: "194I_LB", confidence: "firm" }], undefined];
    if (/FROM imprest_transaction_ledger/.test(sql))
      return [[{ id: "led1", imprest_manager_id: "im1" }], undefined];
    if (/FROM imprest_manager WHERE id IN/.test(sql))
      return [[{ id: "im1", tally_name: "Aman Lawaniya" }, { id: "im2", tally_name: "Dharrmendra Kumar" }], undefined];
    if (/FROM imprest_manager WHERE branch_id IN/.test(sql))
      return [[{ id: "im2", branch_id: "b1", effective_from: "2026-01-01", effective_to: null }], undefined];
    if (/FROM grn_request\s+WHERE bill_source_id IS NOT NULL/.test(sql))
      return [[
        { grn_number: "Mas/9/26/139", invoice_number: "THUP/55292/26-27", amount_with_tax: 6278, amount: 6278, vendor_id: "v9", bill_date: "2026-09-03" },
        { grn_number: "Mas/8/26/391", invoice_number: "2026-27/91", amount_with_tax: 48722.2, amount: 48722.2, vendor_id: "v9", bill_date: "2026-09-01" },
        { grn_number: "Mas/8/26/399", invoice_number: "NA", amount_with_tax: 119920, amount: 119920, vendor_id: "v1", bill_date: "2026-09-07" },
        { grn_number: "Mas/8/26/242", invoice_number: "SSC/848/26-27", amount_with_tax: 11000, amount: 11000, vendor_id: "v7", vendor_name: "SRI SANCHIA COMPUTRONICS", bill_date: "2026-08-20" },
        { grn_number: "Mas/9/26/276", invoice_number: "NA", amount_with_tax: 20409, amount: 20409, vendor_id: "v8", vendor_name: "Travelling Exp Payable (Ahm)", bill_date: "2026-10-03" },
        { grn_number: "Mas/8/26/126", invoice_number: "OESPL/26-27/0411", amount_with_tax: 118000, amount: 118000, vendor_id: "v1", bill_date: "2026-08-01" },
      ], undefined];
    if (/FROM finance_expense_sub_head_master WHERE tds_enabled IS NOT NULL/.test(sql))
      return [[{ sub_head_name: "Fee & Subscription", tds_enabled: 1, tds_rate: 2, tds_tally_ledger: "TDS CONTRACTOR 2021-22" }, { sub_head_name: "Parking Charges", tds_enabled: 0, tds_rate: null, tds_tally_ledger: null }], undefined];
    if (/FROM tds_section_master/.test(sql))
      return [[{ section_code: "194I_LB", rate_other: 10 }], undefined];
    return [[], undefined];
  });
  return { state, run };
});
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: h.run, query: h.run },
}));

import {
  buildGrnTallyCheckXlsx,
  buildGrnTallyCsv,
  buildGrnTallyXlsx,
  buildGrnTallyXml,
  grnTallyDownloadSummary,
  loadGrnTallyDownload,
} from "../grn-tally-download.service.js";

const row = (id: string, n: string, extra: Record<string, unknown> = {}) => ({
  id,
  grn_number: n,
  grn_type: "vendor",
  status: "finance_head_approved",
  accounting_period: "2026-09",
  bill_date: "2026-09-01",
  invoice_number: "INV-1",
  vendor_id: "v1",
  vendor_name: "OESPL",
  vendor_gstin: "09ABCDE1234F1Z5",
  head: "Office Rent",
  sub_head: "Office Rent",
  description: "=HYPERLINK(\"x\")",
  branch_id: "b1",
  amount: 118000,
  amount_without_tax: 100000,
  tax_amount: 18000,
  other_charges: 0,
  round_off_amount: 0,
  amount_with_tax: 118000,
  gst_type: "cgst_sgst",
  recoverable_tax_pct: 100,
  approved_on: "2026-10-06 18:00:00",
  gst_rate: 18,
  already_sent: 0,
  ...extra,
});

beforeEach(() => {
  h.state.calls.length = 0;
  h.state.rows = [];
  h.state.legacyNames = false;
});

const all = { branchScope: { mode: "all" as const } };

describe("loadGrnTallyDownload", () => {
  it("selects only numbered HRMS GRNs and never reserves anything", async () => {
    h.state.rows = [row("g1", "Mas/09/26/1")];
    await loadGrnTallyDownload({ ...all, month: "2026-09" });
    const select = h.state.calls.find((c) => /FROM grn_request g/.test(c.sql))!;
    expect(select.sql).toMatch(/g\.bill_source_id IS NULL/);
    // db_bill migration also wrote suffixed child rows with bill_source_id NULL; its sentinel creator marks them.
    expect(select.sql).toMatch(/COALESCE\(g\.created_by, ''\) NOT LIKE '00000000-%'/);
    expect(select.sql).toMatch(/g\.grn_number IS NOT NULL/);
    expect(select.sql).toMatch(/g\.status IN \(\?,\?\)\) OR \(g\.grn_type <> .imprest. AND g\.status IN \(\?,\?,\?,\?,\?\)/);
    // The month is the posting (approval) month, as in the legacy import.
    expect(select.sql).toMatch(/COALESCE\(g\.approved_at, g\.finance_head_reviewed_at\) >= \?/);
    expect(select.params).toEqual(["approved", "paid", "finance_head_approved", "pending_accounts_payment", "payment_scheduled", "partially_paid", "paid", "vendor", "2026-09-01", "2026-09-30"]);
    expect(h.state.calls.some((c) => /INSERT|UPDATE|DELETE/i.test(c.sql))).toBe(false);
  });

  it("narrows to the caller's branches", async () => {
    await loadGrnTallyDownload({ branchScope: { mode: "branches", branchIds: ["b1"] } });
    const select = h.state.calls.find((c) => /FROM grn_request g/.test(c.sql))!;
    expect(select.sql).toMatch(/g\.branch_id IN \(\?\)/);
    expect(select.params).toContain("b1");
  });

  it("keeps a GRN that cannot become a voucher, with the reason, out of the XML", async () => {
    h.state.rows = [row("g1", "Mas/09/26/1"), row("g2", "Mas/09/26/2", { sub_head: "" })];
    const data = await loadGrnTallyDownload(all);
    expect(data.vouchersXml).toHaveLength(1);
    expect(data.rows[1].exception).toMatch(/Sub-head is missing/);
    expect(grnTallyDownloadSummary(data)).toMatchObject({ grns: 2, inXml: 1, exceptions: 1, grossInXml: 118000, tdsInXml: 10000 });
  });
});

const LEGACY_HEADER = "Vch No,Date,Effective Date,Details,Debit Amount,Credit Amount,Cost Category,Cost Centre,Narration for Each Entry,Narration,VchType";

describe("imprest holder", () => {
  it("named on the GRN, else the float the approval debited, else the branch appointment on the bill date", async () => {
    const imp = { grn_type: "imprest", vendor_id: null, sub_head: "Tour Expenses", amount_without_tax: 1000, tax_amount: 0, amount_with_tax: 1000, amount: 1000, gst_type: "none" };
    h.state.rows = [
      row("g1", "MAS/09/26/1", { ...imp, imprest_ledger_entry_id: "led1" }),
      row("g2", "MAS/09/26/2", { ...imp }),
      row("g3", "MAS/09/26/3", { ...imp, bill_date: "2025-12-01" }),
    ];
    const data = await loadGrnTallyDownload({ ...all, grnType: "imprest" });
    expect(data.rows[0].entries.at(-1)).toEqual({ ledger: "Aman Lawaniya", side: "Cr", amount: 1000 });
    expect(data.rows[0].voucherType).toBe("JRNLIMP");
    expect(data.rows[1].entries.at(-1)).toEqual({ ledger: "Dharrmendra Kumar", side: "Cr", amount: 1000 });
    expect(data.rows[2].exception).toMatch(/float holder/);
    const select = h.state.calls.find((c) => /FROM grn_request g/.test(c.sql))!;
    expect(select.params).toContain("imprest");
  });

  it("vendor GRNs only by default, as the legacy import", async () => {
    await loadGrnTallyDownload(all);
    const select = h.state.calls.find((c) => /FROM grn_request g/.test(c.sql))!;
    expect(select.sql).toMatch(/g\.grn_type = \?/);
    expect(select.params).toContain("vendor");
  });
});

describe("legacy duplicates and legacy TDS", () => {
  it("leaves out a bill the legacy system already sent to Tally", async () => {
    h.state.rows = [row("g1", "MAS/09/26/0002", { invoice_number: "THUP 55292 26-27", amount_with_tax: 6278, amount: 6278, amount_without_tax: 5320, tax_amount: 957.6, round_off_amount: 0.4 })];
    const data = await loadGrnTallyDownload(all);
    expect(data.vouchersXml).toHaveLength(0);
    expect(data.rows[0].exception).toMatch(/Already in Tally through legacy GRN Mas\/9\/26\/139/);
  });

  it("catches a bill written differently: number ending in the other, or same vendor and amount within a week", async () => {
    h.state.rows = [
      row("g1", "MAS/08/26/0040", { invoice_number: "26-27/91", amount_with_tax: 48722.01, amount: 48722.01, amount_without_tax: 41290, tax_amount: 7432.2, round_off_amount: -0.2 }),
      row("g2", "MAS/08/26/0060", { invoice_number: "BS01/BS010018/00833", bill_date: "2026-09-08", amount_with_tax: 119920, amount: 119920, amount_without_tax: 119920, tax_amount: 0, gst_type: "none" }),
    ];
    const data = await loadGrnTallyDownload(all);
    expect(data.rows[0].exception).toMatch(/Probably already in Tally through legacy GRN Mas\/8\/26\/391/);
    expect(data.rows[1].exception).toMatch(/Probably already in Tally through legacy GRN Mas\/8\/26\/399/);
  });

  it("catches the year written differently, and an NA bill from a vendor of a similar name", async () => {
    h.state.rows = [
      row("g1", "MAS/08/26/0026", { invoice_number: "SSC/848/2026-27", bill_date: "2026-08-20", amount_with_tax: 10999.98, amount: 10999.98, amount_without_tax: 9322.03, tax_amount: 1677.97, gst_type: "igst" }),
      row("g2", "MAS/09/26/0049", { vendor_id: "v5", invoice_number: "NA", bill_date: "2026-10-03", sub_head: "Tour Expenses", amount_with_tax: 20409, amount: 20409, amount_without_tax: 20409, tax_amount: 0, gst_type: "none" }),
    ];
    const data = await loadGrnTallyDownload(all);
    expect(data.rows[0].exception).toMatch(/Mas\/8\/26\/242/);
    expect(data.rows[1].exception).toMatch(/Mas\/9\/26\/276/);
  });

  it("a month later, the same vendor and amount is a new bill (monthly rent)", async () => {
    h.state.rows = [row("g1", "MAS/09/26/0001", { invoice_number: "OESPL/26-27/0511" })];
    const data = await loadGrnTallyDownload(all);
    expect(data.rows[0].exception).toBeNull();
  });

  it("sub-head legacy TDS wins over the vendor, and a legacy 'no TDS' sub-head stops the engine default", async () => {
    h.state.rows = [
      row("g1", "MAS/09/26/1", { sub_head: "Fee & Subscription" }),
      row("g2", "MAS/09/26/2", { sub_head: "Parking Charges", invoice_number: "P-1" }),
    ];
    const data = await loadGrnTallyDownload(all);
    expect(data.rows[0].entries).toContainEqual({ ledger: "TDS CONTRACTOR 2021-22", side: "Cr", amount: 2000 });
    expect(data.rows[0].tdsBasis).toMatch(/Sub-head \(legacy\)/);
    expect(data.rows[1].tdsBasis).toBe("No TDS (legacy sub-head setting)");
    expect(data.rows[1].entries.some((e) => /^TDS/.test(e.ledger))).toBe(false);
  });
});

describe("legacy Tally names", () => {
  it("cost category, cost-centre code and expense ledger come from the Tally company's own names", async () => {
    h.state.legacyNames = true;
    h.state.rows = [row("g1", "MAS/09/26/1", { invoice_number: "LN-1" })];
    const data = await loadGrnTallyDownload(all);
    expect(data.rows[0].header).toMatchObject({ costCategory: "Noida", costCentre: "Noida/2609" });
    expect(data.rows[0].entries[0].ledger).toBe("Office Rent (Tally)");
  });
});

describe("file builders", () => {
  it("XML is a Tally import envelope with one JrnlP voucher per GRN", async () => {
    h.state.rows = [row("g1", "Mas/9/26/1")];
    const xml = buildGrnTallyXml(await loadGrnTallyDownload(all));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><ENVELOPE>')).toBe(true);
    expect(xml).toContain("<TALLYREQUEST>Import Data</TALLYREQUEST>");
    expect(xml).toContain("<VOUCHERNUMBER>INV-1/Mas/9/26/1</VOUCHERNUMBER>");
    expect(xml).toContain('VCHTYPE="JrnlP"');
    expect(xml).toContain("<DATE>20261031</DATE>");
    expect(xml.match(/<VOUCHER /g)).toHaveLength(1);
  });

  it("CSV is the legacy import sheet: same header, one row per ledger line, TDS and cost centre", async () => {
    h.state.rows = [row("g1", "Mas/9/26/1")];
    const csv = buildGrnTallyCsv(await loadGrnTallyDownload(all));
    const [header, ...lines] = csv.trim().split("\r\n");
    expect(header).toBe(LEGACY_HEADER);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(/^INV-1\/Mas\/9\/26\/1,31-10-2026,01-09-2026,Office Rent,100000,,NOIDA,Noida\/2609,/);
    expect(lines[1]).toContain("Input CGST @9%(Uttar Pradesh),9000,");
    expect(lines[3]).toContain("OESPL Private Limited,,108000,");
    expect(lines[4]).toContain("TDS RENT 2022-23,,10000,");
    expect(lines[0]).toMatch(/,JrnlP$/);
    // A formula-looking description is neutralised.
    expect(lines[0]).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it("Excel import sheet: one worksheet, legacy columns, real dates, balanced, exceptions left out", async () => {
    h.state.rows = [row("g1", "Mas/9/26/1"), row("g2", "Mas/9/26/2", { amount_with_tax: 0, amount: 0 })];
    const buf = await buildGrnTallyXlsx(await loadGrnTallyDownload(all));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    expect(wb.worksheets).toHaveLength(1);
    const ws = wb.worksheets[0];
    expect((ws.getRow(1).values as unknown[]).slice(1).join(",")).toBe(LEGACY_HEADER);
    expect(ws.rowCount).toBe(6);
    expect(ws.getRow(2).getCell(2).value).toBeInstanceOf(Date);
    let dr = 0;
    let cr = 0;
    ws.eachRow((r, i) => {
      if (i === 1) return;
      dr += Number(r.getCell(5).value || 0);
      cr += Number(r.getCell(6).value || 0);
    });
    expect(dr).toBe(118000);
    expect(cr).toBe(118000);
  });

  it("check workbook lists every GRN with TDS basis and the reason any was left out", async () => {
    h.state.rows = [row("g1", "Mas/9/26/1"), row("g2", "Mas/9/26/2", { amount_with_tax: 0, amount: 0 })];
    const buf = await buildGrnTallyCheckXlsx(await loadGrnTallyDownload(all));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.getWorksheet("GRNs")!;
    expect(ws.rowCount).toBe(3);
    const text = JSON.stringify(ws.getSheetValues());
    expect(text).toContain("Vendor master 194I_LB @ 10%");
    expect(text).toContain("Amount is zero or missing.");
  });
});
