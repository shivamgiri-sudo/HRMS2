/** Where GRN status, payment records and the legacy-import guard stand. STRICTLY READ-ONLY. */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
const q = async (label: string, sql: string, params: unknown[] = []) => { try { const [r] = await db.execute<RowDataPacket[]>(sql, params); console.log(`\n## ${label}`); console.table(r); } catch (e: any) { console.log(`\n## ${label}\nSKIPPED: ${e.message}`); } };
async function main() {
  await q("migrations 1968-1973 recorded", `SELECT filename, success, applied_at FROM schema_migrations WHERE filename REGEXP '^19(6[89]|7[0-9])_' ORDER BY filename`);
  await q("unique key on grn_request.bill_source_id", `SELECT index_name, non_unique FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'grn_request' AND column_name = 'bill_source_id'`);
  await q("duplicate bill_source_id rows (must be 0 for the key)", `SELECT COUNT(*) dup_groups FROM (SELECT bill_source_id FROM grn_request WHERE bill_source_id IS NOT NULL GROUP BY bill_source_id HAVING COUNT(*) > 1) d`);
  await q("GRN status vs payment record (vendor GRNs with a tracking row)",
    `SELECT g.status grn_status, t.payment_status trk_status, COUNT(*) n, ROUND(SUM(t.due_amount),2) due, ROUND(SUM(t.balance_amount),2) balance
       FROM grn_request g JOIN vendor_payment_tracking t ON t.grn_request_id = g.id WHERE g.grn_type='vendor'
        AND ((g.status='paid' AND t.payment_status <> 'Paid') OR (g.status <> 'paid' AND t.payment_status = 'Paid'))
      GROUP BY g.status, t.payment_status ORDER BY n DESC LIMIT 15`);
  await q("tracking rows showing Paid with no payment transaction",
    `SELECT COUNT(*) n, ROUND(SUM(t.due_amount),2) amount FROM vendor_payment_tracking t WHERE t.payment_status='Paid' AND NOT EXISTS (SELECT 1 FROM vendor_payment_transaction x WHERE x.vendor_payment_id = t.id)`);
  await q("fix log (LEGACY_FALSE_PAID_FIX) by action", `SELECT JSON_UNQUOTE(JSON_EXTRACT(change_summary,'$.action')) action, COUNT(*) n, MIN(acted_at) first_, MAX(acted_at) last_ FROM sensitive_action_log WHERE action_type='LEGACY_FALSE_PAID_FIX' GROUP BY action`);
}
main().then(() => db.end?.()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end?.(); } catch { } process.exit(1); });
