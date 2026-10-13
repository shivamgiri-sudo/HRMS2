import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    calls: [] as { sql: string; params: any[] }[],
    rows: [] as any[],
  };
  const run = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });
    if (/FROM grn_request g/.test(sql)) return [state.rows, undefined];
    if (/FROM vendor_master/.test(sql))
      return [[{ id: "v1", n: "OESPL Private Limited" }], undefined];
    if (/FROM branch_master/.test(sql))
      return [[{ id: "b1", n: "NOIDA" }], undefined];
    return [[], undefined];
  });
  return { state, run };
});
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: h.run, query: h.run },
}));

import {
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
  already_sent: 0,
  ...extra,
});

beforeEach(() => {
  h.state.calls.length = 0;
  h.state.rows = [];
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
    expect(select.sql).toMatch(/g\.status NOT IN/);
    expect(select.params).toEqual(["cancelled", "consumption_reversed", "2026-09"]);
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
    expect(grnTallyDownloadSummary(data)).toMatchObject({ grns: 2, inXml: 1, exceptions: 1, grossInXml: 118000 });
  });
});

describe("file builders", () => {
  it("XML is a Tally import envelope with one Purchase voucher per GRN", async () => {
    h.state.rows = [row("g1", "Mas/09/26/1")];
    const xml = buildGrnTallyXml(await loadGrnTallyDownload(all));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><ENVELOPE>')).toBe(true);
    expect(xml).toContain("<TALLYREQUEST>Import Data</TALLYREQUEST>");
    expect(xml).toContain("<VOUCHERNUMBER>Mas/09/26/1</VOUCHERNUMBER>");
    expect(xml).toContain("<PARTYLEDGERNAME>OESPL Private Limited</PARTYLEDGERNAME>");
    expect(xml.match(/<VOUCHER /g)).toHaveLength(1);
  });

  it("CSV has the ledger split and neutralises formula cells", async () => {
    h.state.rows = [row("g1", "Mas/09/26/1")];
    const csv = buildGrnTallyCsv(await loadGrnTallyDownload(all));
    const [header, line] = csv.trim().split("\r\n");
    expect(header).toContain("GRN Number");
    expect(line).toContain("Office Rent:Dr:100000.00 | Input CGST:Dr:9000.00 | Input SGST:Dr:9000.00 | OESPL Private Limited:Cr:118000.00");
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it("Excel opens with GRNs, balanced voucher lines and exceptions", async () => {
    h.state.rows = [row("g1", "Mas/09/26/1"), row("g2", "Mas/09/26/2", { amount_with_tax: 0, amount: 0 })];
    const buf = await buildGrnTallyXlsx(await loadGrnTallyDownload(all));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["GRNs", "Voucher Lines", "Exceptions"]);
    expect(wb.getWorksheet("GRNs")!.rowCount).toBe(3);
    const lines = wb.getWorksheet("Voucher Lines")!;
    let dr = 0;
    let cr = 0;
    lines.eachRow((r, i) => {
      if (i === 1) return;
      dr += Number(r.getCell(6).value ?? 0);
      cr += Number(r.getCell(7).value ?? 0);
    });
    expect(dr).toBe(118000);
    expect(cr).toBe(118000);
    expect(wb.getWorksheet("Exceptions")!.rowCount).toBe(2);
  });
});
