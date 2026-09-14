/**
 * backfill-imprest-all-branches.cjs
 *
 * Imports imprest data for ALL db_bill branches that have no imprest_manager
 * in mas_hrms yet (JAIPUR, HYDERABAD, MOHALI, AHMEDABAD HOUSE, AHMEDABAD OTHERS,
 * AHMEDABAD-NEELAKANTH, JAIPUR IDC and any others).
 *
 * For each unmanaged branch:
 *   1. Creates one stub auth_user per db_bill manager (non-login, hash = INVALID)
 *   2. Creates an imprest_manager record linked to that auth_user
 *   3. Imports imprest_allotment_master (credit entries + ledger)
 *   4. Links all imprest GRNs for that branch to the primary manager + writes
 *      debit ledger entries
 *
 * "Primary manager" per branch = the db_bill manager with the most allotments.
 * When a branch has multiple managers in db_bill, all get records so the
 * correct split can be maintained going forward.
 *
 * USAGE
 *   node backend/scripts/backfill-imprest-all-branches.cjs          # dry-run
 *   node backend/scripts/backfill-imprest-all-branches.cjs --apply  # execute
 *
 * Idempotent: tally_name + branch duplicate check guards imprest_manager;
 * bill_source_id guards imprest_allocation; reference_id guards ledger debits.
 *
 * The stub auth_user password hash is intentionally invalid — these accounts
 * can never be used to log in. They exist solely to satisfy the NOT NULL
 * constraint and to allow the manager record to be transferred to a real user
 * by an admin setting the user_id column later.
 */

'use strict';
const mysql  = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const APPLY          = process.argv.includes('--apply');
const MIGRATION_USER = '00000000-0000-0000-0000-dbbill000001';
const INVALID_HASH   = '$2b$10$LEGACY.IMPREST.NO.LOGIN.xxxxxxxxxxxxxxxxxxxxxxxxxxx';

// ── helpers ───────────────────────────────────────────────────────────────────

function safeDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s || s.startsWith('0000')) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  try { const d = new Date(s); if (!isNaN(d)) return d.toISOString().slice(0,10); } catch(_) {}
  return null;
}

function periodCode(d) { return d ? d.slice(0,7) : null; }

function decodePayMode(code) {
  if (code === 1) return 'Cash';
  if (code === 2) return 'Cheque';
  if (code === 3) return 'NEFT';
  return 'Other';
}

function allocationNo(date, billId) {
  const d = safeDate(date);
  if (!d) return `IMP/00/00/${String(billId).padStart(5,'0')}`;
  const [y, m] = d.split('-');
  return `IMP/${m}/${y.slice(2)}/${String(billId).padStart(5,'0')}`;
}

