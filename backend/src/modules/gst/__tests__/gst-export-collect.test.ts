import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * collectRows through generateBatch with a scripted connection: which documents are selected and
 * what each staged row carries (party name, PO/GRN, state code, our-GSTIN flags).
 */
const { conn } = vi.hoisted(() => ({
  conn: {
    execute: vi.fn(),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  },
}));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(), query: vi.fn(), getConnection: vi.fn(async () => conn) },
}));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));

import { gstExportService } from "../gst-export.service.js";

const MAS_UP = "09AAACM5866H1Z6";
const MAS_GJ = "24AAACM5866H1ZE";

const invoice = (o: Record<string, unknown> = {}) => ({
  id: "i1", bill_no: "UP-01/26-27", invoice_date: "2026-10-03", finance_year: "2026-27", month_label: "Sep-26",
  gst_type: "Intrastate", apply_gst: 1, total_amount: "100000.00", igst_amount: "0", cgst_amount: "9000.00",
  sgst_amount: "9000.00", grand_total: "118000.00", tally_head: null, client_tally_name: "",
  po_numbers: "PO-77", jcc_no: "JCC-5", grn_no: "GRN-9",
  cost_centre_code: "OF/1", billing_client_name: "Acme Telecom Pvt Ltd", client_name: "Acme", service_tax_no: null,
  vendor_gst_no: "NA", vendor_state_code: "9", sac_code: "998513", hsn_code: null,
  branch_name: "Noida", branch_gstin: MAS_UP, gst_state_code: "9", branch_company: "MAS Callnet India Pvt Ltd",
  ...o,
});

let inserted: unknown[][];
function script(invoices: unknown[], notes: unknown[] = []) {
  inserted = [];
  conn.execute.mockImplementation(async (raw: unknown, params: unknown[]) => {
    const sql = String(raw ?? "");
    if (sql.includes("FROM client_invoice ci")) return [invoices, []];
    if (sql.includes("FROM client_credit_note cn")) return [notes, []];
    if (sql.includes("INSERT INTO gst_export_row")) inserted.push(params);
    return [{ affectedRows: 1 }, []];
  });
}
const sqlOf = (needle: string) => String(conn.execute.mock.calls.find((c) => String(c[0]).includes(needle))![0]);
// Column positions in the gst_export_row INSERT.
const COL = { clientName: 13, clientState: 15, poNo: 18, grnNo: 19, errors: 33 };

beforeEach(() => conn.execute.mockReset());

describe("GST export collection", () => {
  it("selects by the GSTIN the bill was issued under and only approved credit notes", async () => {
    script([invoice()]);
    await gstExportService.generateBatch({ exportType: "GSTR1", companyGstin: MAS_UP, periodMonth: "2026-10" }, null, "system");
    expect(sqlOf("FROM client_invoice ci")).toContain("cm.service_tax_no");
    expect(sqlOf("FROM client_invoice ci")).not.toContain("WHERE bm.gstin = ?");
    expect(sqlOf("FROM client_credit_note cn")).toContain("cn.credit_status = 'approved'");
    // GST returns cover migrated bills too.
    expect(sqlOf("FROM client_invoice ci")).not.toContain("is_migrated");
  });

  it("TALLY_SALES leaves out bills and credit notes that came from I-Spark", async () => {
    script([invoice()]);
    await gstExportService.generateBatch({ exportType: "TALLY_SALES", companyGstin: MAS_UP, periodMonth: "2026-10" }, null, "system");
    expect(sqlOf("FROM client_invoice ci")).toContain("ci.is_migrated = 0");
    expect(sqlOf("FROM client_credit_note cn")).toContain("cn.is_migrated = 0");
  });

  it("party name skips a blank client_tally_name; PO/GRN come from the invoice; state code is padded", async () => {
    script([invoice()]);
    await gstExportService.generateBatch({ exportType: "GSTR1", companyGstin: MAS_UP, periodMonth: "2026-10" }, null, "system");
    const row = inserted[0];
    expect(row[COL.clientName]).toBe("Acme Telecom Pvt Ltd");
    expect(row[COL.clientState]).toBe("09");
    expect(row[COL.poNo]).toBe("PO-77");
    expect(row[COL.grnNo]).toBe("GRN-9");
    // "9" vs "09" no longer reads as an inter-state supply.
    expect(String(row[COL.errors] ?? "")).not.toContain("SPLIT_STATE_MISMATCH");
  });

  it("client_tally_name wins when set; PO falls back to JCC", async () => {
    script([invoice({ client_tally_name: "ACME (Tally)", po_numbers: " ", jcc_no: "JCC-5" })]);
    await gstExportService.generateBatch({ exportType: "GSTR1", companyGstin: MAS_UP, periodMonth: "2026-10" }, null, "system");
    expect(inserted[0][COL.clientName]).toBe("ACME (Tally)");
    expect(inserted[0][COL.poNo]).toBe("JCC-5");
  });

  it("flags a bill issued under a cost centre GSTIN other than its branch's, and a non-GSTIN service_tax_no", async () => {
    script([
      invoice({ id: "a", service_tax_no: MAS_GJ, branch_gstin: MAS_UP, vendor_state_code: "24", cgst_amount: "9000.00", sgst_amount: "9000.00" }),
    ]);
    await gstExportService.generateBatch({ exportType: "GSTR1", companyGstin: MAS_GJ, periodMonth: "2026-10" }, null, "system");
    expect(String(inserted[0][COL.errors])).toContain("OUR_GSTIN_NOT_BRANCH");

    script([invoice({ id: "b", service_tax_no: "NA-PENDING" })]);
    await gstExportService.generateBatch({ exportType: "GSTR1", companyGstin: MAS_UP, periodMonth: "2026-10" }, null, "system");
    expect(String(inserted[0][COL.errors])).toContain("OUR_GSTIN_ON_BILL_INVALID");
  });

  it("credit notes keep the our-GSTIN flag after their sign flip re-validation", async () => {
    script([], [invoice({ id: "cn1", service_tax_no: "BAD" })]);
    await gstExportService.generateBatch({ exportType: "GSTR1", companyGstin: MAS_UP, periodMonth: "2026-10" }, null, "system");
    expect(String(inserted[0][COL.errors])).toContain("OUR_GSTIN_ON_BILL_INVALID");
  });
});
