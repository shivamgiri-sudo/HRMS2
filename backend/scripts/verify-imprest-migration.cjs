/**
 * verify-imprest-migration.cjs
 *
 * Compares imprest data between db_bill and mas_hrms to verify migration accuracy.
 *
 * USAGE:
 *   node backend/scripts/verify-imprest-migration.cjs
 *
 * REQUIRES: .env with BILL_DB_* and DB_* credentials
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

async function main() {
  const hrms = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const bill = await mysql.createConnection({
    host: '14.97.30.236', // Public IP (local 192.168.10.22 times out from this machine)
    port: 3306,
    user: 'shivam_user',
    password: 'qwersdfg!@#hjk',
    database: 'db_bill',
    connectTimeout: 30000,
  });

  try {
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(' IMPREST MIGRATION VERIFICATION REPORT');
    console.log('══════════════════════════════════════════════════════════════\n');

    // ─────────────────────────────────────────────────────────────────────────
    // 1. IMPREST MANAGER COUNTS
    // ─────────────────────────────────────────────────────────────────────────
    const [[billMgrCount]] = await bill.query('SELECT COUNT(*) as cnt FROM imprest_manager');
    const [[hrmsMgrCount]] = await hrms.query('SELECT COUNT(*) as cnt FROM imprest_manager');
    const [[hrmsMgrWithTally]] = await hrms.query('SELECT COUNT(*) as cnt FROM imprest_manager WHERE tally_name IS NOT NULL');

    console.log('─── IMPREST MANAGER ───────────────────────────────────────────');
    console.log(`  db_bill.imprest_manager         : ${billMgrCount.cnt} rows`);
    console.log(`  mas_hrms.imprest_manager        : ${hrmsMgrCount.cnt} rows`);
    console.log(`  mas_hrms (with tally_name link) : ${hrmsMgrWithTally.cnt} rows`);
    console.log();

    // ─────────────────────────────────────────────────────────────────────────
    // 2. IMPREST ALLOCATION / ALLOTMENT COUNTS & AMOUNTS
    // ─────────────────────────────────────────────────────────────────────────
    const [[billAllocCount]] = await bill.query('SELECT COUNT(*) as cnt, SUM(Amount) as total FROM imprest_allotment_master');
    const [[hrmsAllocCount]] = await hrms.query('SELECT COUNT(*) as cnt, SUM(amount) as total FROM imprest_allocation');
    const [[hrmsAllocFromBill]] = await hrms.query('SELECT COUNT(*) as cnt, SUM(amount) as total FROM imprest_allocation WHERE bill_source_id IS NOT NULL');

    console.log('─── IMPREST ALLOCATION / ALLOTMENT ────────────────────────────');
    console.log(`  db_bill.imprest_allotment_master : ${billAllocCount.cnt} rows, Total: ₹${Number(billAllocCount.total || 0).toLocaleString('en-IN')}`);
    console.log(`  mas_hrms.imprest_allocation      : ${hrmsAllocCount.cnt} rows, Total: ₹${Number(hrmsAllocCount.total || 0).toLocaleString('en-IN')}`);
    console.log(`  mas_hrms (from db_bill)          : ${hrmsAllocFromBill.cnt} rows, Total: ₹${Number(hrmsAllocFromBill.total || 0).toLocaleString('en-IN')}`);
    console.log();

    // ─────────────────────────────────────────────────────────────────────────
    // 3. LEDGER VERIFICATION
    // ─────────────────────────────────────────────────────────────────────────
    const [[ledgerCredits]] = await hrms.query(`
      SELECT COUNT(*) as cnt, SUM(amount) as total
      FROM imprest_transaction_ledger
      WHERE direction = 'credit'
    `);
    const [[ledgerDebits]] = await hrms.query(`
      SELECT COUNT(*) as cnt, SUM(amount) as total
      FROM imprest_transaction_ledger
      WHERE direction = 'debit'
    `);

    console.log('─── IMPREST LEDGER ────────────────────────────────────────────');
    console.log(`  Credit entries (allocations)     : ${ledgerCredits.cnt} rows, Total: ₹${Number(ledgerCredits.total || 0).toLocaleString('en-IN')}`);
    console.log(`  Debit entries (vouchers/returns) : ${ledgerDebits.cnt} rows, Total: ₹${Number(ledgerDebits.total || 0).toLocaleString('en-IN')}`);
    console.log(`  Net Float Balance (credits-debits): ₹${(Number(ledgerCredits.total || 0) - Number(ledgerDebits.total || 0)).toLocaleString('en-IN')}`);
    console.log();

    // ─────────────────────────────────────────────────────────────────────────
    // 4. PER-BRANCH COMPARISON
    // ─────────────────────────────────────────────────────────────────────────
    console.log('─── PER-BRANCH ALLOCATION COMPARISON ─────────────────────────');

    // Get branch mapping
    const [branchMap] = await hrms.query(`
      SELECT dbbill_branch_id, hrms_branch_id, b.branch_name
      FROM grn_migration_branch_map m
      LEFT JOIN branch_master b ON b.id = m.hrms_branch_id
    `);

    for (const branch of branchMap) {
      const [[billBranch]] = await bill.query(
        'SELECT COUNT(*) as cnt, SUM(Amount) as total FROM imprest_allotment_master WHERE BranchId = ?',
        [branch.dbbill_branch_id]
      );
      const [[hrmsBranch]] = await hrms.query(
        'SELECT COUNT(*) as cnt, SUM(amount) as total FROM imprest_allocation WHERE branch_id = ? AND bill_source_id IS NOT NULL',
        [branch.hrms_branch_id]
      );

      const billTotal = Number(billBranch.total || 0);
      const hrmsTotal = Number(hrmsBranch.total || 0);
      const diff = billTotal - hrmsTotal;
      const status = Math.abs(diff) < 1 ? '✓' : (diff > 0 ? '⚠ MISSING' : '⚠ EXTRA');

      console.log(`  ${(branch.branch_name || 'Unknown').padEnd(20)} | db_bill: ${billBranch.cnt} (₹${billTotal.toLocaleString('en-IN')}) | hrms: ${hrmsBranch.cnt} (₹${hrmsTotal.toLocaleString('en-IN')}) | ${status}`);
    }
    console.log();

    // ─────────────────────────────────────────────────────────────────────────
    // 5. MISSING RECORDS CHECK
    // ─────────────────────────────────────────────────────────────────────────
    console.log('─── MISSING RECORDS CHECK ─────────────────────────────────────');

    const [billAllocIds] = await bill.query('SELECT Id FROM imprest_allotment_master');
    const [hrmsAllocBillIds] = await hrms.query('SELECT bill_source_id FROM imprest_allocation WHERE bill_source_id IS NOT NULL');

    const billIdSet = new Set(billAllocIds.map(r => r.Id));
    const hrmsIdSet = new Set(hrmsAllocBillIds.map(r => r.bill_source_id));

    const missingInHrms = [...billIdSet].filter(id => !hrmsIdSet.has(id));
    const extraInHrms = [...hrmsIdSet].filter(id => !billIdSet.has(id));

    console.log(`  Records in db_bill missing from hrms: ${missingInHrms.length}`);
    if (missingInHrms.length > 0 && missingInHrms.length <= 20) {
      console.log(`    IDs: ${missingInHrms.join(', ')}`);
    }
    console.log(`  Extra records in hrms (not in db_bill): ${extraInHrms.length}`);
    console.log();

    // ─────────────────────────────────────────────────────────────────────────
    // 6. SAMPLE DATA COMPARISON (first 5 allocations)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('─── SAMPLE DATA COMPARISON (first 10 allocations) ────────────');

    const [billSamples] = await bill.query(`
      SELECT a.Id, a.Amount, a.EntryDate, a.PaymentMode, m.TallyHead, a.BranchId
      FROM imprest_allotment_master a
      LEFT JOIN imprest_manager m ON m.Id = a.ImprestManagerId
      ORDER BY a.Id
      LIMIT 10
    `);

    for (const sample of billSamples) {
      const [[hrmsSample]] = await hrms.query(`
        SELECT a.allocation_no, a.amount, a.allocation_date, a.payment_mode, m.tally_name
        FROM imprest_allocation a
        LEFT JOIN imprest_manager m ON m.id = a.imprest_manager_id
        WHERE a.bill_source_id = ?
      `, [sample.Id]);

      if (hrmsSample) {
        const amtMatch = Math.abs(Number(sample.Amount) - Number(hrmsSample.amount)) < 0.01;
        console.log(`  Bill#${sample.Id}: ₹${Number(sample.Amount).toLocaleString('en-IN')} → HRMS: ₹${Number(hrmsSample.amount).toLocaleString('en-IN')} ${amtMatch ? '✓' : '✗'} | ${hrmsSample.allocation_no}`);
      } else {
        console.log(`  Bill#${sample.Id}: ₹${Number(sample.Amount).toLocaleString('en-IN')} → HRMS: NOT FOUND ✗`);
      }
    }
    console.log();

    // ─────────────────────────────────────────────────────────────────────────
    // SUMMARY
    // ─────────────────────────────────────────────────────────────────────────
    const allocDiff = Number(billAllocCount.cnt) - Number(hrmsAllocFromBill.cnt);
    const amtDiff = Number(billAllocCount.total || 0) - Number(hrmsAllocFromBill.total || 0);

    console.log('══════════════════════════════════════════════════════════════');
    console.log(' SUMMARY');
    console.log('══════════════════════════════════════════════════════════════');
    console.log(`  Allocation count diff: ${allocDiff} (${allocDiff === 0 ? 'MATCH ✓' : 'MISMATCH ✗'})`);
    console.log(`  Allocation amount diff: ₹${amtDiff.toLocaleString('en-IN')} (${Math.abs(amtDiff) < 1 ? 'MATCH ✓' : 'MISMATCH ✗'})`);
    console.log(`  Missing records: ${missingInHrms.length}`);
    console.log('══════════════════════════════════════════════════════════════\n');

  } finally {
    await hrms.end();
    await bill.end();
  }
}

main().catch(err => {
  console.error('\nVERIFICATION FAILED:', err.message ?? err);
  process.exit(1);
});
