/**
 * Read-only probe of the legacy I-Spark billing (db_bill) to pin down screen rules the HRMS
 * Client Billing replica must copy exactly. SELECT/SHOW only (billQuery allowlist) on db_bill,
 * SELECT only on mas_hrms. Prints aggregates and codes, no client names or addresses.
 *
 * Run: npx tsx scripts/billing-legacy-probe.ts   (ops-billing-legacy-probe.yml)
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { db } from "../src/db/mysql.js";

type Row = Record<string, unknown>;
async function bill(label: string, sql: string): Promise<Row[]> {
  try {
    const rows = (await billQuery<RowDataPacket>(sql)) as unknown as Row[];
    console.log(`\n### ${label} (${rows.length} rows)`);
    console.table(rows.slice(0, 60));
    return rows;
  } catch (e) {
    console.log(`\n### ${label} FAILED: ${(e as Error).message}`);
    return [];
  }
}
async function hrms(label: string, sql: string): Promise<void> {
  try {
    const [rows] = await db.query<RowDataPacket[]>(sql);
    console.log(`\n### [mas_hrms] ${label} (${rows.length} rows)`);
    console.table(rows.slice(0, 60));
  } catch (e) {
    console.log(`\n### [mas_hrms] ${label} FAILED: ${(e as Error).message}`);
  }
}

async function round2() {
  await hrms("HRMS bill/proforma sequences", "SELECT kind, scope_key, `last_value`, updated_at FROM client_invoice_number_sequence ORDER BY kind, scope_key");
  await hrms("HRMS live invoices", "SELECT proforma_no, bill_no, invoice_status, created_at FROM client_invoice WHERE is_migrated = 0");
  await hrms("HRMS max migrated bill index per scope (2026-27)", `SELECT SUBSTRING_INDEX(bill_no,'-',1) AS st, MAX(CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(bill_no,'/',1),'-',-1) AS UNSIGNED)) AS max_idx, COUNT(*) AS n
     FROM client_invoice WHERE finance_year = '2026-27' AND bill_no LIKE '__-%/26-27' GROUP BY st`);
  await bill("legacy max bill index per scope (2026-27)",
    `SELECT state_code, cost_company_name, MAX(BillNoChange) AS max_idx, COUNT(*) AS n
     FROM tbl_invoice WHERE bill_finance_year = '2026-27' OR finance_year = '2026-27' GROUP BY state_code, cost_company_name`);
  await bill("legacy max proforma per state (2026-27)",
    `SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(proforma_bill_no,'/',2),'/',-1) AS st, MAX(CAST(SUBSTRING_INDEX(proforma_bill_no,'/',-1) AS UNSIGNED)) AS max_pi, COUNT(*) AS n
     FROM tbl_invoice WHERE proforma_bill_no LIKE 'PI/%' GROUP BY st`);
  await bill("provision_master_edit_request columns", "SHOW COLUMNS FROM provision_master_edit_request");
  await bill("send_bps / out_source / billing flags (2026-27)",
    `SELECT send_bps, (out_source_amt NOT IN ('','0')) AS has_outsource, billing_active, billing_status, COUNT(*) AS n
     FROM provision_master WHERE finance_year = '2026-27' GROUP BY 1,2,3,4`);
}

async function main() {
  if (process.env.PROBE_ROUND === "2") return round2();
  // 1. Table shapes behind the screens.
  for (const t of ["tbl_invoice", "inv_particulars", "inv_deduct_particulars", "provision_master",
    "provision_master_month_deductions", "po_number", "po_number_particulars", "bill_no_master"]) {
    const cols = await bill(`columns ${t}`, `SHOW COLUMNS FROM ${t}`);
    if (cols.length) console.log(`${t}: ${cols.map((c) => `${c.Field}:${c.Type}`).join(", ")}`);
  }
  await bill("tables like bps/outsource/grn/ahmedabad/upload",
    `SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
       AND (TABLE_NAME LIKE '%bps%' OR TABLE_NAME LIKE '%outsource%' OR TABLE_NAME LIKE '%grn%'
            OR TABLE_NAME LIKE '%ahmed%' OR TABLE_NAME LIKE '%upload%' OR TABLE_NAME LIKE '%provision%')`);

  // 2. Apply Tax Calculation (app_tax_cal) vs GST amounts, FY 2025-26 onward.
  await bill("app_tax_cal x apply_gst x tax present",
    `SELECT app_tax_cal, apply_gst, apply_service_tax,
            SUM(CAST(COALESCE(NULLIF(igst,''),0) AS DECIMAL(16,2)) + CAST(COALESCE(NULLIF(cgst,''),0) AS DECIMAL(16,2)) + CAST(COALESCE(NULLIF(sgst,''),0) AS DECIMAL(16,2)) > 0) AS with_gst,
            COUNT(*) AS n
     FROM tbl_invoice WHERE finance_year IN ('2025-26','2026-27') GROUP BY app_tax_cal, apply_gst, apply_service_tax`);
  await bill("app_tax_cal: total vs grnd sample",
    `SELECT id, app_tax_cal, apply_gst, total, tax, igst, cgst, sgst, grnd FROM tbl_invoice
     WHERE finance_year = '2026-27' ORDER BY id DESC LIMIT 25`);

  // 3. Invoice date vs billing month (is the date locked to month end?).
  await bill("invoiceDate vs month (2026-27)",
    `SELECT month, DATE_FORMAT(invoiceDate,'%Y-%m-%d') AS invoiceDate, DATE_FORMAT(createdate,'%Y-%m-%d') AS created,
            (invoiceDate = LAST_DAY(invoiceDate)) AS is_month_end, COUNT(*) AS n
     FROM tbl_invoice WHERE finance_year = '2026-27' GROUP BY month, invoiceDate, DATE(createdate) ORDER BY MAX(id) DESC LIMIT 40`);
  await bill("month-end share by FY",
    `SELECT finance_year, SUM(invoiceDate = LAST_DAY(invoiceDate)) AS month_end, COUNT(*) AS n
     FROM tbl_invoice WHERE finance_year IN ('2024-25','2025-26','2026-27') GROUP BY finance_year`);

  // 4. Provision draw-down across months (Month vs Month Year).
  await bill("deductions: provision month vs used-by month",
    `SELECT (Provision_Finance_Month = Provision_UsedBy_Month) AS same_month, COUNT(*) AS n,
            COUNT(DISTINCT InvoiceId) AS invoices
     FROM provision_master_month_deductions WHERE Provision_Finance_Year = '2026-27' GROUP BY same_month`);
  await bill("deductions per invoice (months drawn)",
    `SELECT months_drawn, COUNT(*) AS invoices FROM (
       SELECT InvoiceId, COUNT(DISTINCT Provision_Finance_Month) AS months_drawn
       FROM provision_master_month_deductions WHERE Provision_Finance_Year = '2026-27' GROUP BY InvoiceId) x
     GROUP BY months_drawn`);
  await bill("deduction sample",
    `SELECT InvoiceId, Provision_Cost_Center, Provision_Finance_Month, Provision_UsedBy_Month, ProvisionBalanceUsed, deduction_status
     FROM provision_master_month_deductions ORDER BY ProvisionMonthId DESC LIMIT 25`);
  await bill("provision_master recent (no names)",
    `SELECT id, cost_center, branch_name, finance_year, month, invoiceType1, provision, billing_amt, billing_status, revenue_active
     FROM provision_master ORDER BY id DESC LIMIT 25`);

  // 5. Service column, Files, View-to-Ahmedabad, PO/GRN approval flags, state machine.
  await bill("inv_particulars sample", `SELECT * FROM inv_particulars ORDER BY 1 DESC LIMIT 15`);
  await bill("view_ahmedabad / approve_po / approve_grn / files",
    `SELECT view_ahmedabad, approve_po, approve_grn, (filepath IS NOT NULL AND filepath <> '') AS has_file, COUNT(*) AS n
     FROM tbl_invoice WHERE finance_year = '2026-27' GROUP BY view_ahmedabad, approve_po, approve_grn, has_file`);
  await bill("filepath extensions",
    `SELECT SUBSTRING_INDEX(filepath,'.',-1) AS ext, COUNT(*) AS n FROM tbl_invoice
     WHERE filepath IS NOT NULL AND filepath <> '' GROUP BY ext ORDER BY n DESC LIMIT 10`);
  await bill("state machine (status, proforma_approve, bill assigned)",
    `SELECT status, proforma_approve, (bill_no IS NOT NULL AND bill_no <> '') AS has_bill, COUNT(*) AS n
     FROM tbl_invoice WHERE finance_year = '2026-27' GROUP BY status, proforma_approve, has_bill`);

  // 6. Bill-number counters: legacy now vs HRMS sequence (duplicate risk).
  await bill("legacy max bill index per scope (2026-27)",
    `SELECT state_code, company_name, MAX(BillNoChange) AS max_idx, COUNT(*) AS n
     FROM tbl_invoice WHERE bill_finance_year = '2026-27' OR finance_year = '2026-27'
     GROUP BY state_code, company_name ORDER BY n DESC LIMIT 30`);
  await bill("legacy max bill index per scope via cost_company_name (2026-27)",
    `SELECT state_code, cost_company_name, MAX(BillNoChange) AS max_idx, COUNT(*) AS n
     FROM tbl_invoice WHERE bill_finance_year = '2026-27' OR finance_year = '2026-27'
     GROUP BY state_code, cost_company_name ORDER BY n DESC LIMIT 30`);
  await bill("legacy latest bills", `SELECT bill_no, state_code, DATE_FORMAT(createdate,'%Y-%m-%d') AS created
     FROM tbl_invoice WHERE bill_no IS NOT NULL AND bill_no <> '' ORDER BY id DESC LIMIT 15`);
  await bill("legacy proforma counter", `SELECT * FROM bill_no_master`);
  await hrms("HRMS bill/proforma sequences", `SELECT kind, scope_key, `last_value`, updated_at FROM client_invoice_number_sequence ORDER BY kind, scope_key`);
  await hrms("HRMS live invoices/provisions", `SELECT (SELECT COUNT(*) FROM client_invoice WHERE is_migrated = 0) AS live_invoices,
     (SELECT COUNT(*) FROM client_provision) AS provisions, (SELECT MAX(created_at) FROM client_invoice WHERE is_migrated = 0) AS last_live`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await closeBillPool(); await db.end().catch(() => {}); });
