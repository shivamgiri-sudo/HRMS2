/**
 * Client Billing — ongoing db_bill sync (post-cutover).
 *
 * The one-time historical cutover (extract.ts -> validate.ts -> run-load.mjs, 2026-08-19) loaded
 * every db_bill.tbl_invoice/tbl_credit_note row that existed at the time into client_invoice/
 * client_credit_note. Nothing kept running it, so client_invoice became a frozen snapshot while
 * db_bill/I-Spark stayed the system finance actually invoices in day to day. Confirmed live
 * 2026-09-02: 19 invoices (~Rs 60.78L) raised in db_bill between the cutover and today were never
 * carried into client_invoice, and the GST/Tally export (gst-export.service.ts) reads
 * client_invoice, not db_bill — so every day this went un-synced was a day the export silently
 * fell further behind what was actually invoiced.
 *
 * This is that same three-stage pipeline, unchanged, run as a chain instead of once:
 *   1. extract.ts  — db_bill (read-only) -> client_invoice_migration_staging /
 *                    client_credit_note_migration_staging (upsert keyed on src_id)
 *   2. validate.ts — re-validates every staging row against the live schema, applies the
 *                    A1-A4 addendum decisions (GST type, category default, cost-centre
 *                    resolution, credit-note<->invoice matching)
 *   3. run-load.mjs — loadValidatedRows() upserts every validation_status='valid' staging row
 *                    into client_invoice/client_invoice_line/client_credit_note/
 *                    client_credit_note_line, keyed on legacy_id (ON DUPLICATE KEY UPDATE)
 *
 * Idempotent end to end, same as the worker that already runs this pattern daily for the
 * billing_invoice_snapshot/P&L mirror (db-bill-finance-sync.worker.ts / sync-db-bill-snapshot.mjs)
 * — re-running against unchanged data changes nothing; a new or edited db_bill row is picked up
 * on the next run. Never writes to db_bill.
 *
 * Usage:
 *   cd backend && node scripts/client-billing-cutover/sync-ongoing.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../..");
const TSX = path.resolve(BACKEND_ROOT, "node_modules/.bin/tsx");

function run(label, cmd, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n=== [sync-ongoing] ${label} ===`);
    const child = spawn(cmd, args, { cwd: BACKEND_ROOT, env: process.env, stdio: "inherit" });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

async function main() {
  const started = Date.now();
  await run("1/3 extract (db_bill -> staging)", TSX, ["scripts/client-billing-cutover/extract.ts"]);
  await run("2/3 validate (staging + addendum decisions)", TSX, ["scripts/client-billing-cutover/validate.ts"]);
  // run-load.mjs's own docstring offers --experimental-strip-types as an alternative to tsx —
  // that flag needs Node 22+; this fleet runs Node 20 (confirmed live), so tsx is the only one
  // of the two that actually works here.
  await run("3/3 load (staging -> client_invoice/client_credit_note)", TSX, [
    "scripts/client-billing-cutover/run-load.mjs",
  ]);
  console.log(`\n[sync-ongoing] Done in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
}

main().catch((err) => {
  console.error("[sync-ongoing] FATAL:", err.message);
  process.exit(1);
});
