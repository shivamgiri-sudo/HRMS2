/**
 * backfill-imprest-ledger-gaps.cjs
 *
 * Two-pass backfill for gaps in imprest historical data:
 *
 * Pass 1 — Missing ledger DEBIT entries (GRN vouchers)
 *   453 migrated imprest GRNs in managed branches have no ledger row.
 *   For each, pick the best imprest_manager for that branch + date and
 *   insert an imprest_transaction_ledger debit.
 *
 * Pass 2 — Missing allotments from db_bill
 *   db_bill.imprest_allotment_master has 2,822 rows; mas_hrms has 1,918.
 *   Imports the gap for branches that already have managers in mas_hrms.
 *
 * Manager selection per branch:
 *   1. Prefer the manager with tally_name IS NULL (legacy bucket)
 *   2. Else, manager with the highest existing ledger row count
 *   3. If still tied, most-recent effective_from
 *
 * USAGE
 *   node backend/scripts/backfill-imprest-ledger-gaps.cjs          # dry-run
 *   node backend/scripts/backfill-imprest-ledger-gaps.cjs --apply  # execute
 *
 * Idempotent: skips GRNs that already have a ledger entry; skips allotments
 * already imported (bill_source_id match).
 */

'use strict';
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const APPLY = process.argv.includes('--apply');
const MIGRATION_USER = '00000000-0000-0000-0000-dbbill000001';

function safeDate(v) {
  if (!v || String(v).trim() === '' || String(v).includes('0000-00-00')) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  return null;
}

function periodCode(d) {
  if (!d) return null;
  return d.slice(0, 7);
}

function decodePayMode(code) {
  if (code === 1) return 'Cash';
  if (code === 2) return 'Cheque';
  if (code === 3) return 'NEFT';
  return 'Other';
}

function allocationNo(entryDate, billId) {
  const d = safeDate(entryDate);
  if (!d) return `IMP/00/00/${String(billId).padStart(5,'0')}`;
  const [y, m] = d.split('-');
  return `IMP/${m}/${y.slice(2)}/${String(billId).padStart(5,'0')}`;
}

