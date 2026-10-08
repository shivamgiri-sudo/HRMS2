/** What is odd about the vendor GRNs that have no journal entry. STRICTLY READ-ONLY. npx tsx scripts/unposted-grn-forensics.ts */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const q = async (label: string, sql: string, params: unknown[] = []) => {
  try { const [rows] = await db.execute<RowDataPacket[]>(sql, params); console.log(`\n## ${label}`); console.table(rows); }
  catch (e: any) { console.log(`\n## ${label}\nSKIPPED: ${e.message}`); }
};
const U = `g.grn_type = 'vendor' AND g.status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
  AND NOT EXISTS (SELECT 1 FROM journal_entry je WHERE je.source_type='grn' AND je.source_id = g.id)`;
const AMT = `COALESCE(NULLIF(g.amount_with_tax,0), g.amount)`;

async function main() {
  await q("by month created", `SELECT DATE_FORMAT(g.created_at,'%Y-%m') ym, COUNT(*) n, ROUND(SUM(${AMT}),2) amount FROM grn_request g WHERE ${U} GROUP BY ym ORDER BY ym DESC LIMIT 18`);
  await q("by who created it", `SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', e.first_name, e.last_name)),''), g.legacy_raised_by_name, g.created_by) creator, COUNT(*) n, ROUND(SUM(${AMT}),2) amount
      FROM grn_request g LEFT JOIN (SELECT user_id, MIN(first_name) first_name, MIN(last_name) last_name FROM employees WHERE user_id IS NOT NULL GROUP BY user_id) e ON e.user_id = g.created_by
      WHERE ${U} GROUP BY creator ORDER BY amount DESC LIMIT 12`);
  await q("zero / null amounts", `SELECT SUM(${AMT} = 0 OR ${AMT} IS NULL) zero_amount, SUM(${AMT} > 0) positive, SUM(${AMT} < 0) negative FROM grn_request g WHERE ${U}`);
  await q("duplicates: same vendor + invoice + amount as another GRN (journaled or not)",
    `SELECT COUNT(*) unposted_with_a_twin, ROUND(SUM(${AMT}),2) amount FROM grn_request g
      WHERE ${U} AND g.invoice_number IS NOT NULL AND g.invoice_number <> ''
        AND EXISTS (SELECT 1 FROM grn_request o WHERE o.id <> g.id AND o.vendor_id = g.vendor_id AND o.invoice_number = g.invoice_number AND ABS(COALESCE(NULLIF(o.amount_with_tax,0), o.amount) - ${AMT}) < 1)`);
  await q("duplicates: same vendor + amount + bill date as another GRN (no invoice number needed)",
    `SELECT COUNT(*) unposted_with_a_twin, ROUND(SUM(${AMT}),2) amount FROM grn_request g
      WHERE ${U} AND ${AMT} > 0 AND EXISTS (SELECT 1 FROM grn_request o WHERE o.id <> g.id AND o.vendor_id = g.vendor_id AND o.bill_date = g.bill_date AND ABS(COALESCE(NULLIF(o.amount_with_tax,0), o.amount) - ${AMT}) < 1)`);
  await q("paid-status GRNs with no payment record anywhere (no tracking row, no vendor)",
    `SELECT g.status, SUM(NOT EXISTS (SELECT 1 FROM vendor_payment_tracking t WHERE t.grn_request_id = g.id)) no_tracking, COUNT(*) n, ROUND(SUM(${AMT}),2) amount
       FROM grn_request g WHERE ${U} GROUP BY g.status`);
  await q("approval trail: finance head reviewed?", `SELECT g.status, g.finance_head_reviewed_at IS NOT NULL reviewed, COUNT(*) n, ROUND(SUM(${AMT}),2) amount FROM grn_request g WHERE ${U} GROUP BY g.status, reviewed`);
  await q("the 2026-09-01 batch (114 no-vendor GRNs): what are they",
    `SELECT g.grn_number, g.head, g.sub_head, g.status, ROUND(${AMT},2) amount, g.bill_date, g.invoice_number, g.vendor_id IS NULL no_vendor, g.legacy_raised_by_name
       FROM grn_request g WHERE ${U} AND g.created_at BETWEEN '2026-09-01 01:00:00' AND '2026-09-01 02:00:00' ORDER BY ${AMT} DESC LIMIT 15`);
  await q("the 2026-09-01 batch: do they look like copies of other GRNs?",
    `SELECT COUNT(*) n, SUM(EXISTS (SELECT 1 FROM grn_request o WHERE o.id <> g.id AND o.grn_number = g.grn_number)) same_grn_number_exists,
            SUM(EXISTS (SELECT 1 FROM grn_request o WHERE o.id <> g.id AND o.bill_date = g.bill_date AND ABS(COALESCE(NULLIF(o.amount_with_tax,0), o.amount) - ${AMT}) < 1 AND o.head = g.head)) same_date_amount_head_exists
       FROM grn_request g WHERE ${U} AND g.created_at BETWEEN '2026-09-01 01:00:00' AND '2026-09-01 02:00:00'`);
  await q("posted after go-live but missed (approved with a head match and vendor, created from 2026-09-01)",
    `SELECT g.grn_number, g.status, g.head, g.sub_head, ROUND(${AMT},2) amount, g.created_at, g.finance_head_reviewed_at
       FROM grn_request g WHERE ${U} AND g.vendor_id IS NOT NULL AND g.created_at >= '2026-09-01' ORDER BY g.created_at DESC LIMIT 15`);
  await q("largest 12 unposted", `SELECT g.grn_number, g.status, g.head, g.sub_head, ROUND(${AMT},2) amount, g.created_at, g.vendor_id IS NOT NULL has_vendor FROM grn_request g WHERE ${U} ORDER BY ${AMT} DESC LIMIT 12`);
}
main().then(() => db.end?.()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end?.(); } catch { } process.exit(1); });
