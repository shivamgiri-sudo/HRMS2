/**
 * One-time backfill: legacy vendor GRNs whose db_bill EntryStatus was never flipped to 'Close'
 * even though a real payment was recorded in tbl_payment_processing. Companion to
 * backfill-vendor-grn-approved-status.cjs (which fixed the earlier submitted->approved bug) —
 * this fixes the next layer: "approved" is not the same as "paid", and ~65% of the rows that
 * fix moved to finance_head_approved/pending_accounts_payment turn out to already be paid.
 *
 * Scope: grn_request rows where grn_type='vendor', status IN ('finance_head_approved',
 * 'pending_accounts_payment'), bill_source_id IS NOT NULL, and db_bill's
 * tbl_payment_processing has at least one row for that bill_source_id (GrnId).
 *
 * For each matched row:
 *   - grn_request.status -> 'paid'
 *   - vendor_payment_tracking: create if missing (mirrors migrate-grn-from-dbbill.ts's own
 *     logic for status='paid' rows), else update to Paid/paid_amount=full/balance=0.
 *   - vendor_payment_transaction: one row per db_bill tbl_payment_processing record, INSERT
 *     IGNORE keyed by the table's own (vendor_payment_id, sequence_no) unique constraint, so a
 *     second run against an already-backfilled row is a safe no-op.
 *
 * tbl_payment_processing carries no per-payment amount (verified in migrate-grn-from-dbbill.ts's
 * own comment) — every transaction row inherits the GRN's full amount_with_tax, matching the
 * convention the original migration already used for the 2,641 rows it classified correctly.
 *
 * Saves the full before-state to a local JSON file (not committed) before writing.
 *
 * USAGE
 *   node backend/scripts/backfill-vendor-grn-actually-paid.cjs            # dry-run
 *   node backend/scripts/backfill-vendor-grn-actually-paid.cjs --apply    # write
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const APPLY = process.argv.includes('--apply');
const OUT_FILE = path.join(__dirname, `backfill-vendor-grn-paid-${Date.now()}.json`);
const MIGRATION_USER = '00000000-0000-0000-0000-dbbill000001';

function decodePaymentMode(raw) {
  if (!raw) return 'Other';
  const r = String(raw).trim().toLowerCase();
  if (r === 'cheque' || r === 'check') return 'Cheque';
  if (r === 'neft') return 'NEFT';
  if (r === 'rtgs') return 'RTGS';
  if (r === 'imps') return 'IMPS';
  if (r === 'upi') return 'UPI';
  if (r === 'cash') return 'Cash';
  return 'Other';
}

async function main() {
  const hrms = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const bill = await mysql.createConnection({
    host: '192.168.10.22', port: process.env.BILL_DB_PORT,
    user: process.env.BILL_DB_USER, password: process.env.BILL_DB_PASSWORD,
    database: process.env.BILL_DB_NAME,
  });

  try {
    const [rows] = await hrms.query(
      `SELECT id, bill_source_id, status, grn_number, branch_id, vendor_id, vendor_name,
              head, sub_head, due_date, amount_without_tax, tax_amount, amount_with_tax,
              financial_year, cost_centre_id, cost_class, pnl_bucket, recognition_period,
              budget_id, budget_line_id, process_id
       FROM grn_request
       WHERE grn_type = 'vendor' AND status IN ('finance_head_approved', 'pending_accounts_payment')
         AND bill_source_id IS NOT NULL`
    );
    console.log(`Candidate vendor rows (finance_head_approved / pending_accounts_payment): ${rows.length}`);

    const ids = rows.map(r => r.bill_source_id);
    const payMap = new Map();
    const chunkSize = 2000;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const [payRows] = await bill.query(
        `SELECT Id, GrnId, PaymentMode, PaymentDate, BankName, TransactionId, CreateDate
         FROM tbl_payment_processing WHERE GrnId IN (${chunk.map(() => '?').join(',')})`,
        chunk
      );
      for (const p of payRows) {
        if (!payMap.has(p.GrnId)) payMap.set(p.GrnId, []);
        payMap.get(p.GrnId).push(p);
      }
    }

    const toUpdate = rows.filter(r => payMap.has(r.bill_source_id));
    console.log(`Rows confirmed already-paid in db_bill: ${toUpdate.length}`);
    console.log(`Rows left untouched (no payment record found): ${rows.length - toUpdate.length}`);

    fs.writeFileSync(OUT_FILE, JSON.stringify({
      generated_at: new Date().toISOString(),
      new_status: 'paid',
      rows: toUpdate.map(r => ({ id: r.id, bill_source_id: r.bill_source_id, old_status: r.status })),
    }, null, 2));
    console.log(`Before-state saved to ${OUT_FILE}`);

    if (!APPLY) {
      console.log('\nDRY RUN — no writes made. Re-run with --apply to write.');
      return;
    }

    // Existing vendor_payment_tracking rows, keyed by grn_request_id
    const [existingVpt] = await hrms.query(
      `SELECT id, grn_request_id FROM vendor_payment_tracking WHERE grn_request_id IN (${
        toUpdate.map(() => '?').join(',') || 'NULL'
      })`,
      toUpdate.map(r => r.id)
    );
    const vptByGrn = new Map(existingVpt.map(v => [v.grn_request_id, v.id]));

    let statusUpdated = 0, vptCreated = 0, vptUpdated = 0, vtxInserted = 0;

    for (const r of toUpdate) {
      const [result] = await hrms.query(
        `UPDATE grn_request SET status = 'paid'
         WHERE id = ? AND status IN ('finance_head_approved', 'pending_accounts_payment')`,
        [r.id]
      );
      statusUpdated += result.affectedRows;

      let vptId = vptByGrn.get(r.id);
      if (vptId) {
        await hrms.query(
          `UPDATE vendor_payment_tracking
           SET payment_status = 'Paid', paid_amount = ?, balance_amount = 0
           WHERE id = ?`,
          [r.amount_with_tax, vptId]
        );
        vptUpdated++;
      } else {
        vptId = uuidv4();
        await hrms.query(
          `INSERT INTO vendor_payment_tracking (
             id, grn_request_id, grn_number, branch_id, vendor_id, vendor_name,
             head, sub_head, due_amount, due_date,
             paid_amount, balance_amount,
             payment_status, financial_year,
             amount_without_tax, tax_amount, amount_with_tax,
             cost_centre_id, bill_source_id, created_at
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            vptId, r.id, r.grn_number, r.branch_id, r.vendor_id, r.vendor_name,
            r.head, r.sub_head, r.amount_with_tax, r.due_date,
            r.amount_with_tax, 0,
            'Paid', r.financial_year,
            r.amount_without_tax, r.tax_amount, r.amount_with_tax,
            r.cost_centre_id, r.bill_source_id, new Date(),
          ]
        );
        vptCreated++;
      }

      const payments = payMap.get(r.bill_source_id) ?? [];
      for (const pay of payments) {
        const [insResult] = await hrms.query(
          `INSERT IGNORE INTO vendor_payment_transaction (
             id, vendor_payment_id, grn_request_id, sequence_no,
             payment_mode, payment_date, bank_name, transaction_id,
             amount, tds_amount, net_amount, created_by, created_at
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            uuidv4(), vptId, r.id, pay.Id,
            decodePaymentMode(pay.PaymentMode),
            pay.PaymentDate ? new Date(pay.PaymentDate) : null,
            pay.BankName ?? null, pay.TransactionId ?? null,
            r.amount_with_tax, 0, r.amount_with_tax,
            MIGRATION_USER,
            pay.CreateDate ? new Date(pay.CreateDate) : new Date(),
          ]
        );
        if (insResult.affectedRows > 0) vtxInserted++;
      }

      if (statusUpdated % 2000 === 0) {
        process.stdout.write(`\rProgress: ${statusUpdated}/${toUpdate.length} ...`);
      }
    }

    console.log(`\n\nUPDATED: ${statusUpdated} grn_request rows set to status='paid'`);
    console.log(`vendor_payment_tracking: ${vptCreated} created, ${vptUpdated} updated`);
    console.log(`vendor_payment_transaction: ${vtxInserted} inserted`);

    const [[check1]] = await hrms.query(
      `SELECT COUNT(*) cnt FROM grn_request WHERE grn_type='vendor' AND status IN ('finance_head_approved','pending_accounts_payment')`
    );
    console.log(`Vendor rows still pending (finance/accounts) after backfill: ${check1.cnt}`);
  } finally {
    await hrms.end();
    await bill.end();
  }
}

main().catch(e => { console.error('BACKFILL FAILED:', e); process.exit(1); });