async function main() {
  const hrms = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const bill = await mysql.createConnection({
    host: process.env.BILL_DB_HOST ?? '14.97.30.236',
    port: Number(process.env.BILL_DB_PORT ?? 3306),
    user: process.env.BILL_DB_USER, password: process.env.BILL_DB_PASSWORD,
    database: process.env.BILL_DB_NAME, connectTimeout: 30000,
  });

  console.log('\n════════════════════════════════════════════════════════');
  console.log(' Imprest Ledger Gap Backfill');
  console.log(`  Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log('════════════════════════════════════════════════════════\n');

  try {
    // ── Build branch → best-manager map ────────────────────────────────────
    const [mgrRows] = await hrms.query(`
      SELECT im.id, im.branch_id, im.tally_name, im.effective_from, im.effective_to,
             im.active_status, bm.branch_name,
             (SELECT COUNT(*) FROM imprest_transaction_ledger l WHERE l.imprest_manager_id = im.id) AS ledger_cnt
      FROM imprest_manager im
      JOIN branch_master bm ON bm.id = im.branch_id
      ORDER BY im.branch_id, (im.tally_name IS NULL) DESC, ledger_cnt DESC, im.effective_from DESC
    `);

    // best manager per branch_id: prefer NULL tally (legacy bucket), then most ledger rows
    const branchBestManager = new Map(); // branch_id → imprest_manager.id
    const branchAllManagers = new Map(); // branch_id → [{id, tally_name, effective_from, effective_to}]

    for (const mgr of mgrRows) {
      if (!branchBestManager.has(mgr.branch_id)) {
        branchBestManager.set(mgr.branch_id, mgr.id);
      }
      const list = branchAllManagers.get(mgr.branch_id) ?? [];
      list.push(mgr);
      branchAllManagers.set(mgr.branch_id, list);
    }

    console.log(`Branches with managers in mas_hrms: ${branchBestManager.size}`);

    // ═══════════════════════════════════════════════════════════════════════
    // PASS 1 — Missing GRN ledger debit entries
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n── PASS 1: GRN ledger debit entries ───────────────────');

    const [unlinkedGrns] = await hrms.query(`
      SELECT g.id, g.branch_id, g.grn_number, g.amount_with_tax, g.amount,
             g.accounting_period, g.bill_date, g.description, g.imprest_manager_id,
             g.status, bm.branch_name
      FROM grn_request g
      JOIN branch_master bm ON bm.id = g.branch_id
      WHERE g.grn_type = 'imprest'
        AND g.bill_source_id IS NOT NULL
        AND g.status != 'cancelled'
        AND NOT EXISTS (
          SELECT 1 FROM imprest_transaction_ledger l
          WHERE l.reference_type = 'grn_request' AND l.reference_id = g.id
        )
      ORDER BY g.branch_id, g.bill_date ASC, g.id ASC
    `);

    console.log(`  Unlinked GRNs found: ${unlinkedGrns.length}`);

    let grnLinked = 0, grnSkipped = 0;
    const skippedBranches = new Set();

    for (const grn of unlinkedGrns) {
      const mgrId = branchBestManager.get(grn.branch_id);
      if (!mgrId) {
        skippedBranches.add(grn.branch_name);
        grnSkipped++;
        continue;
      }

      const amt = parseFloat(String(grn.amount_with_tax ?? grn.amount ?? 0)) || 0;
      if (amt <= 0) { grnSkipped++; continue; }

      const txDate = safeDate(grn.bill_date) ?? '2017-04-01';
      const period = grn.accounting_period ?? periodCode(txDate) ?? '2017-04';
      const narration = grn.description
        ? String(grn.description).substring(0, 499)
        : `Imprest voucher ${grn.grn_number}`;

      if (APPLY) {
        await hrms.execute(`
          INSERT INTO imprest_transaction_ledger
            (id, imprest_manager_id, branch_id, entry_type, direction, amount, balance_after,
             reference_type, reference_id, period_code, transaction_date, narration,
             created_by, created_at)
          VALUES (?,?,?,'voucher','debit',?,0,
                  'grn_request',?,?,?,?,?,NOW())`,
          [uuidv4(), mgrId, grn.branch_id, amt, grn.id, period, txDate, narration, MIGRATION_USER]
        );
        // Link GRN → manager if not already set
        if (!grn.imprest_manager_id) {
          await hrms.execute(
            'UPDATE grn_request SET imprest_manager_id = ? WHERE id = ? AND imprest_manager_id IS NULL',
            [mgrId, grn.id]
          );
        }
      }
      grnLinked++;
      if (grnLinked % 50 === 0) process.stdout.write(`\r  Written: ${grnLinked}...`);
    }

    console.log(`\n  Ledger debits written : ${grnLinked}`);
    console.log(`  Skipped (no manager)  : ${grnSkipped}`);
    if (skippedBranches.size) {
      console.log(`  Branches without manager: ${[...skippedBranches].join(', ')}`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PASS 2 — Missing allotments from db_bill
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n── PASS 2: Missing allotments from db_bill ─────────────');

    // Existing bill_source_ids already imported
    const [existingAllocRows] = await hrms.query(
      'SELECT bill_source_id FROM imprest_allocation WHERE bill_source_id IS NOT NULL'
    );
    const doneBillIds = new Set(existingAllocRows.map(r => r.bill_source_id));

    // Branch map from mas_hrms
    const [branchMapRows] = await hrms.query(
      'SELECT dbbill_branch_id, hrms_branch_id FROM grn_migration_branch_map'
    );
    const branchMap = new Map(branchMapRows.map(r => [r.dbbill_branch_id, r.hrms_branch_id]));

    // Manager map: db_bill imprest_manager.Id → mas_hrms imprest_manager.id
    // Use tally_name matching (db_bill TallyHead = mas_hrms tally_name)
    const [billMgrs] = await bill.query('SELECT * FROM imprest_manager ORDER BY Id');
    const [hrmsMgrs] = await hrms.query(
      'SELECT id, tally_name FROM imprest_manager WHERE tally_name IS NOT NULL'
    );
    const tallyToHrmsId = new Map(hrmsMgrs.map(r => [String(r.tally_name).trim(), r.id]));

    // Build bill manager id → hrms manager id
    const billMgrIdMap = new Map();
    for (const bm of billMgrs) {
      const tally = String(bm.TallyHead ?? bm.UserName ?? '').trim();
      const hrmsId = tallyToHrmsId.get(tally);
      if (hrmsId) billMgrIdMap.set(bm.Id, hrmsId);
      else {
        // fallback: use branch-level best manager
        const branchId = branchMap.get(bm.BranchId);
        if (branchId && branchBestManager.has(branchId)) {
          billMgrIdMap.set(bm.Id, branchBestManager.get(branchId));
        }
      }
    }

    // Fetch all allotments from db_bill
    const [allocRows] = await bill.query(
      'SELECT * FROM imprest_allotment_master ORDER BY Id'
    );

    const missing = allocRows.filter(r => !doneBillIds.has(r.Id));
    console.log(`  db_bill allotments total  : ${allocRows.length}`);
    console.log(`  already imported          : ${doneBillIds.size}`);
    console.log(`  to import                 : ${missing.length}`);

    let allocInserted = 0, allocSkipped = 0;
    const allocSkippedBranches = new Set();

    for (const alloc of missing) {
      const hrMgrId  = billMgrIdMap.get(alloc.ImprestManagerId);
      const branchId = branchMap.get(alloc.BranchId);

      if (!hrMgrId || !branchId) {
        // Check if there's a branch manager as fallback
        const fallbackMgr = branchId ? branchBestManager.get(branchId) : null;
        if (!fallbackMgr) {
          allocSkippedBranches.add(`${alloc.Branch ?? alloc.BranchId}`);
          allocSkipped++;
          continue;
        }
      }

      const finalMgrId = hrMgrId ?? (branchId ? branchBestManager.get(branchId) : null);
      if (!finalMgrId) { allocSkipped++; continue; }

      const amount = parseFloat(String(alloc.Amount ?? 0)) || 0;
      if (amount <= 0) { allocSkipped++; continue; }

      const allocDate = safeDate(alloc.EntryDate) ?? safeDate(String(alloc.CreateDate))?.slice(0,10) ?? '2017-04-01';
      const allocNo = allocationNo(allocDate, alloc.Id);
      const payMode = decodePayMode(alloc.PaymentMode);
      const refNo = alloc.PaymentNo ? String(alloc.PaymentNo).trim() || null : null;
      const period = periodCode(allocDate);

      if (APPLY) {
        const allocId = uuidv4();
        await hrms.execute(`
          INSERT IGNORE INTO imprest_allocation
            (id, allocation_no, imprest_manager_id, branch_id, allocation_date, amount,
             payment_mode, reference_no, remarks, status, disbursed_at,
             created_by, created_at, accounting_period, bill_source_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            allocId, allocNo, finalMgrId, branchId, allocDate, amount,
            payMode, refNo,
            alloc.Remarks ? String(alloc.Remarks).trim().substring(0,500) : null,
            'disbursed',
            alloc.CreateDate ? new Date(alloc.CreateDate) : new Date(),
            MIGRATION_USER,
            alloc.CreateDate ? new Date(alloc.CreateDate) : new Date(),
            period, alloc.Id,
          ]
        );

        // Ledger credit entry
        await hrms.execute(`
          INSERT INTO imprest_transaction_ledger
            (id, imprest_manager_id, branch_id, entry_type, direction, amount, balance_after,
             reference_type, reference_id, period_code, transaction_date, narration,
             created_by, created_at)
          VALUES (?,?,?,'allocation','credit',?,0,
                  'imprest_allocation',?,?,?,?,?,NOW())`,
          [
            uuidv4(), finalMgrId, branchId, amount,
            allocId, period, allocDate,
            alloc.Remarks ? String(alloc.Remarks).trim().substring(0,499) : `Float allocation ${allocNo}`,
            MIGRATION_USER,
          ]
        );
      }
      allocInserted++;
      doneBillIds.add(alloc.Id);

      if (allocInserted % 50 === 0) process.stdout.write(`\r  Allotments: ${allocInserted}...`);
    }

    console.log(`\n  Allotments imported       : ${allocInserted}`);
    console.log(`  Allotments skipped        : ${allocSkipped}`);
    if (allocSkippedBranches.size) {
      console.log(`  Skipped branches (no mgr) : ${[...allocSkippedBranches].join(', ')}`);
    }

    // ── Summary ───────────────────────────────────────────────────────────
    console.log('\n════════════════════════════════════════════════════════');
    console.log(` SUMMARY — ${APPLY ? 'APPLIED' : 'DRY RUN'}`);
    console.log('════════════════════════════════════════════════════════');
    console.log(` GRN ledger debits written  : ${grnLinked}`);
    console.log(` Allotments imported        : ${allocInserted}`);
    if (!APPLY) {
      console.log('\n DRY RUN — nothing written. Re-run with --apply to execute.\n');
    } else {
      console.log('\n Backfill complete.\n');
      // Report new ledger total
      const [[totals]] = await hrms.query(
        'SELECT COUNT(*) cnt FROM imprest_transaction_ledger'
      );
      console.log(` imprest_transaction_ledger rows now: ${totals.cnt}\n`);
    }

  } finally {
    await hrms.end();
    await bill.end();
  }
}

main().catch(err => {
  console.error('\nBACKFILL FAILED:', err.message ?? err);
  process.exit(1);
});
