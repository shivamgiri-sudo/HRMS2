/**
 * migrate-imprest-active-branches.cjs
 *
 * Migrates imprest data from db_bill → mas_hrms for ACTIVE branches only.
 * Creates auth_users for managers who don't have them.
 *
 * USAGE:
 *   node backend/scripts/migrate-imprest-active-branches.cjs          # dry-run
 *   node backend/scripts/migrate-imprest-active-branches.cjs --apply  # execute
 */

const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const APPLY = process.argv.includes('--apply');
const MIGRATION_USER = '00000000-0000-0000-0000-dbbill000001';

// Active branch db_bill IDs: HEAD OFFICE (3,10), NOIDA (9), DIALDESK (16), JALDARSHAN (18), NOIDA-2 (19)
const ACTIVE_BRANCH_IDS = [3, 9, 10, 16, 18, 19];

function safeDate(v) {
  if (!v || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  return null;
}

function allocationNo(entryDate, billId) {
  const d = safeDate(entryDate);
  if (!d) return `IMP/00/00/${String(billId).padStart(5,'0')}`;
  const [y, m] = d.split('-');
  const yy = y.slice(2);
  return `IMP/${m}/${yy}/${String(billId).padStart(5,'0')}`;
}

function decodePayMode(code) {
  if (code === 1) return 'Cash';
  if (code === 2) return 'Cheque';
  if (code === 3) return 'NEFT';
  return 'Other';
}

async function main() {
  const hrms = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const bill = await mysql.createConnection({
    host: '14.97.30.236',
    port: 3306,
    user: 'shivam_user',
    password: 'qwersdfg!@#hjk',
    database: 'db_bill',
    connectTimeout: 30000,
  });

  try {
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(' IMPREST MIGRATION FOR ACTIVE BRANCHES ONLY');
    console.log('══════════════════════════════════════════════════════════════');
    console.log(` Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
    console.log(` Active branch IDs: ${ACTIVE_BRANCH_IDS.join(', ')}`);
    console.log('══════════════════════════════════════════════════════════════\n');

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 1: Load lookup maps
    // ─────────────────────────────────────────────────────────────────────────

    // Branch map
    const [branchRows] = await hrms.query(
      'SELECT dbbill_branch_id, hrms_branch_id FROM grn_migration_branch_map WHERE dbbill_branch_id IN (?)',
      [ACTIVE_BRANCH_IDS]
    );
    const branchMap = new Map(branchRows.map(r => [r.dbbill_branch_id, r.hrms_branch_id]));
    console.log(`Branch mappings loaded: ${branchMap.size}`);

    // Existing auth_users by email
    const [authRows] = await hrms.query('SELECT id, email FROM auth_user');
    const authByEmail = new Map(authRows.map(r => [String(r.email || '').toLowerCase().trim(), r.id]));

    // Employees by email (for linking)
    const [empRows] = await hrms.query('SELECT id, email FROM employees WHERE email IS NOT NULL');
    const empByEmail = new Map(empRows.map(r => [String(r.email || '').toLowerCase().trim(), r.id]));

    // Existing imprest_managers by tally_name
    const [existingMgrs] = await hrms.query('SELECT id, tally_name FROM imprest_manager WHERE tally_name IS NOT NULL');
    const mgrByTally = new Map(existingMgrs.map(r => [String(r.tally_name), r.id]));

    // Already-migrated allocations
    const [existingAllocs] = await hrms.query('SELECT bill_source_id FROM imprest_allocation WHERE bill_source_id IS NOT NULL');
    const doneBillIds = new Set(existingAllocs.map(r => r.bill_source_id));

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 2: Load db_bill data for active branches
    // ─────────────────────────────────────────────────────────────────────────

    const [billMgrs] = await bill.query(
      'SELECT * FROM imprest_manager WHERE BranchId IN (?) ORDER BY Id',
      [ACTIVE_BRANCH_IDS]
    );
    console.log(`db_bill imprest_managers for active branches: ${billMgrs.length}`);

    const [billAllocs] = await bill.query(
      'SELECT * FROM imprest_allotment_master WHERE BranchId IN (?) ORDER BY Id',
      [ACTIVE_BRANCH_IDS]
    );
    console.log(`db_bill imprest_allotment_master for active branches: ${billAllocs.length}`);
    console.log(`Already migrated: ${[...doneBillIds].filter(id => billAllocs.some(a => a.Id === id)).length}`);

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 3: Create auth_users for managers without them
    // ─────────────────────────────────────────────────────────────────────────

    console.log('\n─── PHASE 3: Auth User Creation ───────────────────────────────');
    let authCreated = 0, authLinked = 0, authSkipped = 0;

    for (const mgr of billMgrs) {
      const email = String(mgr.EmailId || '').toLowerCase().trim();
      if (!email) continue;

      // Skip if already has auth_user
      if (authByEmail.has(email)) {
        authSkipped++;
        continue;
      }

      const empId = empByEmail.get(email) || null;
      const displayName = mgr.UserName || mgr.TallyHead || email.split('@')[0];

      if (APPLY) {
        const authId = uuidv4();
        await hrms.execute(
          `INSERT INTO auth_user (id, email, password_hash, is_blocked, created_at)
           VALUES (?, ?, ?, ?, NOW())`,
          [
            authId,
            email,
            '$2b$10$LEGACY_IMPREST_USER_NO_LOGIN', // Invalid hash = no login
            1, // Blocked - cannot login
          ]
        );
        authByEmail.set(email, authId);
        if (empId) authLinked++;
        else authCreated++;
        console.log(`  Created auth_user: ${email} ${empId ? '(linked to employee)' : '(legacy)'}`);
      } else {
        if (empId) authLinked++;
        else authCreated++;
        console.log(`  [DRY] Would create auth_user: ${email} ${empId ? '(link to employee)' : '(legacy)'}`);
      }
    }

    console.log(`Auth users: ${authCreated} created, ${authLinked} linked to employees, ${authSkipped} already exist`);

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 4: Migrate imprest_managers
    // ─────────────────────────────────────────────────────────────────────────

    console.log('\n─── PHASE 4: Imprest Manager Migration ────────────────────────');
    let mgrInserted = 0, mgrSkipped = 0;
    const mgrIdMap = new Map(); // db_bill Id → hrms UUID

    for (const mgr of billMgrs) {
      const tallyName = String(mgr.TallyHead || mgr.UserName || '').trim();
      const email = String(mgr.EmailId || '').toLowerCase().trim();
      const branchId = branchMap.get(mgr.BranchId);

      if (!branchId) {
        console.log(`  Skip manager ${mgr.Id}: no branch mapping for ${mgr.BranchId}`);
        mgrSkipped++;
        continue;
      }

      const userId = authByEmail.get(email);
      if (!userId) {
        console.log(`  Skip manager ${mgr.Id}: no auth_user for ${email}`);
        mgrSkipped++;
        continue;
      }

      // Check if already exists
      if (mgrByTally.has(tallyName)) {
        mgrIdMap.set(mgr.Id, mgrByTally.get(tallyName));
        mgrSkipped++;
        continue;
      }

      const mgrUuid = uuidv4();
      mgrIdMap.set(mgr.Id, mgrUuid);

      if (APPLY) {
        await hrms.execute(
          `INSERT IGNORE INTO imprest_manager (
             id, branch_id, user_id, employee_id, tally_name,
             effective_from, effective_to, active_status, created_by, created_at
           ) VALUES (?,?,?,NULL,?,?,NULL,?,?,?)`,
          [
            mgrUuid, branchId, userId, tallyName,
            mgr.CreateDate ? new Date(mgr.CreateDate).toISOString().split('T')[0] : '2017-04-01',
            mgr.Active === 1 ? 1 : 0,
            MIGRATION_USER,
            mgr.CreateDate ? new Date(mgr.CreateDate) : new Date(),
          ]
        );
        mgrByTally.set(tallyName, mgrUuid);
      }
      mgrInserted++;
      console.log(`  ${APPLY ? 'Inserted' : '[DRY] Would insert'} manager: ${tallyName} (${mgr.Branch})`);
    }

    // Reload mgrIdMap after inserts
    if (APPLY) {
      const [finalMgrs] = await hrms.query('SELECT id, tally_name FROM imprest_manager WHERE tally_name IS NOT NULL');
      for (const mgr of billMgrs) {
        const tallyName = String(mgr.TallyHead || mgr.UserName || '').trim();
        const found = finalMgrs.find(r => String(r.tally_name) === tallyName);
        if (found) mgrIdMap.set(mgr.Id, found.id);
      }
    }

    console.log(`Managers: ${mgrInserted} inserted, ${mgrSkipped} skipped`);

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 5: Migrate imprest_allocations
    // ─────────────────────────────────────────────────────────────────────────

    console.log('\n─── PHASE 5: Imprest Allocation Migration ─────────────────────');
    let allocInserted = 0, allocSkipped = 0;
    const managerBalance = new Map();

    for (const alloc of billAllocs) {
      const billId = alloc.Id;
      if (doneBillIds.has(billId)) {
        allocSkipped++;
        continue;
      }

      const hrMgrId = mgrIdMap.get(alloc.ImprestManagerId);
      const branchId = branchMap.get(alloc.BranchId);

      if (!hrMgrId || !branchId) {
        allocSkipped++;
        continue;
      }

      const amount = parseFloat(String(alloc.Amount ?? 0)) || 0;
      const allocDate = safeDate(alloc.EntryDate) ?? safeDate(alloc.CreateDate) ?? '2017-04-01';
      const allocNo = allocationNo(allocDate, billId);
      const payMode = decodePayMode(alloc.PaymentMode);
      const refNo = alloc.PaymentNo ? String(alloc.PaymentNo).trim() || null : null;
      const [, mm, yy] = allocNo.match(/IMP\/(\d{2})\/(\d{2})\//) ?? ['','00','00'];
      const periodFull = yy ? `20${yy}-${mm}` : null;

      if (APPLY) {
        const allocId = uuidv4();
        await hrms.execute(
          `INSERT IGNORE INTO imprest_allocation (
             id, allocation_no, imprest_manager_id, branch_id,
             allocation_date, amount, payment_mode, reference_no,
             remarks, status,
             disbursed_at, created_by, created_at, accounting_period,
             bill_source_id
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            allocId, allocNo, hrMgrId, branchId,
            allocDate, amount, payMode, refNo,
            alloc.Remarks ? String(alloc.Remarks).trim().substring(0, 500) : null,
            'disbursed',
            alloc.CreateDate ? new Date(alloc.CreateDate) : new Date(),
            MIGRATION_USER,
            alloc.CreateDate ? new Date(alloc.CreateDate) : new Date(),
            periodFull,
            billId,
          ]
        );

        // Ledger entry
        const prevBalance = managerBalance.get(hrMgrId) ?? 0;
        const newBalance = prevBalance + amount;
        managerBalance.set(hrMgrId, newBalance);
        const ledgerDir = amount >= 0 ? 'credit' : 'debit';
        const ledgerType = amount >= 0 ? 'allocation' : 'return';

        await hrms.execute(
          `INSERT INTO imprest_transaction_ledger (
             id, imprest_manager_id, branch_id,
             entry_type, direction, amount, balance_after,
             reference_type, reference_id,
             period_code, transaction_date, narration,
             created_by, created_at
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            uuidv4(), hrMgrId, branchId,
            ledgerType, ledgerDir,
            Math.abs(amount), newBalance,
            'imprest_allocation', allocId,
            periodFull, allocDate,
            alloc.Remarks ? String(alloc.Remarks).trim().substring(0, 499) : `Float allocation ${allocNo}`,
            MIGRATION_USER,
            alloc.CreateDate ? new Date(alloc.CreateDate) : new Date(),
          ]
        );
      }

      allocInserted++;
      doneBillIds.add(billId);

      if (allocInserted % 100 === 0) {
        process.stdout.write(`\r  Progress: ${allocInserted} allocations...`);
      }
    }

    console.log(`\nAllocations: ${allocInserted} inserted, ${allocSkipped} skipped`);

    // ─────────────────────────────────────────────────────────────────────────
    // SUMMARY
    // ─────────────────────────────────────────────────────────────────────────

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(' MIGRATION SUMMARY');
    console.log('══════════════════════════════════════════════════════════════');
    console.log(` Auth users created/linked : ${authCreated + authLinked}`);
    console.log(` Imprest managers inserted : ${mgrInserted}`);
    console.log(` Allocations inserted      : ${allocInserted}`);
    console.log(` Allocations skipped       : ${allocSkipped}`);

    if (!APPLY) {
      console.log('\n DRY RUN complete — nothing written.');
      console.log(' Re-run with --apply to execute.\n');
    } else {
      console.log('\n Migration complete.\n');
    }

  } finally {
    await hrms.end();
    await bill.end();
  }
}

main().catch(err => {
  console.error('\nMIGRATION FAILED:', err.message ?? err);
  process.exit(1);
});
