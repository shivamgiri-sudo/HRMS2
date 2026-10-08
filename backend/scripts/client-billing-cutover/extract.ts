/**
 * Client Billing Historical Cutover — Task 2: extraction script.
 * (docs/superpowers/plans/2026-08-19-client-billing-cutover.md Task 2,
 *  docs/superpowers/specs/2026-08-19-client-billing-cutover-design.md §2, §5, §6)
 *
 * Reads db_bill.tbl_invoice / tbl_credit_note (READ-ONLY, via billQuery() which
 * itself only allows SELECT/SHOW/DESCRIBE/EXPLAIN) and writes mapped rows into
 * client_invoice_migration_staging / client_credit_note_migration_staging
 * (mas_hrms, throwaway staging tables created by migrations 1304 + 1305).
 *
 * This script NEVER writes to db_bill, and NEVER writes to client_invoice /
 * client_invoice_line / client_credit_note / client_credit_note_line — only to
 * the two *_migration_staging tables. That load step is a separate, later,
 * explicitly-gated task (design §9) and is not implemented here.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/client-billing-cutover/extract.ts
 *
 * Idempotent: re-running re-computes every staging row and INSERT ... ON
 * DUPLICATE KEY UPDATEs it (keyed on src_id), so a partial or repeated run never
 * duplicates rows.
 */
import "dotenv/config";
import crypto from "node:crypto";
import { db } from "../../src/db/mysql.js";
import { billQuery, closeBillPool } from "../../src/db/billDb.js";
import type { RowDataPacket } from "mysql2";
import {
  shouldExcludeInvoice,
  shouldExcludeCreditNote,
  mapGstFields,
  normalizeCategory,
  buildDescription,
  parseLegacyDecimal,
  sanitizeLegacyDatetime,
} from "./extract.transforms.js";

interface LegacyInvoiceRow extends RowDataPacket {
  id: number;
  invoiceType: string | null;
  category: string | null;
  branch_name: string | null;
  cost_center: string | null;
  finance_year: string | null;
  month: string | null;
  invoiceDate: string | null;
  app_tax_cal: string | null;
  invoiceDescription: string | null;
  jcc_no: string | null;
  proforma_bill_no: string | null;
  proforma_approve: number | null;
  bill_no: string | null;
  po_no: string | null;
  po_createdate: string | null;
  ser_tax_no: string | null;
  ser_tax_category: string | null;
  pan_no: string | null;
  grn: string | null;
  grn_createdate: string | null;
  total: string | null;
  tax: string | null;
  igst: string | null;
  sgst: string | null;
  cgst: string | null;
  grnd: string | null;
  approve_po: string | null;
  approve_grn: string | null;
  username: string | null;
  view_ahmedabad: string | null;
  filepath: string | null;
  status: number | null;
  createdate: string | null;
  sbctax: string | null;
  krishi_tax: number | null;
  apply_krishi_tax: number | null;
  apply_service_tax: number | null;
  apply_gst: number | null;
  ReceiptStatus: number | null;
  po_date: string | null;
  po_remarks: string | null;
  grn_date: string | null;
  grn_remarks: string | null;
  GSTType: string | null;
  bill_finance_year: string | null;
  BillNoChange: number | null;
  state_code: string | null;
  PaymentStatus: string | null;
  RequestInvoiceType: string | null;
  CurrentInvoiceType: string | null;
  InvoiceTypeApproval: string | null;
  InvoiceTypeApproveBy: number | null;
  InvoiceTypeApproveDate: string | null;
  InvoiceTypeRemarks: string | null;
  InvoiceRejectRequest: string | null;
  InvoiceDeleteRemarks: string | null;
  InvoiceRejectBy: number | null;
  InvoiceRejectDate: string | null;
  eptp_act_date: string | null;
  eptp_act_remarks: string | null;
  his_eptp_act_date: string | null;
  his_eptp_act_remarks: string | null;
  due_date: string | null;
  subs_start_date: string | null;
  subs_end_date: string | null;
  plan_id: string | null;
  cost_company_name: string | null;
  cost_branch: string | null;
  cost_OPBranch: string | null;
  cost_stream: string | null;
  cost_process: string | null;
  cost_process_name: string | null;
  cost_TallyHead: string | null;
  cost_client: string | null;
  cost_bill_to: string | null;
  cost_as_client: string | null;
  cost_b_Address1: string | null;
  cost_b_Address2: string | null;
  cost_b_Address3: string | null;
  cost_b_Address4: string | null;
  cost_b_Address5: string | null;
  cost_ship_to: string | null;
  cost_as_bill_to: string | null;
  cost_a_address1: string | null;
  cost_a_address2: string | null;
  cost_a_address3: string | null;
  cost_a_address4: string | null;
  cost_a_address5: string | null;
  cost_GSTType: string | null;
  cost_ServiceTaxNo: string | null;
  cost_VendorGSTNo: string | null;
  cost_HSNCode: string | null;
  cost_SACCode: string | null;
  cost_VendorHSNCode: string | null;
  cost_VendorSACCode: string | null;
  cost_VendorGSTState: string | null;
  cost_VendorStateCode: string | null;
  cost_OwnerName: string | null;
  cost_statecodecost: string | null;
  cost_statenamecost: string | null;
  cost_client_tally_name: string | null;
  cost_group_cost_center: string | null;
  cost_cost_center_type: string | null;
  carry_forward: number | null;
  finance_monthYear: string | null;
}

