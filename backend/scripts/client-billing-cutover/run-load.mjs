/**
 * Client Billing Historical Cutover — Task 4 RUNNER.
 *
 * THIS IS THE ONE SCRIPT THAT ACTUALLY WRITES ~10,848 REAL HISTORICAL FINANCIAL
 * RECORDS INTO PRODUCTION (client_invoice / client_invoice_line /
 * client_credit_note / client_credit_note_line). Everything upstream of this
 * (schema, extraction, validation, addendum fixes — commits 203749cd, 9a8a9da0,
 * 2991f669, 90b15942, ad8be504, 4cfb4477) was written and tested WITHOUT ever
 * touching those four tables. This script is the human-authorized follow-up
 * load.ts's own header comment requires — run it only with that authorization
 * already in hand (it was: the user explicitly said "run" in the session that
 * built this, 2026-08-19).
 *
 * Run from `backend/`:
 *   node --experimental-strip-types scripts/client-billing-cutover/run-load.mjs
 * (or `npx tsx scripts/client-billing-cutover/run-load.mjs` if that's this
 * repo's more usual way of running a one-off TS script — check package.json's
 * own scripts for the established convention before assuming either works.)
 *
 * What it does, in order:
 *   1. Connects to the real `mas_hrms` pool (same `db` export the whole backend
 *      already uses — src/db/mysql.ts — so this honors the exact same pool
 *      config/limits as the running app, not a throwaway connection).
 *   2. Picks a real `created_by` actor: the first `auth_user` row with
 *      role = 'super_admin', ordered by `id` for determinism. Prints which one
 *      it picked before doing anything else — abort (Ctrl+C) if that's wrong.
 *   3. Loads every `validation_status = 'valid'` row from both staging tables
 *      (10,709 invoices, 139 credit notes as of this session — re-verify the
 *      real count printed at runtime, don't trust this comment if it's stale).
 *   4. Calls `loadValidatedRows` (backend/scripts/client-billing-cutover/load.ts)
 *      — one transaction per legacy row, idempotent (safe to re-run).
 *   5. Prints a full summary: loaded / already_loaded / failed counts for both
 *      tables, and every individual failure with its legacy id and error
 *      message (there should be none, given the validation pass already
 *      excluded every row that would fail — but this is real production data,
 *      so report reality, don't assume the summary is empty).
 *   6. Re-queries `client_invoice`/`client_credit_note` row counts after
 *      loading and prints them, so the operator has real proof of what
 *      actually landed, not just the script's own self-report.
 */
