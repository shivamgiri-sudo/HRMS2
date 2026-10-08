/**
 * Vendor ledger vs the payments actually made. STRICTLY READ-ONLY (SELECT only).
 *
 * The Vendor Ledger report reads journal_entry_line. This compares what the journal holds for
 * vendors against the payment tables (vendor_payment_transaction, payment_voucher) to show which
 * payments never reached the journal. Output is counts and totals, plus vendor_code / amounts
 * for the largest gaps.
 *
 *   npx tsx scripts/vendor-ledger-gap-audit.ts
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const q = async (label: string, sql: string, params: unknown[] = []) => {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    console.log(`\n## ${label}`);
    console.table(rows);
  } catch (e: any) { console.log(`\n## ${label}\nSKIPPED: ${e.message}`); }
};

async function main() {
  await q("journal entries by source (live, not reversed)",
    `SELECT je.source_type, COUNT(*) entries, MIN(je.entry_date) first_date, MAX(je.entry_date) last_date
       FROM journal_entry je WHERE je.reversed_by_entry_id IS NULL GROUP BY je.source_type`);

  await q("vendor lines in the journal: total debit (payments) / credit (bills) by source",
    `SELECT je.source_type, COUNT(*) lines, ROUND(SUM(jel.debit_amount),2) debit, ROUND(SUM(jel.credit_amount),2) credit
       FROM journal_entry_line jel JOIN journal_entry je ON je.id = jel.journal_entry_id
      WHERE jel.account_type = 'vendor' AND je.reversed_by_entry_id IS NULL GROUP BY je.source_type`);

  await q("vendor_payment_transaction: all payments recorded (the dispatch ledger)",
    `SELECT COUNT(*) payments, COUNT(DISTINCT vendor_payment_id) dues, ROUND(SUM(amount),2) amount,
            MIN(payment_date) first_date, MAX(payment_date) last_date
       FROM vendor_payment_transaction`);

  await q("payments driven by a RELEASED payment voucher (these are journaled by release())",
    `SELECT COUNT(DISTINCT t.id) payments, ROUND(SUM(t.amount),2) amount
       FROM vendor_payment_transaction t
       JOIN payment_voucher_grn_allocation a ON a.vendor_payment_tracking_id = t.vendor_payment_id
       JOIN payment_voucher pv ON pv.id = a.payment_voucher_id AND pv.status = 'released'`);

  await q("released vouchers: how many have a live journal entry",
    `SELECT COUNT(*) released,
            SUM(EXISTS (SELECT 1 FROM journal_entry je WHERE je.source_type='payment_voucher' AND je.source_id = pv.id AND je.reversed_by_entry_id IS NULL)) journaled
       FROM payment_voucher pv WHERE pv.status = 'released'`);

  await q("approved vendor GRNs: how many have a live journal entry",
    `SELECT COUNT(*) grns_in_tracking, COUNT(DISTINCT vpt.grn_request_id) distinct_grns
       FROM vendor_payment_tracking vpt`);

  await q("payments per month in vendor_payment_transaction vs journal vendor debits",
    `SELECT DATE_FORMAT(t.payment_date,'%Y-%m') ym, COUNT(*) payments, ROUND(SUM(t.amount),2) amount
       FROM vendor_payment_transaction t GROUP BY ym ORDER BY ym DESC LIMIT 14`);

  await q("top 15 vendors by paid amount NOT in the journal (paid per dispatch ledger minus journal debits)",
    `SELECT vm.vendor_code, vm.vendor_name, ROUND(p.paid,2) paid_per_dispatch_ledger, ROUND(COALESCE(j.deb,0),2) journal_debits,
            ROUND(p.paid - COALESCE(j.deb,0),2) missing
       FROM (SELECT vpt.vendor_id, SUM(t.amount) paid FROM vendor_payment_transaction t
               JOIN vendor_payment_tracking vpt ON vpt.id = t.vendor_payment_id GROUP BY vpt.vendor_id) p
       JOIN vendor_master vm ON vm.id = p.vendor_id
       LEFT JOIN (SELECT jel.account_id, SUM(jel.debit_amount) deb FROM journal_entry_line jel
                    JOIN journal_entry je ON je.id = jel.journal_entry_id AND je.reversed_by_entry_id IS NULL
                   WHERE jel.account_type='vendor' GROUP BY jel.account_id) j ON j.account_id = p.vendor_id
      ORDER BY missing DESC LIMIT 15`);
}

main().then(() => db.end?.()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end?.(); } catch { } process.exit(1); });