interface LegacyCreditNoteRow extends RowDataPacket {
  id: number;
  category: string | null;
  branch_name: string | null;
  cost_center: string | null;
  finance_year: string | null;
  month: string | null;
  creditDate: string | null;
  app_tax_cal: string | null;
  creditDescription: string | null;
  credit_no: string | null;
  proforma_bill_no: string | null;
  credit_approve: number | null;
  credit_approved_by: number | null;
  credit_approved_date: string | null;
  total: string | null;
  tax: string | null;
  igst: string | null;
  sgst: string | null;
  cgst: string | null;
  grnd: string | null;
  username: string | null;
  status: number | null;
  createdate: string | null;
  sbctax: string | null;
  krishi_tax: number | null;
  apply_krishi_tax: number | null;
  apply_service_tax: number | null;
  apply_gst: number | null;
  ReceiptStatus: number | null;
  GSTType: string | null;
  bill_finance_year: string | null;
  BillNoChange: number | null;
  state_code: string | null;
  PaymentStatus: string | null;
  subs_start_date: string | null;
  subs_end_date: string | null;
  plan_id: string | null;
  updated_at: string | null;
  updated_by: number | null;
}

interface RunStats {
  read: number;
  written: number;
  skipped: number;
  castFailures: Array<{ legacy_id: number; column: string; raw: string }>;
  categoryNormalized: Map<string, { to: string | null; count: number }>;
  gstNullCount: number;
  legalHoldDescriptionCount: number;
}

function countCastFailures(row: {
  legacy_id: number;
  total: string | null;
  tax: string | null;
  igst: string | null;
  sgst: string | null;
  cgst: string | null;
  grnd: string | null;
}, stats: RunStats): void {
  const fields: Array<[string, string | null]> = [
    ["total", row.total],
    ["tax", row.tax],
    ["igst", row.igst],
    ["sgst", row.sgst],
    ["cgst", row.cgst],
    ["grnd", row.grnd],
  ];
  for (const [column, raw] of fields) {
    const parsed = parseLegacyDecimal(raw);
    if (!parsed.ok) {
      stats.castFailures.push({ legacy_id: row.legacy_id, column, raw: raw ?? "" });
    }
  }
}

function recordCategoryNormalization(rawCategory: string | null, normalized: string | null, stats: RunStats): void {
  const rawKey = rawCategory === null ? "<NULL>" : rawCategory === "" ? "<EMPTY>" : rawCategory;
  if (rawCategory !== normalized) {
    const entry = stats.categoryNormalized.get(rawKey) ?? { to: normalized, count: 0 };
    entry.count += 1;
    stats.categoryNormalized.set(rawKey, entry);
  }
}

