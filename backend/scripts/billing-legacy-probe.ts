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

/** Round 3: are client addresses / GST fields saved on every active MAS cost centre? */
async function round3() {
  const own = "REPLACE(REPLACE(REPLACE(LOWER(COALESCE(cc.company_name, '')), '.', ''), ' ', ''), ',', '') LIKE '%mascallnet%'";
  const blank = (c: string) => `(cc.${c} IS NULL OR TRIM(cc.${c}) = '')`;
  await hrms("HRMS active MAS cost centres: missing billing fields", `SELECT COUNT(*) AS active,
      SUM(${blank("bill_to_address1")}) AS no_bill_to, SUM(${blank("ship_to_address1")}) AS no_ship_to,
      SUM(${blank("vendor_gst_no")}) AS no_client_gstin, SUM(${blank("vendor_gst_state")}) AS no_gst_state,
      SUM(${blank("vendor_state_code")}) AS no_state_code, SUM(${blank("service_tax_no")}) AS no_our_gstin,
      SUM(${blank("hsn_code")}) AS no_hsn, SUM(${blank("billing_client_name")}) AS no_client_name
    FROM cost_centre_master cc WHERE ${own} AND cc.active_status = 1`);
  await hrms("HRMS active MAS cost centres billed in FY 2026-27 (I-Spark mirror) with missing Bill To / GSTIN", `SELECT cc.cost_centre_code,
      LEFT(COALESCE(NULLIF(cc.billing_client_name,''), cc.client_name),40) AS client,
      ${blank("bill_to_address1")} AS no_bill_to, ${blank("vendor_gst_no")} AS no_gstin, ${blank("vendor_gst_state")} AS no_state
    FROM cost_centre_master cc
    WHERE ${own} AND cc.active_status = 1
      AND EXISTS (SELECT 1 FROM client_invoice ci WHERE ci.cost_centre_id = cc.id AND ci.finance_year IN ('2025-26','2026-27'))
      AND (${blank("bill_to_address1")} OR ${blank("vendor_gst_no")} OR ${blank("vendor_gst_state")})
    ORDER BY cc.cost_centre_code`);
  const cmCols = await bill("db_bill cost_master columns", "SHOW COLUMNS FROM cost_master");
  console.log(`cost_master: ${cmCols.map((c) => c.Field).join(", ")}`);
  const [hrRows] = await db.query<RowDataPacket[]>(`SELECT cc.cost_centre_code AS code, ${blank("bill_to_address1")} AS nb, ${blank("vendor_gst_no")} AS ng
    FROM cost_centre_master cc WHERE ${own} AND cc.active_status = 1 AND (${blank("bill_to_address1")} OR ${blank("vendor_gst_no")})`);
  const codes = hrRows.map((r) => String(r.code));
  if (codes.length) {
    const ph = codes.map(() => "?").join(",");
    const legacy = await billQuery<RowDataPacket>(`SELECT cost_center, b_Address1, VendorGSTNo FROM cost_master WHERE cost_center IN (${ph})`, codes);
    const byCode = new Map(legacy.map((r) => [String(r.cost_center), r]));
    let fillAddr = 0, fillGst = 0, notInLegacy = 0;
    for (const r of hrRows) {
      const l = byCode.get(String(r.code));
      if (!l) { notInLegacy++; continue; }
      if (Number(r.nb) && String(l.b_Address1 ?? "").trim()) fillAddr++;
      if (Number(r.ng) && String(l.VendorGSTNo ?? "").trim()) fillGst++;
    }
    console.log(`\n### backfill possible from I-Spark cost_master: ${hrRows.length} HRMS cost centres missing address or GSTIN; legacy has the address for ${fillAddr}, the GSTIN for ${fillGst}; ${notInLegacy} not in cost_master`);
  }
}

/** Round 4: is anyone entering client payments in HRMS today (Client Payments page / receipt vouchers)? */
async function round4() {
  await hrms("client_invoice_payment_log entries made in HRMS (not migrated), by month", `SELECT DATE_FORMAT(created_at,'%Y-%m') AS month, COUNT(*) AS n, COUNT(DISTINCT payment_status_id) AS invoices, SUM(amount_paid) AS amount
     FROM client_invoice_payment_log WHERE COALESCE(is_migrated,0) = 0 GROUP BY month ORDER BY month DESC LIMIT 12`.replace(/created_at/g, "payment_date"));
  await hrms("client_invoice_payment_status rows by status", `SELECT payment_status, COUNT(*) AS n, SUM(amount_received) AS received FROM client_invoice_payment_status GROUP BY payment_status`);
  await hrms("sales_receipt vouchers raised in HRMS, by month and status", `SELECT DATE_FORMAT(raised_at,'%Y-%m') AS month, status, COUNT(*) AS n, SUM(amount) AS amount
     FROM payment_voucher WHERE source_type = 'sales_receipt' GROUP BY month, status ORDER BY month DESC LIMIT 20`);
}

