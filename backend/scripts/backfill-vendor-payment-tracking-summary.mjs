/**
 * backfill-vendor-payment-tracking-summary.mjs
 *
 * vendor_payment_tracking carries its own summary columns (payment_mode, payment_date,
 * bank_id, bank_name, transaction_id) — set correctly by the live dispatch() flow for NEW
 * payments, but left NULL on every one of the 11,582 rows migrate-grn-from-dbbill.ts
 * backfilled from db_bill (2017-2026), even though the real per-installment detail for
 * those rows already sits correctly in vendor_payment_transaction (migrated by that same
 * script). Verified live 2026-09-10: vendor_payment_transaction has payment_date on 100%
 * of rows, payment_mode on 100%, bank_name on ~75% (the rest are Cash/Adjustment, which
 * legitimately have none) — the data was never lost, just never copied up to the summary
 * row. Concretely this means: the CSV export at GET /api/finance/vendor-payments/export
 * (vendor-payment.service.ts exportPayments -> listPayments, which reads
 * vendor_payment_tracking directly, no join to transactions) shows a blank payment
 * date/mode/bank/reference for every legacy-paid vendor bill.
 *
 * This backfills the LATEST transaction (highest sequence_no) per vendor_payment_id onto
 * its tracking row's summary columns — ONLY where the tracking row's own column is
 * currently NULL, so a live dispatch's own values are never touched. Skips transaction
 * rows whose payment_date is the '0000-00-00' zero-date artifact (a handful of legacy
 * rows) rather than propagate a garbage date onto the summary column.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write.
 *
 * Usage:
 *   node backend/scripts/backfill-vendor-payment-tracking-summary.mjs
 *   node backend/scripts/backfill-vendor-payment-tracking-summary.mjs --apply
 */
import { connect } from './lib/db-connect.mjs';

const APPLY = process.argv.includes('--apply');

async function main() {
  const hrms = await connect('mas_hrms', { log: console.log });

  try {
    // Latest transaction per vendor_payment_id, excluding the zero-date artifact.
    const [candidates] = await hrms.query(`
      SELECT vpt.id AS tracking_id, vt.payment_mode, vt.payment_date, vt.bank_id, vt.bank_name, vt.transaction_id
      FROM vendor_payment_tracking vpt
      JOIN vendor_payment_transaction vt ON vt.vendor_payment_id = vpt.id
      JOIN (
        SELECT vendor_payment_id, MAX(sequence_no) AS max_seq
        FROM vendor_payment_transaction
        WHERE payment_date >= '1901-01-01'
        GROUP BY vendor_payment_id
      ) latest ON latest.vendor_payment_id = vt.vendor_payment_id AND latest.max_seq = vt.sequence_no
      WHERE vpt.payment_date IS NULL
    `);

    console.log(`Found ${candidates.length} vendor_payment_tracking rows with a real transaction`
      + ` but a blank summary column.`);

    if (!APPLY) {
      console.log('\nDRY RUN — sample of 5:');
      console.table(candidates.slice(0, 5));
      console.log('\nRe-run with --apply to write.');
      return;
    }

    let updated = 0;
    const BATCH = 200;
    for (let i = 0; i < candidates.length; i += BATCH) {
      const chunk = candidates.slice(i, i + BATCH);
      for (const row of chunk) {
        const [result] = await hrms.execute(
          `UPDATE vendor_payment_tracking
              SET payment_mode = COALESCE(payment_mode, ?),
                  payment_date = COALESCE(payment_date, ?),
                  bank_id = COALESCE(bank_id, ?),
                  bank_name = COALESCE(bank_name, ?),
                  transaction_id = COALESCE(transaction_id, ?)
            WHERE id = ? AND payment_date IS NULL`,
          [row.payment_mode, row.payment_date, row.bank_id, row.bank_name, row.transaction_id, row.tracking_id]
        );
        updated += result.affectedRows;
      }
      process.stdout.write(`\r  ${Math.min(i + BATCH, candidates.length)}/${candidates.length} processed...`);
    }
    console.log(`\n\nUpdated: ${updated} rows.`);
  } finally {
    await hrms.end();
  }
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