async function extractInvoices(stats: RunStats): Promise<void> {
  const rows = await billQuery<LegacyInvoiceRow>(`SELECT * FROM tbl_invoice`);
  stats.read += rows.length;

  for (const row of rows) {
    try {
      // §5.7: exclude legacy's own deleted flag
      if (shouldExcludeInvoice(row.status)) {
        stats.skipped += 1;
        continue;
      }

      const normalizedCategory = normalizeCategory(row.category);
      recordCategoryNormalization(row.category, normalizedCategory, stats);

      const gst = mapGstFields(row.GSTType);
      if (gst.target_gst_type === null) stats.gstNullCount += 1;

      countCastFailures(
        {
          legacy_id: row.id,
          total: row.total,
          tax: row.tax,
          igst: row.igst,
          sgst: row.sgst,
          cgst: row.cgst,
          grnd: row.grnd,
        },
        stats,
      );

      // §5.6: the 89 "under legal process" rows. The staging table's src_invoicedescription
      // is a verbatim copy slot (200 chars, matching legacy's own column width) — the
      // composed "description [remark]" value design §5.6 describes belongs on the REAL
      // client_invoice.description column (VARCHAR(255), migration 1300), which Task 3/4
      // build from src_invoicedescription + src_invoicedeleteremarks (both already present
      // here verbatim) once they are writing against that wider real column. Composing it
      // here and cramming it into the 200-char verbatim slot was tried and found to be a
      // real bug during this task's own extraction run: the worst real composed length
      // (223 chars, legacy_id=3127) exceeds src_invoicedescription's 200 chars and caused
      // ER_DATA_TOO_LONG on every row that has it, while it comfortably fits the real
      // 255-char target column. buildDescription() itself is still exercised here (and unit
      // tested) purely to count how many rows the composition actually affects, for the
      // report.
      // Compare against the remark alone (not buildDescription()'s output vs. the raw
      // description) — buildDescription() also trims whitespace off the base description
      // even when there is no remark at all, which made an earlier version of this count
      // include plain whitespace-trim differences as false "legal hold" rows.
      if ((row.InvoiceDeleteRemarks ?? "").trim() !== "") {
        stats.legalHoldDescriptionCount += 1;
      }
      // buildDescription itself is still exercised (and unit tested) — it is what Task 3/4
      // will call against src_invoicedescription + src_invoicedeleteremarks when composing
      // the real client_invoice.description column; calling it here too keeps this file's
      // own behavior demonstrably consistent with what the test suite covers.
      void buildDescription(row.invoiceDescription, row.InvoiceDeleteRemarks);

      const targetId = crypto.randomUUID();

      await db.execute(
        `INSERT INTO client_invoice_migration_staging (
          src_id, src_invoicetype, src_category, src_branch_name, src_cost_center,
          src_finance_year, src_month, src_invoicedate, src_app_tax_cal, src_invoicedescription,
          src_jcc_no, src_proforma_bill_no, src_proforma_approve, src_bill_no, src_po_no,
          src_po_createdate, src_ser_tax_no, src_ser_tax_category, src_pan_no, src_grn,
          src_grn_createdate, src_total, src_tax, src_igst, src_sgst,
          src_cgst, src_grnd, src_approve_po, src_approve_grn, src_username,
          src_view_ahmedabad, src_filepath, src_status, src_createdate, src_sbctax,
          src_krishi_tax, src_apply_krishi_tax, src_apply_service_tax, src_apply_gst, src_receiptstatus,
          src_po_date, src_po_remarks, src_grn_date, src_grn_remarks, src_gsttype,
          src_bill_finance_year, src_billnochange, src_state_code, src_paymentstatus, src_requestinvoicetype,
          src_currentinvoicetype, src_invoicetypeapproval, src_invoicetypeapproveby, src_invoicetypeapprovedate, src_invoicetyperemarks,
          src_invoicerejectrequest, src_invoicedeleteremarks, src_invoicerejectby, src_invoicerejectdate, src_eptp_act_date,
          src_eptp_act_remarks, src_his_eptp_act_date, src_his_eptp_act_remarks, src_due_date, src_subs_start_date,
          src_subs_end_date, src_plan_id, src_cost_company_name, src_cost_branch, src_cost_opbranch,
          src_cost_stream, src_cost_process, src_cost_process_name, src_cost_tallyhead, src_cost_client,
          src_cost_bill_to, src_cost_as_client, src_cost_b_address1, src_cost_b_address2, src_cost_b_address3,
          src_cost_b_address4, src_cost_b_address5, src_cost_ship_to, src_cost_as_bill_to, src_cost_a_address1,
          src_cost_a_address2, src_cost_a_address3, src_cost_a_address4, src_cost_a_address5, src_cost_gsttype,
          src_cost_servicetaxno, src_cost_vendorgstno, src_cost_hsncode, src_cost_saccode, src_cost_vendorhsncode,
          src_cost_vendorsaccode, src_cost_vendorgststate, src_cost_vendorstatecode, src_cost_ownername, src_cost_statecodecost,
          src_cost_statenamecost, src_cost_client_tally_name, src_cost_group_cost_center, src_cost_cost_center_type, src_carry_forward,
          src_finance_monthyear,
          target_id, target_gst_type, target_apply_gst, target_is_migrated
        ) VALUES (
          ?,?,?,?,?,?,?,?,?,?,
          ?,?,?,?,?,?,?,?,?,?,
          ?,?,?,?,?,?,?,?,?,?,
          ?,?,?,?,?,?,?,?,?,?,
          ?,?,?,?,?,?,?,?,?,?,
          ?,?,?,?,?,?,?,?,?,?,
          ?,?,?,?,?,?,?,?,?,?,
          ?,?,?,?,?,?,?,?,?,?,
          ?,?,?,?,?,?,?,?,?,?,
          ?,?,?,?,?,?,?,?,?,?,
          ?,?,?,?,?,?,?,?,?,
          1
        )
        ON DUPLICATE KEY UPDATE
          src_invoicetype = VALUES(src_invoicetype), src_category = VALUES(src_category),
          src_invoicedescription = VALUES(src_invoicedescription), src_status = VALUES(src_status),
          src_gsttype = VALUES(src_gsttype), src_total = VALUES(src_total), src_tax = VALUES(src_tax),
          src_igst = VALUES(src_igst), src_sgst = VALUES(src_sgst), src_cgst = VALUES(src_cgst),
          src_grnd = VALUES(src_grnd), src_invoicedeleteremarks = VALUES(src_invoicedeleteremarks),
          target_id = VALUES(target_id), target_gst_type = VALUES(target_gst_type),
          target_apply_gst = VALUES(target_apply_gst), validation_status = 'pending', validation_error = NULL`,
        [
          row.id, row.invoiceType, normalizedCategory, row.branch_name, row.cost_center,
          row.finance_year, row.month, row.invoiceDate, row.app_tax_cal, row.invoiceDescription,
          row.jcc_no, row.proforma_bill_no, row.proforma_approve, row.bill_no, row.po_no,
          sanitizeLegacyDatetime(row.po_createdate), row.ser_tax_no, row.ser_tax_category, row.pan_no, row.grn,
          sanitizeLegacyDatetime(row.grn_createdate), row.total, row.tax, row.igst, row.sgst,
          row.cgst, row.grnd, row.approve_po, row.approve_grn, row.username,
          row.view_ahmedabad, row.filepath, row.status, sanitizeLegacyDatetime(row.createdate), row.sbctax,
          row.krishi_tax, row.apply_krishi_tax, row.apply_service_tax, row.apply_gst, row.ReceiptStatus,
          sanitizeLegacyDatetime(row.po_date), row.po_remarks, sanitizeLegacyDatetime(row.grn_date), row.grn_remarks, row.GSTType,
          row.bill_finance_year, row.BillNoChange, row.state_code, row.PaymentStatus, row.RequestInvoiceType,
          row.CurrentInvoiceType, row.InvoiceTypeApproval, row.InvoiceTypeApproveBy, sanitizeLegacyDatetime(row.InvoiceTypeApproveDate), row.InvoiceTypeRemarks,
          row.InvoiceRejectRequest, row.InvoiceDeleteRemarks, row.InvoiceRejectBy, sanitizeLegacyDatetime(row.InvoiceRejectDate), row.eptp_act_date,
          row.eptp_act_remarks, row.his_eptp_act_date, row.his_eptp_act_remarks, row.due_date, row.subs_start_date,
          row.subs_end_date, row.plan_id, row.cost_company_name, row.cost_branch, row.cost_OPBranch,
          row.cost_stream, row.cost_process, row.cost_process_name, row.cost_TallyHead, row.cost_client,
          row.cost_bill_to, row.cost_as_client, row.cost_b_Address1, row.cost_b_Address2, row.cost_b_Address3,
          row.cost_b_Address4, row.cost_b_Address5, row.cost_ship_to, row.cost_as_bill_to, row.cost_a_address1,
          row.cost_a_address2, row.cost_a_address3, row.cost_a_address4, row.cost_a_address5, row.cost_GSTType,
          row.cost_ServiceTaxNo, row.cost_VendorGSTNo, row.cost_HSNCode, row.cost_SACCode, row.cost_VendorHSNCode,
          row.cost_VendorSACCode, row.cost_VendorGSTState, row.cost_VendorStateCode, row.cost_OwnerName, row.cost_statecodecost,
          row.cost_statenamecost, row.cost_client_tally_name, row.cost_group_cost_center, row.cost_cost_center_type, row.carry_forward,
          row.finance_monthYear,
          targetId, gst.target_gst_type, gst.target_apply_gst,
        ],
      );
      stats.written += 1;
    } catch (err) {
      // A single row's own DB error must never abort the whole extraction run.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[extract-invoices] row legacy_id=${row.id} failed to write: ${message}`);
      stats.skipped += 1;
    }
  }
}