/** Round 5: what MAS Callnet data is in db_bill but missing in HRMS (bills, proformas, credit notes, provisions, collections). */
async function round5() {
  const MAS = "cost_company_name LIKE '%Mas Callnet%'";
  const ids = async (sql: string) => new Set((await billQuery<RowDataPacket>(sql)).map((r) => Number(r.id)));
  const [hInv] = await db.query<RowDataPacket[]>(`SELECT legacy_id FROM client_invoice WHERE legacy_id IS NOT NULL`);
  const hrmsInv = new Set(hInv.map((r) => Number(r.legacy_id)));
  const billed = await billQuery<RowDataPacket>(`SELECT id, finance_year, bill_no, status, proforma_approve FROM tbl_invoice WHERE ${MAS}`);
  const byFy = new Map<string, { legacy: number; missing: number; missingBilled: number; missingProforma: number; missingRejected: number }>();
  for (const r of billed) {
    const fy = String(r.finance_year ?? "?");
    const e = byFy.get(fy) ?? { legacy: 0, missing: 0, missingBilled: 0, missingProforma: 0, missingRejected: 0 };
    e.legacy++;
    if (!hrmsInv.has(Number(r.id))) {
      e.missing++;
      if (Number(r.status) === 1) e.missingRejected++;
      else if (String(r.bill_no ?? "").trim()) e.missingBilled++;
      else e.missingProforma++;
    }
    byFy.set(fy, e);
  }
  console.log("\n### MAS invoices: db_bill tbl_invoice vs HRMS client_invoice (by legacy_id)");
  console.table([...byFy.entries()].sort().reverse().slice(0, 6).map(([fy, e]) => ({ fy, ...e })));
  const missing26 = billed.filter((r) => !hrmsInv.has(Number(r.id)) && String(r.finance_year) === "2026-27" && Number(r.status) !== 1);
  console.log(`missing 2026-27 (not rejected) ids: ${missing26.slice(0, 40).map((r) => `${r.id}:${String(r.bill_no || "PI")}`).join(", ")}${missing26.length > 40 ? " ..." : ""}`);

  const [hCn] = await db.query<RowDataPacket[]>(`SELECT legacy_id FROM client_credit_note WHERE legacy_id IS NOT NULL`);
  const hrmsCn = new Set(hCn.map((r) => Number(r.legacy_id)));
  const cnIds = await ids(`SELECT c.id FROM tbl_credit_note c JOIN tbl_invoice i ON i.bill_no = c.proforma_bill_no WHERE i.${MAS}`);
  console.log(`\n### MAS credit notes: db_bill ${cnIds.size}, missing in HRMS ${[...cnIds].filter((i) => !hrmsCn.has(i)).length}`);

  const prov = await billQuery<RowDataPacket>(`SELECT p.id, p.cost_center, p.month, p.provision, p.provision_balance FROM provision_master p
     JOIN cost_master c ON c.cost_center = p.cost_center WHERE p.finance_year = '2026-27' AND c.company_name LIKE '%Mas Callnet%'`);
  const [hProv] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM client_provision`);
  const [hCc] = await db.query<RowDataPacket[]>(`SELECT cost_centre_code FROM cost_centre_master`);
  const ccSet = new Set(hCc.map((r) => String(r.cost_centre_code)));
  console.log(`\n### MAS provisions 2026-27: db_bill ${prov.length} rows (provision ${prov.reduce((s, r) => s + Number(r.provision || 0), 0)}, balance ${prov.reduce((s, r) => s + Number(r.provision_balance || 0), 0)}); cost centre not in HRMS: ${prov.filter((r) => !ccSet.has(String(r.cost_center))).length}; HRMS client_provision rows: ${hProv[0].n}`);
  console.table(Object.entries(prov.reduce((m: Record<string, number>, r) => { m[String(r.month)] = (m[String(r.month)] ?? 0) + 1; return m; }, {})).map(([month, n]) => ({ month, n })));

  const pay = await billQuery<RowDataPacket>(`SELECT id, financial_year, bill_no, bill_amount, tds_ded, net_amount, deduction, status, delete_status, pay_type_dates
     FROM bill_pay_particulars WHERE company_name LIKE '%Mas Callnet%'`);
  const [hBills] = await db.query<RowDataPacket[]>(`SELECT ci.bill_no FROM client_invoice ci JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
     WHERE ci.bill_no IS NOT NULL AND REPLACE(REPLACE(LOWER(cc.company_name),'.',''),' ','') LIKE '%mascallnet%'`);
  const billSet = new Set(hBills.map((r) => String(r.bill_no)));
  const fyShort = (fy: string) => { const m = /^(\d{2})(\d{2})-(\d{2})$/.exec(fy); return m ? `${m[2]}-${m[3]}` : fy; };
  const live = pay.filter((r) => Number(r.delete_status) !== 1);
  const matched = live.filter((r) => billSet.has(`${String(r.bill_no).trim()}/${fyShort(String(r.financial_year).trim())}`));
  const statuses = live.reduce((m: Record<string, number>, r) => { const k = String(r.status ?? ""); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  console.log(`\n### MAS collections (bill_pay_particulars): ${pay.length} rows, ${live.length} not deleted, ${matched.length} match an HRMS MAS bill; status values: ${JSON.stringify(statuses)}`);
  const unmatched = live.filter((r) => !matched.includes(r)).slice(0, 15).map((r) => `${r.financial_year}:${r.bill_no}`);
  console.log(`sample unmatched: ${unmatched.join(", ")}`);
  console.table(live.slice(-8).map((r) => ({ fy: r.financial_year, bill: r.bill_no, bill_amount: r.bill_amount, tds: r.tds_ded, net: r.net_amount, ded: r.deduction, status: r.status, date: r.pay_type_dates })));
}

async function main() {
  if (process.env.PROBE_ROUND === "5") return round5();
  if (process.env.PROBE_ROUND === "4") return round4();
  if (process.env.PROBE_ROUND === "3") return round3();
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
  await hrms("HRMS bill/proforma sequences", `SELECT kind, scope_key, \`last_value\`, updated_at FROM client_invoice_number_sequence ORDER BY kind, scope_key`);
  await hrms("HRMS live invoices/provisions", `SELECT (SELECT COUNT(*) FROM client_invoice WHERE is_migrated = 0) AS live_invoices,
     (SELECT COUNT(*) FROM client_provision) AS provisions, (SELECT MAX(created_at) FROM client_invoice WHERE is_migrated = 0) AS last_live`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await closeBillPool(); await db.end().catch(() => {}); });