// ── main ──────────────────────────────────────────────────────────────────────

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
  console.log(' Imprest All-Branch Backfill');
  console.log(`  Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log('════════════════════════════════════════════════════════\n');

  try {
    // ── Load branch map ────────────────────────────────────────────────────
    const [branchMapRows] = await hrms.query(
      'SELECT dbbill_branch_id, hrms_branch_id FROM grn_migration_branch_map'
    );
    const branchMap = new Map(branchMapRows.map(r => [r.dbbill_branch_id, r.hrms_branch_id]));

    // ── Already managed branches (tally_name IS NOT NULL → migration ran) ─
    const [existingMgrRows] = await hrms.query(
      'SELECT id, tally_name, branch_id FROM imprest_manager WHERE tally_name IS NOT NULL'
    );
    const existingTallyNames = new Set(existingMgrRows.map(r => String(r.tally_name)));
    const tallyToHrmsId = new Map(existingMgrRows.map(r => [String(r.tally_name), r.id]));

    // Already-migrated allocations
    const [existingAllocRows] = await hrms.query(
      'SELECT bill_source_id FROM imprest_allocation WHERE bill_source_id IS NOT NULL'
    );
    const doneBillAllocIds = new Set(existingAllocRows.map(r => r.bill_source_id));

    // Existing auth_user emails
    const [authRows] = await hrms.query('SELECT id, email FROM auth_user');
    const authByEmail = new Map(authRows.map(r => [String(r.email||'').toLowerCase().trim(), r.id]));

    // ── Load db_bill data ──────────────────────────────────────────────────
    const [billMgrs] = await bill.query('SELECT * FROM imprest_manager ORDER BY Id');
    const [billAllocs] = await bill.query(
      'SELECT * FROM imprest_allotment_master ORDER BY Id'
    );

    // Which branches have managers in mas_hrms already (tally-name matched)?
    const coveredBranchIds = new Set(existingMgrRows.map(r => r.branch_id));

    // Unmanaged bill branches: branches where NO manager is in mas_hrms yet
    const unmanagedBillBranches = new Set();
    for (const bm of billMgrs) {
      const hrsBranchId = branchMap.get(bm.BranchId);
      if (!hrsBranchId) continue; // no branch map entry
      if (!coveredBranchIds.has(hrsBranchId)) {
        unmanagedBillBranches.add(bm.BranchId);
      }
    }

    console.log(`Total db_bill managers  : ${billMgrs.length}`);
    console.log(`Existing tally mappings : ${existingTallyNames.size}`);
    console.log(`Unmanaged bill branches : ${unmanagedBillBranches.size}`);
    console.log(`Branches: ${[...unmanagedBillBranches].map(id => billMgrs.find(m=>m.BranchId===id)?.Branch ?? id).filter((v,i,a)=>a.indexOf(v)===i).join(', ')}\n`);

    // ── PHASE 1: Create managers for unmanaged branches ───────────────────
    console.log('── PHASE 1: Create imprest_manager records ──────────────');

    // db_bill manager Id → mas_hrms manager UUID
    const mgrIdMap = new Map();

    // Pre-populate from existing
    for (const bm of billMgrs) {
      const tally = String(bm.TallyHead ?? bm.UserName ?? '').trim();
      const hrmsId = tallyToHrmsId.get(tally);
      if (hrmsId) mgrIdMap.set(bm.Id, hrmsId);
    }

    let mgrCreated = 0, mgrSkipped = 0;

    for (const bm of billMgrs) {
      const hrsBranchId = branchMap.get(bm.BranchId);
      if (!hrsBranchId) { mgrSkipped++; continue; }
      if (!unmanagedBillBranches.has(bm.BranchId)) {
        mgrSkipped++;
        continue; // already managed
      }

      const tally   = String(bm.TallyHead ?? bm.UserName ?? '').trim();
      const email   = String(bm.EmailId ?? '').toLowerCase().trim();

      if (existingTallyNames.has(tally)) {
        const existId = tallyToHrmsId.get(tally);
        if (existId) mgrIdMap.set(bm.Id, existId);
        mgrSkipped++;
        continue;
      }

      if (APPLY) {
        // Find or create auth_user for this manager
        let userId = email ? authByEmail.get(email) : null;
        if (!userId) {
          // Create stub auth_user (cannot log in)
          const stubEmail = email || `imprest.stub.${bm.Id}@legacy.mas`;
          userId = uuidv4();
          await hrms.execute(
            `INSERT IGNORE INTO auth_user (id, email, password_hash, is_blocked, created_at)
             VALUES (?, ?, ?, 1, NOW())`,
            [userId, stubEmail, INVALID_HASH]
          );
          authByEmail.set(stubEmail.toLowerCase(), userId);
        }

        const mgrUuid = uuidv4();
        const effectiveFrom = safeDate(bm.CreateDate)?.slice(0,10) ?? '2017-04-01';
        await hrms.execute(
          `INSERT IGNORE INTO imprest_manager
             (id, branch_id, user_id, employee_id, tally_name, effective_from, effective_to,
              active_status, created_by, created_at)
           VALUES (?,?,?,NULL,?,?,NULL,?,?,?)`,
          [mgrUuid, hrsBranchId, userId, tally, effectiveFrom,
           bm.Active === 1 ? 1 : 0, MIGRATION_USER, new Date()]
        );
        mgrIdMap.set(bm.Id, mgrUuid);
        existingTallyNames.add(tally);
        tallyToHrmsId.set(tally, mgrUuid);
        coveredBranchIds.add(hrsBranchId);
      } else {
        // Dry-run: just assign a temp UUID for counting
        const dryId = uuidv4();
        mgrIdMap.set(bm.Id, dryId);
      }
      mgrCreated++;
    }

    console.log(`  Managers created : ${mgrCreated}`);
    console.log(`  Managers skipped : ${mgrSkipped}\n`);

    // ── Build per-branch primary manager ─────────────────────────────────
    // Primary manager per branch = manager with most allotments in db_bill
    const branchAllocCount = new Map(); // hrsBranchId → { mgrId, count }
    for (const alloc of billAllocs) {
      const hrsBranchId = branchMap.get(alloc.BranchId);
      const hrsMgrId = mgrIdMap.get(alloc.ImprestManagerId);
      if (!hrsBranchId || !hrsMgrId) continue;
      const key = hrsBranchId;
      const cur = branchAllocCount.get(key);
      if (!cur || cur.count < 1) {
        const cnt = billAllocs.filter(a => a.ImprestManagerId === alloc.ImprestManagerId).length;
        if (!cur || cnt > cur.count) {
          branchAllocCount.set(key, { mgrId: hrsMgrId, count: cnt });
        }
      }
    }
    // fallback: first manager for the branch
    const branchPrimaryMgr = new Map(); // hrsBranchId → hrsMgrId
    for (const [branchId, info] of branchAllocCount) branchPrimaryMgr.set(branchId, info.mgrId);
    // also add from mgrIdMap for branches not in allocs
    for (const bm of billMgrs) {
      const hrsBranchId = branchMap.get(bm.BranchId);
      const hrsMgrId = mgrIdMap.get(bm.Id);
      if (hrsBranchId && hrsMgrId && !branchPrimaryMgr.has(hrsBranchId)) {
        branchPrimaryMgr.set(hrsBranchId, hrsMgrId);
      }
    }

    // ── PHASE 2: Import missing allotments ────────────────────────────────
    console.log('── PHASE 2: Import missing allotments ───────────────────');

    const missingAllocs = billAllocs.filter(a => !doneBillAllocIds.has(a.Id));
    console.log(`  db_bill allotments : ${billAllocs.length}`);
    console.log(`  already imported   : ${doneBillAllocIds.size}`);
    console.log(`  to import          : ${missingAllocs.length}`);

    let allocInserted = 0, allocSkipped = 0;

    for (const alloc of missingAllocs) {
      const hrsBranchId = branchMap.get(alloc.BranchId);
      const hrsMgrId    = mgrIdMap.get(alloc.ImprestManagerId) ??
                          (hrsBranchId ? branchPrimaryMgr.get(hrsBranchId) : null);
      if (!hrsBranchId || !hrsMgrId) { allocSkipped++; continue; }

      const amount = parseFloat(String(alloc.Amount ?? 0)) || 0;
      if (amount <= 0) { allocSkipped++; continue; }

      const allocDate = safeDate(alloc.EntryDate) ??
                        safeDate(String(alloc.CreateDate))?.slice(0,10) ?? '2017-04-01';
      const allocNo   = allocationNo(allocDate, alloc.Id);
      const payMode   = decodePayMode(alloc.PaymentMode);
      const refNo     = alloc.PaymentNo ? String(alloc.PaymentNo).trim() || null : null;
      const period    = periodCode(allocDate);

      if (APPLY) {
        const allocId = uuidv4();
        await hrms.execute(
          `INSERT IGNORE INTO imprest_allocation
             (id, allocation_no, imprest_manager_id, branch_id, allocation_date, amount,
              payment_mode, reference_no, remarks, status, disbursed_at,
              created_by, created_at, accounting_period, bill_source_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            allocId, allocNo, hrsMgrId, hrsBranchId, allocDate, amount,
            payMode, refNo,
            alloc.Remarks ? String(alloc.Remarks).trim().substring(0,500) : null,
            'disbursed',
            alloc.CreateDate ? new Date(alloc.CreateDate) : new Date(),
            MIGRATION_USER, alloc.CreateDate ? new Date(alloc.CreateDate) : new Date(),
            period, alloc.Id,
          ]
        );
        // Ledger credit
        await hrms.execute(
          `INSERT INTO imprest_transaction_ledger
             (id, imprest_manager_id, branch_id, entry_type, direction, amount, balance_after,
              reference_type, reference_id, period_code, transaction_date, narration,
              created_by, created_at)
           VALUES (?,?,?,'allocation','credit',?,0,'imprest_allocation',?,?,?,?,?,NOW())`,
          [
            uuidv4(), hrsMgrId, hrsBranchId, amount, allocId, period, allocDate,
            alloc.Remarks ? String(alloc.Remarks).trim().substring(0,499) : `Float allocation ${allocNo}`,
            MIGRATION_USER,
          ]
        );
        doneBillAllocIds.add(alloc.Id);
      }
      allocInserted++;
      if (allocInserted % 100 === 0) process.stdout.write(`\r  Allotments: ${allocInserted}...`);
    }
    console.log(`\n  Allotments imported : ${allocInserted}`);
    console.log(`  Allotments skipped  : ${allocSkipped}\n`);

    // ── PHASE 3: Link unlinked GRNs + write debit ledger entries ─────────
    console.log('── PHASE 3: GRN ledger debit entries ────────────────────');

    const [unlinkedGrns] = await hrms.query(`
      SELECT g.id, g.branch_id, g.grn_number, g.amount_with_tax, g.amount,
             g.accounting_period, g.bill_date, g.description, bm.branch_name
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

    console.log(`  Unlinked GRNs found : ${unlinkedGrns.length}`);

    let grnLinked = 0, grnSkipped = 0;
    const grnSkippedBranches = new Set();

    for (const grn of unlinkedGrns) {
      const mgrId = branchPrimaryMgr.get(grn.branch_id);
      if (!mgrId) {
        grnSkippedBranches.add(grn.branch_name);
        grnSkipped++;
        continue;
      }

      const amt     = parseFloat(String(grn.amount_with_tax ?? grn.amount ?? 0)) || 0;
      if (amt <= 0) { grnSkipped++; continue; }
      const txDate  = safeDate(grn.bill_date) ?? '2017-04-01';
      const period  = grn.accounting_period ?? periodCode(txDate) ?? '2017-04';
      const narration = grn.description
        ? String(grn.description).substring(0, 499)
        : `Imprest voucher ${grn.grn_number}`;

      if (APPLY) {
        await hrms.execute(
          `INSERT INTO imprest_transaction_ledger
             (id, imprest_manager_id, branch_id, entry_type, direction, amount, balance_after,
              reference_type, reference_id, period_code, transaction_date, narration,
              created_by, created_at)
           VALUES (?,?,?,'voucher','debit',?,0,'grn_request',?,?,?,?,?,NOW())`,
          [uuidv4(), mgrId, grn.branch_id, amt, grn.id, period, txDate, narration, MIGRATION_USER]
        );
        await hrms.execute(
          'UPDATE grn_request SET imprest_manager_id = ? WHERE id = ? AND imprest_manager_id IS NULL',
          [mgrId, grn.id]
        );
      }
      grnLinked++;
      if (grnLinked % 200 === 0) process.stdout.write(`\r  GRN ledger entries: ${grnLinked}...`);
    }

    console.log(`\n  GRN debits written  : ${grnLinked}`);
    console.log(`  GRN debits skipped  : ${grnSkipped}`);
    if (grnSkippedBranches.size) {
      console.log(`  Still no manager    : ${[...grnSkippedBranches].join(', ')}`);
    }

    // ── Summary ───────────────────────────────────────────────────────────
    console.log('\n════════════════════════════════════════════════════════');
    console.log(` SUMMARY — ${APPLY ? 'APPLIED' : 'DRY RUN'}`);
    console.log('════════════════════════════════════════════════════════');
    console.log(` Managers created               : ${mgrCreated}`);
    console.log(` Allotments imported            : ${allocInserted}`);
    console.log(` GRN ledger debits written      : ${grnLinked}`);

    if (APPLY) {
      const [[tot]] = await hrms.query('SELECT COUNT(*) cnt FROM imprest_transaction_ledger');
      const [[mgrtot]] = await hrms.query('SELECT COUNT(*) cnt FROM imprest_manager');
      console.log(` imprest_manager rows now       : ${mgrtot.cnt}`);
      console.log(` imprest_transaction_ledger now : ${tot.cnt}`);
      console.log('\n Backfill complete.\n');
    } else {
      console.log('\n DRY RUN — nothing written. Re-run with --apply to execute.\n');
    }

  } finally {
    await hrms.end();
    await bill.end();
  }
}

main().catch(err => {
  console.error('\nBACKFILL FAILED:', err.message ?? err);
  console.error(err.stack ?? '');
  process.exit(1);
});
