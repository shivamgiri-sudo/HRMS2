/**
 * Backfill vendor_payment_tracking.recognition_period for db_bill-migrated bills.
 *
 * WHY: recognition_period is NULL on every migrated row, so the P&L recognises a bill in the month it
 * fell DUE instead of the month it belongs to (db_bill FinanceMonth). Measured Apr-Sep 2026: only 63% of
 * the value sat in the right month; ~15 lakh a month slid one month late. Every P&L reader already
 * prefers recognition_period when it is set.
 *
 * WHAT IT WRITES (apply only): vendor_payment_tracking.recognition_period = grn_entry_snapshot.period_code,
 * for rows where it IS NULL, bill_source_id IS NOT NULL and the snapshot (db_bill expense mirror, joined on
 * grn_number) has a valid YYYY-MM period and is not rejected. Nothing else. Revert = set recognition_period
 * back to NULL for those rows (they were all NULL before): the apply run prints the id range and the count.
 *
 *   npx tsx scripts/backfill-vendor-recognition-period.ts            # dry-run (default): reports, writes nothing
 *   npx tsx scripts/backfill-vendor-recognition-period.ts --apply    # writes
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

const APPLY = process.argv.includes("--apply");
const JOIN = `
  FROM vendor_payment_tracking vpt
  JOIN (SELECT grn_no COLLATE utf8mb4_unicode_ci AS grn_no, MAX(period_code) AS period_code
          FROM grn_entry_snapshot WHERE COALESCE(is_rejected, 0) = 0 AND period_code REGEXP '^[0-9]{4}-[0-9]{2}$'
         GROUP BY grn_no) s ON s.grn_no = vpt.grn_number COLLATE utf8mb4_unicode_ci
 WHERE vpt.recognition_period IS NULL AND vpt.bill_source_id IS NOT NULL`;
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];

(async () => {
  const [tot] = await q(`SELECT COUNT(*) n, SUM(recognition_period IS NULL) null_rp, SUM(bill_source_id IS NOT NULL) from_dbbill FROM vendor_payment_tracking`);
  console.log("VP_STATE " + JSON.stringify(tot));
  const [m] = await q(`SELECT COUNT(*) n, SUM(COALESCE(vpt.amount_without_tax, vpt.due_amount, 0)) ex_gst ${JOIN}`);
  console.log("VP_MATCHABLE " + JSON.stringify(m));
  const shift = await q(`
    SELECT DATE_FORMAT(COALESCE(vpt.due_date, vpt.payment_date, vpt.created_at), '%Y-%m') current_month, s.period_code new_month,
           COUNT(*) n, ROUND(SUM(COALESCE(vpt.amount_without_tax, vpt.due_amount, 0))) ex_gst ${JOIN}
     GROUP BY current_month, new_month HAVING current_month BETWEEN '2026-03' AND '2026-10' OR new_month BETWEEN '2026-03' AND '2026-10'`);
  for (const r of shift) console.log("VP_SHIFT " + JSON.stringify(r));
  const [unm] = await q(`SELECT COUNT(*) n FROM vendor_payment_tracking vpt WHERE vpt.recognition_period IS NULL AND vpt.bill_source_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM grn_entry_snapshot s WHERE s.grn_no COLLATE utf8mb4_unicode_ci = vpt.grn_number COLLATE utf8mb4_unicode_ci)`);
  console.log("VP_UNMATCHED_STAY_NULL " + JSON.stringify(unm));
  if (!APPLY) { console.log("VP_MODE dry-run: nothing written"); process.exit(0); }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [res] = await conn.execute<ResultSetHeader>(
      `UPDATE vendor_payment_tracking vpt
         JOIN (SELECT grn_no COLLATE utf8mb4_unicode_ci AS grn_no, MAX(period_code) AS period_code
                 FROM grn_entry_snapshot WHERE COALESCE(is_rejected, 0) = 0 AND period_code REGEXP '^[0-9]{4}-[0-9]{2}$'
                GROUP BY grn_no) s ON s.grn_no = vpt.grn_number COLLATE utf8mb4_unicode_ci
          SET vpt.recognition_period = s.period_code
        WHERE vpt.recognition_period IS NULL AND vpt.bill_source_id IS NOT NULL`);
    await conn.commit();
    console.log("VP_APPLIED " + JSON.stringify({ affectedRows: res.affectedRows, changedRows: res.changedRows }));
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  const [after] = await q(`SELECT COUNT(*) n, SUM(recognition_period IS NULL) null_rp FROM vendor_payment_tracking`);
  console.log("VP_AFTER " + JSON.stringify(after));
  process.exit(0);
})().catch((e) => { console.error("VP_ERROR", e instanceof Error ? e.message : e); process.exit(1); });
