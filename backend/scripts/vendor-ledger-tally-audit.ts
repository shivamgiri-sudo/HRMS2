/**
 * Does the vendor ledger tally? STRICTLY READ-ONLY (SELECT only).
 *
 * For every vendor compares the three places a vendor's money lives:
 *   bills     journal credits (GRN approvals)   vs  vendor_payment_tracking.due_amount
 *   payments  vendor_payment_transaction        vs  vendor_payment_tracking.paid_amount
 *   balance   bills - payments                  vs  vendor_payment_tracking.balance_amount
 * and flags vendors that appear under more than one vendor_master id (same name), whose ledger
 * is split. Prints totals, mismatch counts and the worst vendors; plus a name search.
 *
 *   npx tsx scripts/vendor-ledger-tally-audit.ts [name-fragment ...]
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const frags = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const q = async (label: string, sql: string, params: unknown[] = []) => {
  try { const [rows] = await db.execute<RowDataPacket[]>(sql, params); console.log(`\n## ${label}`); console.table(rows); }
  catch (e: any) { console.log(`\n## ${label}\nSKIPPED: ${e.message}`); }
};

const PER_VENDOR = `
  SELECT vm.id vendor_id, vm.vendor_code, vm.vendor_name,
         COALESCE(t.due,0) tracking_due, COALESCE(t.paid,0) tracking_paid, COALESCE(t.bal,0) tracking_balance, COALESCE(t.bills,0) bills,
         COALESCE(x.paid,0) txn_paid, COALESCE(x.n,0) txns,
         COALESCE(j.cr,0) journal_credit, COALESCE(j.dr,0) journal_debit
    FROM vendor_master vm
    LEFT JOIN (SELECT vendor_id, SUM(due_amount) due, SUM(paid_amount) paid, SUM(balance_amount) bal, COUNT(*) bills FROM vendor_payment_tracking GROUP BY vendor_id) t ON t.vendor_id = vm.id
    LEFT JOIN (SELECT vpt.vendor_id, SUM(tx.amount) paid, COUNT(*) n FROM vendor_payment_transaction tx JOIN vendor_payment_tracking vpt ON vpt.id = tx.vendor_payment_id GROUP BY vpt.vendor_id) x ON x.vendor_id = vm.id
    LEFT JOIN (SELECT jel.account_id, SUM(jel.credit_amount) cr, SUM(jel.debit_amount) dr FROM journal_entry_line jel JOIN journal_entry je ON je.id = jel.journal_entry_id AND je.reversed_by_entry_id IS NULL WHERE jel.account_type = 'vendor' GROUP BY jel.account_id) j ON j.account_id = vm.id`;

async function main() {
  await q("grand totals across all vendors",
    `SELECT COUNT(*) vendors_with_activity, ROUND(SUM(tracking_due),2) bills_tracking, ROUND(SUM(journal_credit),2) bills_journal,
            ROUND(SUM(tracking_paid),2) paid_tracking, ROUND(SUM(txn_paid),2) paid_transactions,
            ROUND(SUM(tracking_balance),2) balance_tracking, ROUND(SUM(journal_credit) - SUM(txn_paid),2) balance_journal_minus_txn
       FROM (${PER_VENDOR}) a WHERE tracking_due <> 0 OR txn_paid <> 0 OR journal_credit <> 0`);

  await q("how many vendors disagree (more than Rs 1)",
    `SELECT SUM(ABS(tracking_due - journal_credit) > 1) bills_differ_from_journal,
            SUM(ABS(tracking_paid - txn_paid) > 1) tracking_paid_differs_from_txns,
            SUM(ABS((tracking_due - tracking_paid) - tracking_balance) > 1) balance_not_due_minus_paid
       FROM (${PER_VENDOR}) a WHERE tracking_due <> 0 OR txn_paid <> 0 OR journal_credit <> 0`);

  await q("worst 15 vendors by paid-per-tracking vs paid-per-transactions",
    `SELECT vendor_code, vendor_name, ROUND(tracking_paid,2) tracking_paid, ROUND(txn_paid,2) txn_paid, ROUND(tracking_paid - txn_paid,2) diff
       FROM (${PER_VENDOR}) a ORDER BY ABS(tracking_paid - txn_paid) DESC LIMIT 15`);

  await q("worst 15 vendors by bills-per-tracking vs bills-in-journal",
    `SELECT vendor_code, vendor_name, bills, ROUND(tracking_due,2) tracking_due, ROUND(journal_credit,2) journal_credit, ROUND(tracking_due - journal_credit,2) diff
       FROM (${PER_VENDOR}) a ORDER BY ABS(tracking_due - journal_credit) DESC LIMIT 15`);

  await q("vendor names stored under more than one vendor id (split ledgers), with activity",
    `SELECT UPPER(TRIM(vendor_name)) name, COUNT(*) ids, ROUND(SUM(tracking_due),2) bills, ROUND(SUM(txn_paid),2) paid
       FROM (${PER_VENDOR}) a WHERE tracking_due <> 0 OR txn_paid <> 0 OR journal_credit <> 0
      GROUP BY UPPER(TRIM(vendor_name)) HAVING COUNT(*) > 1 ORDER BY SUM(tracking_due) DESC LIMIT 15`);

  await q("how many duplicate-name groups exist at all",
    `SELECT COUNT(*) groups_with_duplicate_ids, SUM(c) extra_ids FROM (SELECT COUNT(*) c FROM vendor_master GROUP BY UPPER(TRIM(vendor_name)) HAVING COUNT(*) > 1) d`);

  for (const f of frags) {
    await q(`vendors matching "${f}" (every id, active or not)`,
      `SELECT vendor_code, vendor_name, vendor_id, bills, ROUND(tracking_due,2) tracking_due, ROUND(tracking_paid,2) tracking_paid, ROUND(txn_paid,2) txn_paid,
              ROUND(tracking_balance,2) tracking_balance, ROUND(journal_credit,2) journal_credit, ROUND(journal_debit,2) journal_debit
         FROM (${PER_VENDOR}) a WHERE vendor_name LIKE ? OR vendor_code LIKE ? LIMIT 20`, [`%${f}%`, `%${f}%`]);
  }
}

main().then(() => db.end?.()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end?.(); } catch { } process.exit(1); });