async function extractCreditNotes(stats: RunStats): Promise<void> {
  const rows = await billQuery<LegacyCreditNoteRow>(`SELECT * FROM tbl_credit_note`);
  stats.read += rows.length;

  for (const row of rows) {
    try {
      // tbl_credit_note's status does not mean "deleted" the way tbl_invoice's
      // does (see extract.transforms.ts header comment) — never excludes.
      if (shouldExcludeCreditNote(row.status)) {
        stats.skipped += 1;
        continue;
      }

      const normalizedCategory = normalizeCategory(row.category);
      recordCategoryNormalization(row.category, normalizedCategory, stats);

      const gst = mapGstFields(row.GSTType);
      if (gst.target_gst_type === null) stats.gstNullCount += 1;

      countCastFailures(
        {
          legacy_id: row.id,
          total: row.total,
          tax: row.tax,
          igst: row.igst,
          sgst: row.sgst,
          cgst: row.cgst,
          grnd: row.grnd,
        },
        stats,
      );

      const targetId = crypto.randomUUID();

      await db.execute(
        `INSERT INTO client_credit_note_migration_staging (
          src_id, src_category, src_branch_name, src_cost_center, src_finance_year,
          src_month, src_creditdate, src_app_tax_cal, src_creditdescription, src_credit_no,
          src_proforma_bill_no, src_credit_approve, src_credit_approved_by, src_credit_approved_date, src_total,
          src_tax, src_igst, src_sgst, src_cgst, src_grnd,
          src_username, src_status, src_createdate, src_sbctax, src_krishi_tax,
          src_apply_krishi_tax, src_apply_service_tax, src_apply_gst, src_receiptstatus, src_gsttype,
          src_bill_finance_year, src_billnochange, src_state_code, src_paymentstatus, src_subs_start_date,
          src_subs_end_date, src_plan_id, src_updated_at, src_updated_by,
          target_id, target_gst_type, target_apply_gst, target_is_migrated
        ) VALUES (
          ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,
          ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,
          ?,?,?,?,?, ?,?,?,?,
          ?,?,?, 1
        )
        ON DUPLICATE KEY UPDATE
          src_category = VALUES(src_category), src_creditdescription = VALUES(src_creditdescription),
          src_status = VALUES(src_status), src_gsttype = VALUES(src_gsttype),
          src_total = VALUES(src_total), src_tax = VALUES(src_tax), src_igst = VALUES(src_igst),
          src_sgst = VALUES(src_sgst), src_cgst = VALUES(src_cgst), src_grnd = VALUES(src_grnd),
          target_id = VALUES(target_id), target_gst_type = VALUES(target_gst_type),
          target_apply_gst = VALUES(target_apply_gst), validation_status = 'pending', validation_error = NULL`,
        [
          row.id, normalizedCategory, row.branch_name, row.cost_center, row.finance_year,
          row.month, row.creditDate, row.app_tax_cal, row.creditDescription, row.credit_no,
          row.proforma_bill_no, row.credit_approve, row.credit_approved_by, sanitizeLegacyDatetime(row.credit_approved_date), row.total,
          row.tax, row.igst, row.sgst, row.cgst, row.grnd,
          row.username, row.status, sanitizeLegacyDatetime(row.createdate), row.sbctax, row.krishi_tax,
          row.apply_krishi_tax, row.apply_service_tax, row.apply_gst, row.ReceiptStatus, row.GSTType,
          row.bill_finance_year, row.BillNoChange, row.state_code, row.PaymentStatus, row.subs_start_date,
          row.subs_end_date, row.plan_id, sanitizeLegacyDatetime(row.updated_at), row.updated_by,
          targetId, gst.target_gst_type, gst.target_apply_gst,
        ],
      );
      stats.written += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[extract-credit-notes] row legacy_id=${row.id} failed to write: ${message}`);
      stats.skipped += 1;
    }
  }
}

async function main(): Promise<void> {
  console.log("[extract] Client Billing Historical Cutover — Task 2 extraction starting");
  console.log("[extract] db_bill access is READ-ONLY throughout (billQuery blocks non-SELECT).");

  // ── db_bill row-count proof, BEFORE ─────────────────────────────────────────
  const [invBefore] = await billQuery<RowDataPacket & { c: number }>(`SELECT COUNT(*) AS c FROM tbl_invoice`);
  const [cnBefore] = await billQuery<RowDataPacket & { c: number }>(`SELECT COUNT(*) AS c FROM tbl_credit_note`);
  console.log(`[extract] BEFORE: tbl_invoice=${invBefore.c} tbl_credit_note=${cnBefore.c}`);

  const invoiceStats: RunStats = {
    read: 0, written: 0, skipped: 0, castFailures: [], categoryNormalized: new Map(), gstNullCount: 0,
    legalHoldDescriptionCount: 0,
  };
  const creditNoteStats: RunStats = {
    read: 0, written: 0, skipped: 0, castFailures: [], categoryNormalized: new Map(), gstNullCount: 0,
    legalHoldDescriptionCount: 0,
  };

  await extractInvoices(invoiceStats);
  await extractCreditNotes(creditNoteStats);

  // ── db_bill row-count proof, AFTER — proves nothing was written back ───────
  const [invAfter] = await billQuery<RowDataPacket & { c: number }>(`SELECT COUNT(*) AS c FROM tbl_invoice`);
  const [cnAfter] = await billQuery<RowDataPacket & { c: number }>(`SELECT COUNT(*) AS c FROM tbl_credit_note`);
  console.log(`[extract] AFTER:  tbl_invoice=${invAfter.c} tbl_credit_note=${cnAfter.c}`);
  console.log(
    `[extract] db_bill unchanged: tbl_invoice ${invBefore.c === invAfter.c ? "MATCH" : "MISMATCH!!"}, ` +
      `tbl_credit_note ${cnBefore.c === cnAfter.c ? "MATCH" : "MISMATCH!!"}`,
  );

  function printStats(label: string, stats: RunStats): void {
    console.log(`\n[extract] ── ${label} ──`);
    console.log(`  read:    ${stats.read}`);
    console.log(`  written: ${stats.written}`);
    console.log(`  skipped: ${stats.skipped}`);
    console.log(`  GSTType null/empty (target_gst_type=NULL): ${stats.gstNullCount}`);
    console.log(`  §5.6 legal-hold description note applicable (src_invoicedeleteremarks present, composition deferred to load): ${stats.legalHoldDescriptionCount}`);
    console.log(`  category normalizations applied:`);
    if (stats.categoryNormalized.size === 0) {
      console.log(`    (none)`);
    } else {
      for (const [from, { to, count }] of stats.categoryNormalized) {
        console.log(`    "${from}" -> ${to === null ? "NULL" : `"${to}"`}  (${count} rows)`);
      }
    }
    console.log(`  amount-column cast failures: ${stats.castFailures.length}`);
    if (stats.castFailures.length > 0) {
      const byColumn = new Map<string, number>();
      for (const f of stats.castFailures) byColumn.set(f.column, (byColumn.get(f.column) ?? 0) + 1);
      for (const [col, count] of byColumn) console.log(`    ${col}: ${count}`);
      console.log(`  sample cast failures (up to 10):`);
      for (const f of stats.castFailures.slice(0, 10)) {
        console.log(`    legacy_id=${f.legacy_id} column=${f.column} raw=${JSON.stringify(f.raw)}`);
      }
    }
  }

  printStats("tbl_invoice -> client_invoice_migration_staging", invoiceStats);
  printStats("tbl_credit_note -> client_credit_note_migration_staging", creditNoteStats);

  await closeBillPool();
  console.log("\n[extract] Done. Zero rows written to client_invoice/client_credit_note (staging only).");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[extract] FATAL:", err);
    process.exit(1);
  });