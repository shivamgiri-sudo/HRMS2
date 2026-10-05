/**
 * Possible double bookings among vendor GRNs: a GRN that is awaiting payment while another GRN for
 * the same vendor, amount and head is already paid. STRICTLY READ-ONLY. npx tsx scripts/duplicate-grn-forensics.ts
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const q = async (label: string, sql: string, params: unknown[] = []) => {
  try { const [rows] = await db.execute<RowDataPacket[]>(sql, params); console.log(`\n## ${label}`); console.table(rows); }
  catch (e: any) { console.log(`\n## ${label}\nSKIPPED: ${e.message}`); }
};
const AMT = (a: string) => `COALESCE(NULLIF(${a}.amount_with_tax,0), ${a}.amount)`;
const CREATOR = `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', e.first_name, e.last_name)),''), g.legacy_raised_by_name, g.created_by)`;
const EMP = `LEFT JOIN (SELECT user_id, MIN(first_name) first_name, MIN(last_name) last_name FROM employees WHERE user_id IS NOT NULL GROUP BY user_id) e ON e.user_id = g.created_by`;

async function main() {
  // Twin = same vendor, same head/sub-head, amount within Re 1, bill in the same month (or both undated).
  const TWIN = (o: string) => `o.id <> g.id AND o.vendor_id = g.vendor_id AND o.head = g.head AND o.sub_head = g.sub_head
        AND ABS(${AMT("o")} - ${AMT("g")}) <= 1 AND COALESCE(DATE_FORMAT(o.bill_date,'%Y-%m'),'-') = COALESCE(DATE_FORMAT(g.bill_date,'%Y-%m'),'-')`;

  await q("GRNs still awaiting payment that have a PAID twin (possible double payment) - totals",
    `SELECT COUNT(*) awaiting_payment_with_paid_twin, ROUND(SUM(${AMT("g")}),2) amount
       FROM grn_request g WHERE g.grn_type='vendor' AND g.status IN ('pending_accounts_payment','payment_scheduled','partially_paid')
        AND EXISTS (SELECT 1 FROM grn_request o WHERE ${TWIN("o")} AND o.status = 'paid')`);

  await q("the pairs (awaiting payment vs its paid twin)",
    `SELECT g.grn_number pending_grn, g.status, ROUND(${AMT("g")},2) amount, g.head, DATE(g.created_at) pending_created, ${CREATOR} pending_created_by,
            o.grn_number paid_twin, DATE(o.created_at) twin_created, o.legacy_raised_by_name twin_by,
            (SELECT t.payment_status FROM vendor_payment_tracking t WHERE t.grn_request_id = g.id LIMIT 1) pending_tracking_status,
            (SELECT ROUND(t.balance_amount,2) FROM vendor_payment_tracking t WHERE t.grn_request_id = g.id LIMIT 1) pending_balance,
            (SELECT ROUND(t.paid_amount,2) FROM vendor_payment_tracking t WHERE t.grn_request_id = o.id LIMIT 1) twin_paid_amount
       FROM grn_request g ${EMP}
       JOIN grn_request o ON ${TWIN("o")} AND o.status = 'paid'
      WHERE g.grn_type='vendor' AND g.status IN ('pending_accounts_payment','payment_scheduled','partially_paid')
      ORDER BY ${AMT("g")} DESC LIMIT 40`);

  await q("payment vouchers already raised against those awaiting-payment GRNs",
    `SELECT pv.status, COUNT(DISTINCT pv.id) vouchers, ROUND(SUM(a.allocated_amount),2) amount
       FROM grn_request g JOIN vendor_payment_tracking t ON t.grn_request_id = g.id
       JOIN payment_voucher_grn_allocation a ON a.vendor_payment_tracking_id = t.id JOIN payment_voucher pv ON pv.id = a.payment_voucher_id
      WHERE g.grn_type='vendor' AND g.status IN ('pending_accounts_payment','payment_scheduled','partially_paid')
        AND EXISTS (SELECT 1 FROM grn_request o WHERE ${TWIN("o")} AND o.status = 'paid') GROUP BY pv.status`);

  await q("duplicates overall: groups of 2+ GRNs with the same vendor, head, amount and month (any status)",
    `SELECT COUNT(*) groups_, SUM(c) grns_in_groups, ROUND(SUM((c-1)*amt),2) amount_counted_more_than_once
       FROM (SELECT COUNT(*) c, MAX(${AMT("g")}) amt FROM grn_request g
              WHERE g.grn_type='vendor' AND ${AMT("g")} > 0 AND g.status NOT IN ('rejected','cancelled','draft')
              GROUP BY g.vendor_id, g.head, g.sub_head, ROUND(${AMT("g")}), DATE_FORMAT(g.bill_date,'%Y-%m') HAVING COUNT(*) > 1) d`);

  await q("GRNs marked PAID with no payment record at all (no tracking row), by creator",
    `SELECT ${CREATOR} creator, COUNT(*) n, ROUND(SUM(${AMT("g")}),2) amount, SUM(g.vendor_id IS NULL) no_vendor, MIN(DATE(g.created_at)) first_, MAX(DATE(g.created_at)) last_
       FROM grn_request g ${EMP}
      WHERE g.grn_type='vendor' AND g.status='paid' AND NOT EXISTS (SELECT 1 FROM vendor_payment_tracking t WHERE t.grn_request_id = g.id)
        AND NOT EXISTS (SELECT 1 FROM journal_entry je WHERE je.source_type='grn' AND je.source_id = g.id)
      GROUP BY creator ORDER BY amount DESC LIMIT 12`);
}
main().then(() => db.end?.()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end?.(); } catch { } process.exit(1); });
