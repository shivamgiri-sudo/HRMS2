/**
 * Deep dive on the suspected duplicate vendor GRNs. STRICTLY READ-ONLY. npx tsx scripts/grn-pair-deepdive.ts
 * Prints, for each Sept-2026 "pending" GRN with a paid look-alike: both full rows, their payment
 * tracking, payment vouchers, and the audit trail, so a human can tell a true duplicate from a repeat bill.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const q = async (label: string, sql: string, params: unknown[] = []) => {
  try { const [rows] = await db.execute<RowDataPacket[]>(sql, params); console.log(`\n## ${label}`); console.table(rows); return rows as any[]; }
  catch (e: any) { console.log(`\n## ${label}\nSKIPPED: ${e.message}`); return []; }
};
const AMT = (a: string) => `COALESCE(NULLIF(${a}.amount_with_tax,0), ${a}.amount)`;
const NAME = (a: string) => `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', e_${a}.first_name, e_${a}.last_name)),''), ${a}.legacy_raised_by_name, ${a}.created_by)`;
const EMPJ = (a: string) => `LEFT JOIN (SELECT user_id, MIN(first_name) first_name, MIN(last_name) last_name FROM employees WHERE user_id IS NOT NULL GROUP BY user_id) e_${a} ON e_${a}.user_id = ${a}.created_by`;

async function main() {
  const pairs = await q("pending GRN x paid look-alike, Sept-2026 (full detail)",
    `SELECT g.id pend_id, o.id paid_id, g.grn_number pend, o.grn_number paid, ROUND(${AMT("g")},2) pend_amt, ROUND(${AMT("o")},2) paid_amt,
            g.invoice_number pend_inv, o.invoice_number paid_inv, g.bill_date pend_bill, o.bill_date paid_bill,
            g.vendor_id IS NOT NULL pend_vendor, o.vendor_id IS NOT NULL paid_vendor,
            g.head, g.sub_head, g.status pend_status, o.status paid_status,
            g.created_at pend_created, o.created_at paid_created, ${NAME("g")} pend_by, ${NAME("o")} paid_by,
            g.cost_centre_id = o.cost_centre_id same_cc, g.branch_id = o.branch_id same_branch
       FROM grn_request g ${EMPJ("g")}
       JOIN grn_request o ON o.id <> g.id AND o.head = g.head AND o.sub_head = g.sub_head AND ABS(${AMT("o")} - ${AMT("g")}) <= 1 AND o.status = 'paid'
            AND o.created_at >= '2026-09-01' AND o.created_at <= g.created_at + INTERVAL 1 DAY ${EMPJ("o")}
      WHERE g.grn_type='vendor' AND g.status IN ('pending_accounts_payment','payment_scheduled','partially_paid') AND g.created_at >= '2026-09-01'
      ORDER BY ${AMT("g")} DESC LIMIT 40`);

  const pendIds = [...new Set(pairs.map((p) => String(p.pend_id)))];
  const paidIds = [...new Set(pairs.map((p) => String(p.paid_id)))];
  const inList = (ids: string[]) => ids.map(() => "?").join(",") || "''";

  await q("how the PENDING ones are tracked (payable now?)",
    `SELECT g.grn_number, t.payment_status, ROUND(t.due_amount,2) due, ROUND(t.paid_amount,2) paid, ROUND(t.balance_amount,2) balance, t.vendor_id IS NOT NULL has_vendor, t.created_at
       FROM grn_request g LEFT JOIN vendor_payment_tracking t ON t.grn_request_id = g.id WHERE g.id IN (${inList(pendIds)}) ORDER BY t.balance_amount DESC`, pendIds);
  await q("how the PAID twins are tracked (was money really paid?)",
    `SELECT o.grn_number, t.id IS NOT NULL has_tracking, t.payment_status, ROUND(t.paid_amount,2) paid, t.payment_date, t.transaction_id,
            (SELECT COUNT(*) FROM vendor_payment_transaction x WHERE x.vendor_payment_id = t.id) txns
       FROM grn_request o LEFT JOIN vendor_payment_tracking t ON t.grn_request_id = o.id WHERE o.id IN (${inList(paidIds)})`, paidIds);
  await q("payment vouchers on either side",
    `SELECT g.grn_number, pv.voucher_number, pv.status, ROUND(a.allocated_amount,2) amount
       FROM grn_request g JOIN vendor_payment_tracking t ON t.grn_request_id = g.id
       JOIN payment_voucher_grn_allocation a ON a.vendor_payment_tracking_id = t.id JOIN payment_voucher pv ON pv.id = a.payment_voucher_id
      WHERE g.id IN (${inList([...pendIds, ...paidIds])})`, [...pendIds, ...paidIds]);
  await q("audit trail on those GRNs",
    `SELECT entity_id, action_type, actor_role, acted_at, LEFT(CAST(change_summary AS CHAR),120) summary FROM sensitive_action_log
      WHERE entity_type IN ('grn_request','grn') AND entity_id IN (${inList([...pendIds, ...paidIds])}) ORDER BY acted_at DESC LIMIT 40`, [...pendIds, ...paidIds]).catch(() => []);

  await q("the two source patterns: GRNs numbered MAS/NN/YY/NNNN (new format) vs Mas/N/YY/NNN (old)",
    `SELECT CASE WHEN g.grn_number REGEXP '^MAS/[0-9]+/[0-9]+/[0-9]{4}$' THEN 'new MAS/MM/YY/NNNN' ELSE 'old Mas/M/YY/NNN' END fmt, g.status, COUNT(*) n, ROUND(SUM(${AMT("g")}),2) amt,
            MIN(g.created_at) first_, MAX(g.created_at) last_
       FROM grn_request g WHERE g.grn_type='vendor' AND g.created_at >= '2026-08-25' GROUP BY fmt, g.status ORDER BY fmt, g.status`);
  await q("Sept: GRNs with the same invoice number as another GRN (any vendor)",
    `SELECT g.invoice_number, COUNT(*) n, GROUP_CONCAT(g.grn_number ORDER BY g.created_at SEPARATOR ' | ') grns, GROUP_CONCAT(g.status ORDER BY g.created_at SEPARATOR ' | ') statuses
       FROM grn_request g WHERE g.grn_type='vendor' AND g.created_at >= '2026-08-25' AND g.invoice_number IS NOT NULL AND g.invoice_number NOT IN ('','NA','N/A','na')
      GROUP BY g.invoice_number HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 25`);
  await q("what do the budgetfix001 GRNs look like and do they hit budgets",
    `SELECT g.status, g.head, g.sub_head, COUNT(*) n, ROUND(SUM(${AMT("g")}),2) amt, SUM(g.vendor_id IS NULL) no_vendor, SUM(g.invoice_number IS NULL OR g.invoice_number = '') no_invoice,
            (SELECT COUNT(*) FROM budget_consumption bc WHERE bc.grn_request_id IN (SELECT id FROM grn_request WHERE created_by='00000000-0000-0000-0000-budgetfix001')) budget_rows
       FROM grn_request g WHERE g.created_by = '00000000-0000-0000-0000-budgetfix001' GROUP BY g.status, g.head, g.sub_head ORDER BY amt DESC LIMIT 15`).catch(() => []);
}
main().then(() => db.end?.()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end?.(); } catch { } process.exit(1); });
