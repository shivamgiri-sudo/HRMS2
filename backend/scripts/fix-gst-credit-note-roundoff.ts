/**
 * Credit-note rows in the live GST export batches that carry the round-off with the wrong sign
 * (fixed in the staging code; this repairs the batches already generated). Dry run by default.
 * Only rows where flipping the round-off makes invoice value = taxable + taxes are touched.
 *
 *   npx tsx scripts/fix-gst-credit-note-roundoff.ts [--apply]
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const APPLY = process.argv.includes("--apply");
const SUM = "(taxable_value + igst_amount + cgst_amount + sgst_amount + COALESCE(other_charges,0))";

async function main() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT r.id, b.export_type, b.period_month, r.bill_no, r.round_off_amount, r.invoice_value, ${SUM} AS base
       FROM gst_export_row r JOIN gst_export_batch b ON b.id = r.batch_id AND b.status <> 'superseded'
      WHERE r.source_type = 'credit_note'
        AND ABS(r.invoice_value - (${SUM} + COALESCE(r.round_off_amount,0))) > 1.01
        AND ABS(r.invoice_value - (${SUM} - COALESCE(r.round_off_amount,0))) <= 1.01`);
  console.log(`${APPLY ? "APPLY" : "DRY RUN"}: ${(rows as any[]).length} credit-note row(s) with a flipped round-off`);
  console.table(rows);
  if (!APPLY || !(rows as any[]).length) { if (!APPLY) console.log("No changes written. Re-run with --apply."); return; }
  let n = 0;
  for (const r of rows as any[]) {
    const [res] = await db.execute<any>(`UPDATE gst_export_row SET round_off_amount = -round_off_amount WHERE id = ?`, [r.id]);
    n += Number(res.affectedRows);
  }
  console.log(`flipped ${n} row(s)`);
}
main().then(() => db.end?.()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end?.(); } catch { } process.exit(1); });
