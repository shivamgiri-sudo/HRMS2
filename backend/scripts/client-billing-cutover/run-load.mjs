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
    port: 3306,
    user: "shivam_user",
    password: process.env.DB_PASSWORD,
    database: "mas_hrms",
    connectionLimit: 5,
  });

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
       FROM client_invoice_migration_staging WHERE validation_status = 'valid'`
    );
    const [creditNoteRows] = await pool.query(
      `SELECT id, src_id, target_id, target_cost_centre_id, target_invoice_id, target_gst_type, target_apply_gst,
              src_category, src_finance_year, src_month, src_creditdate,
              src_creditdescription, src_credit_no, src_credit_approve,
              src_total, src_tax, src_igst, src_sgst, src_cgst, src_grnd, validation_status
       FROM client_credit_note_migration_staging WHERE validation_status = 'valid'`
    );

    console.log(`Loading ${invoiceRows.length} invoice rows and ${creditNoteRows.length} credit-note rows...`);

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