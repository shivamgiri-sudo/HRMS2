/**
 * Align the month of db_bill-migrated GRNs across the three tables the P&L reads.
 * vendor_payment_tracking.recognition_period was backfilled from the db_bill finance month (grn_entry_snapshot.period_code).
 * grn_request.recognition_period and grn_cost_allocation.recognition_period are still NULL for migrated GRNs, so the P&L
 * allocation view dates them by bill date: a bill is removed from one month (legacy subtraction, finance month) and added to
 * another (allocation view, bill month). Measured Apr 2026: 12 lakh lost from April.
 *
 * Writes (apply only): recognition_period on grn_request and grn_cost_allocation where it IS NULL, for GRNs imported from
 * db_bill (bill_source_id set) with a valid snapshot period. Revert = set those columns back to NULL for the same rows.
 *
 *   npx tsx scripts/backfill-grn-recognition-period.ts            # dry-run (default)
 *   npx tsx scripts/backfill-grn-recognition-period.ts --apply
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

const APPLY = process.argv.includes("--apply");
const SNAP = `(SELECT grn_no COLLATE utf8mb4_unicode_ci AS grn_no, MAX(period_code) AS period_code FROM grn_entry_snapshot
               WHERE COALESCE(is_rejected,0) = 0 AND period_code REGEXP '^[0-9]{4}-[0-9]{2}$' GROUP BY grn_no)`;
const q = async (sql: string) => (await db.execute<RowDataPacket[]>(sql))[0];

(async () => {
  const st = await q(`SELECT COUNT(*) n, SUM(recognition_period IS NULL) null_rp, SUM(bill_source_id IS NOT NULL) from_dbbill FROM grn_request`);
  console.log("GR_STATE " + JSON.stringify(st[0]));
  const shiftReq = await q(`
    SELECT DATE_FORMAT(COALESCE(g.service_period_end, g.bill_date, g.reviewed_at, g.created_at), '%Y-%m') bill_month, s.period_code finance_month, COUNT(*) n,
           ROUND(SUM(COALESCE(g.amount_without_tax, g.amount, 0))) ex_gst
      FROM grn_request g JOIN ${SNAP} s ON s.grn_no = g.grn_number COLLATE utf8mb4_unicode_ci
     WHERE g.recognition_period IS NULL AND g.bill_source_id IS NOT NULL
     GROUP BY bill_month, finance_month HAVING bill_month <> finance_month AND (bill_month BETWEEN '2026-03' AND '2026-10' OR finance_month BETWEEN '2026-03' AND '2026-10')`);
  for (const r of shiftReq) console.log("GR_SHIFT " + JSON.stringify(r));
  const al = await q(`SELECT COUNT(*) n, SUM(a.recognition_period IS NULL) null_rp, ROUND(SUM(CASE WHEN a.lifecycle_status='consumed' THEN COALESCE(a.amount_without_tax,0) ELSE 0 END)) consumed_ex_gst
      FROM grn_cost_allocation a JOIN grn_request g ON g.id = a.grn_request_id WHERE g.bill_source_id IS NOT NULL`);
  console.log("GA_STATE " + JSON.stringify(al[0]));
  const shiftAl = await q(`
    SELECT DATE_FORMAT(COALESCE(g.service_period_end, g.bill_date, g.reviewed_at, g.created_at), '%Y-%m') bill_month, s.period_code finance_month, a.lifecycle_status lc, COUNT(*) n,
           ROUND(SUM(COALESCE(a.amount_without_tax,0))) ex_gst
      FROM grn_cost_allocation a JOIN grn_request g ON g.id = a.grn_request_id JOIN ${SNAP} s ON s.grn_no = g.grn_number COLLATE utf8mb4_unicode_ci
     WHERE a.recognition_period IS NULL AND g.bill_source_id IS NOT NULL
     GROUP BY bill_month, finance_month, lc HAVING bill_month <> finance_month AND (bill_month BETWEEN '2026-03' AND '2026-10' OR finance_month BETWEEN '2026-03' AND '2026-10')`);
  for (const r of shiftAl) console.log("GA_SHIFT " + JSON.stringify(r));
  if (!APPLY) { console.log("GR_MODE dry-run: nothing written"); process.exit(0); }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [a1] = await conn.execute<ResultSetHeader>(`UPDATE grn_cost_allocation a JOIN grn_request g ON g.id = a.grn_request_id JOIN ${SNAP} s ON s.grn_no = g.grn_number COLLATE utf8mb4_unicode_ci
        SET a.recognition_period = s.period_code WHERE a.recognition_period IS NULL AND g.bill_source_id IS NOT NULL`);
    const [a2] = await conn.execute<ResultSetHeader>(`UPDATE grn_request g JOIN ${SNAP} s ON s.grn_no = g.grn_number COLLATE utf8mb4_unicode_ci
        SET g.recognition_period = s.period_code WHERE g.recognition_period IS NULL AND g.bill_source_id IS NOT NULL`);
    await conn.commit();
    console.log("GR_APPLIED " + JSON.stringify({ grn_cost_allocation: a1.affectedRows, grn_request: a2.affectedRows }));
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  process.exit(0);
})().catch((e) => { console.error("GR_ERROR", e instanceof Error ? e.message : e); process.exit(1); });