import mysql from "mysql2/promise";
import "dotenv/config";
import { loadValidatedRows } from "./load.ts";

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || "192.168.10.6",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "shivam_user",
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "mas_hrms",
    connectionLimit: 5,
  });
  // LOAD_ONLY_MAS=1: only MAS Callnet India Pvt Ltd rows not loaded yet (2026-10 top-up).
  const onlyMas = process.env.LOAD_ONLY_MAS === "1";
  const masInvoiceFilter = onlyMas
    ? ` AND src_cost_company_name LIKE '%Mas Callnet%' AND NOT EXISTS (SELECT 1 FROM client_invoice ci WHERE ci.legacy_id = s.src_id)`
    : "";
  const masCreditFilter = onlyMas
    ? ` AND NOT EXISTS (SELECT 1 FROM client_credit_note cn WHERE cn.legacy_id = s.src_id)
        AND (EXISTS (SELECT 1 FROM client_invoice_migration_staging si WHERE si.target_id = s.target_invoice_id AND si.src_cost_company_name LIKE '%Mas Callnet%')
             OR EXISTS (SELECT 1 FROM client_invoice ci JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
                        WHERE ci.id = s.target_invoice_id AND REPLACE(REPLACE(LOWER(cc.company_name),'.',''),' ','') LIKE '%mascallnet%'))`
    : "";
  console.log(`Scope: ${onlyMas ? "MAS Callnet only, rows not yet loaded" : "all valid staged rows"}; MODE=${process.env.MODE || "apply"}`);

  const loadDb = { getConnection: () => pool.getConnection() };

  try {
    const [[actorRow]] = await pool.query(
      `SELECT au.id, au.email
       FROM auth_user au
       JOIN user_roles ur ON ur.user_id = au.id
       WHERE ur.role_key = 'super_admin' AND ur.active_status = 1 AND au.is_blocked = 0
       ORDER BY au.id LIMIT 1`
    );
    if (!actorRow) {
      throw new Error("No super_admin auth_user row found to attribute migrated records to — resolve manually.");
    }
    console.log(`Attributing migrated rows to created_by = ${actorRow.id} (${actorRow.email}). Ctrl+C now if wrong.`);

    const [invoiceRows] = await pool.query(
      `SELECT id, src_id, target_id, target_cost_centre_id, target_gst_type, target_apply_gst,
              src_category, src_finance_year, src_month, src_invoicedate,
              src_invoicedescription, src_invoicedeleteremarks, src_proforma_bill_no, src_bill_no,
              src_total, src_tax, src_igst, src_sgst, src_cgst, src_grnd, validation_status
       FROM client_invoice_migration_staging s WHERE validation_status = 'valid'${masInvoiceFilter}`
    );
    const [creditNoteRows] = await pool.query(
      `SELECT id, src_id, target_id, target_cost_centre_id, target_invoice_id, target_gst_type, target_apply_gst,
              src_category, src_finance_year, src_month, src_creditdate,
              src_creditdescription, src_credit_no, src_credit_approve,
              src_total, src_tax, src_igst, src_sgst, src_cgst, src_grnd, validation_status
       FROM client_credit_note_migration_staging s WHERE validation_status = 'valid'${masCreditFilter}`
    );

    console.log(`Loading ${invoiceRows.length} invoice rows and ${creditNoteRows.length} credit-note rows...`);
    for (const r of invoiceRows.slice(0, 200)) console.log(`  invoice legacy ${r.src_id}: ${r.src_bill_no || r.src_proforma_bill_no} grand ${r.src_grnd}`);
    for (const r of creditNoteRows) console.log(`  credit note legacy ${r.src_id}: ${r.src_credit_no} grand ${r.src_grnd}`);
    if (onlyMas) {
      const [errs] = await pool.query(
        `SELECT src_id, src_bill_no, validation_error FROM client_invoice_migration_staging s
         WHERE validation_status = 'error' AND src_cost_company_name LIKE '%Mas Callnet%'
           AND NOT EXISTS (SELECT 1 FROM client_invoice ci WHERE ci.legacy_id = s.src_id) AND src_finance_year >= '2025-26'`);
      console.log(`MAS rows staged but NOT valid (not loaded): ${errs.length}`);
      for (const e of errs) console.log(`  legacy ${e.src_id} ${e.src_bill_no}: ${e.validation_error}`);
    }
    // A legacy bill / credit note whose NUMBER is already used by a different HRMS row would create a
    // duplicate document number (HRMS minted its own bills before the counters were synced). legacy_id
    // only guards re-loading the same row, so check numbers too and refuse to load if any collide.
    const billNos = invoiceRows.map((r) => r.src_bill_no).filter(Boolean);
    const creditNos = creditNoteRows.map((r) => r.src_credit_no).filter(Boolean);
    const [billHits] = billNos.length
      ? await pool.query(
          `SELECT bill_no, id, invoice_status, is_migrated, legacy_id FROM client_invoice WHERE bill_no IN (?)`, [billNos])
      : [[]];
    const [creditHits] = creditNos.length
      ? await pool.query(
          `SELECT credit_no, id, credit_status, legacy_id FROM client_credit_note WHERE credit_no IN (?)`, [creditNos])
      : [[]];
    console.log(`Number collisions with rows already in HRMS: bills=${billHits.length} credit notes=${creditHits.length}`);
    for (const h of billHits) console.log(`  COLLISION bill ${h.bill_no}: HRMS invoice ${h.id} status=${h.invoice_status} migrated=${h.is_migrated} legacy_id=${h.legacy_id ?? "-"}`);
    for (const h of creditHits) console.log(`  COLLISION credit note ${h.credit_no}: HRMS ${h.id} status=${h.credit_status} legacy_id=${h.legacy_id ?? "-"}`);
    if ((process.env.MODE || "apply") !== "apply") { console.log("Dry run: nothing loaded."); return; }
    if (billHits.length || creditHits.length) {
      throw new Error("Refusing to load: document numbers above already exist in HRMS. Resolve them first (nothing was written).");
    }

    const stats = await loadValidatedRows(
      loadDb,
      { invoiceRows, creditNoteRows },
      { createdBy: actorRow.id }
    );

    const summarize = (label, results) => {
      const loaded = results.filter((r) => r.outcome === "loaded").length;
      const already = results.filter((r) => r.outcome === "already_loaded").length;
      const failed = results.filter((r) => r.outcome === "failed");
      console.log(`${label}: loaded=${loaded} already_loaded=${already} failed=${failed.length}`);
      for (const f of failed) {
        console.log(`  FAILED legacy_id=${f.legacyId}: ${f.error}`);
      }
    };
    summarize("Invoices", stats.invoices);
    summarize("Credit notes", stats.creditNotes);

    const [[invCount]] = await pool.query("SELECT COUNT(*) c FROM client_invoice");
    const [[cnCount]] = await pool.query("SELECT COUNT(*) c FROM client_credit_note");
    const [[invLineCount]] = await pool.query("SELECT COUNT(*) c FROM client_invoice_line");
    const [[cnLineCount]] = await pool.query("SELECT COUNT(*) c FROM client_credit_note_line");
    console.log("Post-load real counts:", {
      client_invoice: invCount.c,
      client_invoice_line: invLineCount.c,
      client_credit_note: cnCount.c,
      client_credit_note_line: cnLineCount.c,
    });
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});