/**
 * migrate-imprest-from-dbbill.ts
 *
 * Migrates imprest managers and float allocations from db_bill → mas_hrms.
 *
 *   db_bill.imprest_manager          (50 rows) → mas_hrms.imprest_manager
 *   db_bill.imprest_allotment_master (2,820 rows) → mas_hrms.imprest_allocation
 *                                               + mas_hrms.imprest_transaction_ledger
 *
 * USAGE
 *   npx ts-node backend/scripts/migrate-imprest-from-dbbill.ts            # dry-run
 *   npx ts-node backend/scripts/migrate-imprest-from-dbbill.ts --apply    # write
 *
 * PREREQUISITES
 *   Migration 1248 must be applied (adds bill_source_id on imprest_allocation +
 *   branch map table + sentinel user).
 *   Must run AFTER migrate-grn-from-dbbill.ts --apply (imprest GRN vouchers needed
 *   for the ledger debit entries).
 *   Idempotent: existing rows matched by bill_source_id or allocation_no are skipped.
 *
 * PaymentMode decode (verified from tbl_payment sample + UTR number patterns):
 *   1 = Cash     (no bank, no UTR)
 *   2 = Cheque   (BankId present but PaymentNo blank / short reference)
 *   3 = NEFT     (PaymentNo = long UTR/transaction reference)
 */

import mysql from 'mysql2/promise';
import 'dotenv/config';
import { v4 as uuidv4 } from 'uuid';

const APPLY = process.argv.includes('--apply');
const MIGRATION_USER = '00000000-0000-0000-0000-dbbill000001';

type ImprestPayMode = 'Cash' | 'Cheque' | 'NEFT' | 'Other';
function decodePayMode(code: number | null): ImprestPayMode {
  if (code === 1) return 'Cash';
  if (code === 2) return 'Cheque';
  if (code === 3) return 'NEFT';
  return 'Other';
}

function safeDate(v: unknown): string | null {
  if (!v || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  return null;
}

// Format: IMP/MM/YY/NNNNN (e.g. IMP/04/17/00004 — zero-padded 5 digits for historical)
function allocationNo(entryDate: string | null, billId: number): string {
  const d = safeDate(entryDate);
  if (!d) return `IMP/00/00/${String(billId).padStart(5,'0')}`;
  const [y, m] = d.split('-');
  const yy = y.slice(2);
  return `IMP/${m}/${yy}/${String(billId).padStart(5,'0')}`;
}

async function main() {
  const hrms = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const bill = await mysql.createConnection({
    host: process.env.BILL_DB_HOST, port: Number(process.env.BILL_DB_PORT ?? 3306),
    user: process.env.BILL_DB_USER, password: process.env.BILL_DB_PASSWORD, database: process.env.BILL_DB_NAME,
  });

  try {
    // ── Load lookup maps ───────────────────────────────────────────────────

    // Branch map
    const [branchRows] = await hrms.query<any[]>(
      'SELECT dbbill_branch_id, hrms_branch_id FROM grn_migration_branch_map'
    );
    const branchMap = new Map<number, string>(branchRows.map(r => [r.dbbill_branch_id, r.hrms_branch_id]));

    // Existing auth_users by email (for manager matching)
    const [authRows] = await hrms.query<any[]>('SELECT id, email FROM auth_user');
    const authByEmail = new Map<string, string>(
      authRows.map(r => [String(r.email).toLowerCase().trim(), r.id as string])
    );

    // Already-migrated imprest_managers: set of bill source user+branch combos
    // We use tally_name as a proxy since we store it from db_bill
    const [existingMgrRows] = await hrms.query<any[]>(
      "SELECT tally_name FROM imprest_manager WHERE tally_name IS NOT NULL"
    );
    const existingTallyNames = new Set<string>(existingMgrRows.map(r => String(r.tally_name)));

    // Already-migrated allocations
    const [existingAllocRows] = await hrms.query<any[]>(
      'SELECT bill_source_id FROM imprest_allocation WHERE bill_source_id IS NOT NULL'
    );
    const doneBillIds = new Set<number>(existingAllocRows.map(r => r.bill_source_id as number));

    // ── Load db_bill imprest_manager ───────────────────────────────────────
    const [mgrRows] = await bill.query<any[]>(
      'SELECT * FROM imprest_manager ORDER BY Id'
    );

    // ── Load db_bill imprest_allotment_master ──────────────────────────────
    const [allocRows] = await bill.query<any[]>(
      'SELECT * FROM imprest_allotment_master ORDER BY Id'
    );

    console.log('\n────────────────────────────────────────────────────────');
    console.log(' db_bill → mas_hrms Imprest migration');
    console.log('────────────────────────────────────────────────────────');
    console.log(` Mode              : ${APPLY ? 'APPLY' : 'DRY RUN'}`);
    console.log(` imprest_manager   : ${mgrRows.length} source rows`);
    console.log(` imprest_allocation: ${allocRows.length} source rows (${doneBillIds.size} already done)`);
    console.log('────────────────────────────────────────────────────────\n');

    // ── Phase 1: Migrate imprest_manager ──────────────────────────────────
    let mgrInserted  = 0;
    let mgrSkipped   = 0;
    let mgrNoAuth    = 0;
    // db_bill imprest_manager.Id → mas_hrms imprest_manager.id (UUID)
    const mgrIdMap = new Map<number, string>();

    // Populate mgrIdMap from ALREADY existing rows first (idempotency)
    const [existingFullMgrRows] = await hrms.query<any[]>(
      "SELECT id, tally_name FROM imprest_manager WHERE tally_name IS NOT NULL"
    );
    // We can't perfectly identify by bill source since we didn't store bill_source_id on imprest_manager in 1248.
    // Use tally_name as the dedupe key (matches db_bill TallyHead).

    for (const mgr of mgrRows) {
      const tallyName = String(mgr.TallyHead ?? mgr.UserName ?? '').trim();
      const email     = String(mgr.EmailId ?? '').trim().toLowerCase();
      const branchId  = branchMap.get(mgr.BranchId as number);

      if (!branchId) {
        mgrSkipped++;
        continue;
      }

      // Find matching auth_user by email — skip if no match (no stub accounts created)
      const userId = authByEmail.get(email) ?? null;
      if (!userId) {
        mgrNoAuth++;
        mgrSkipped++;
        continue;
      }

      // Skip if tally_name already present (previous run)
      if (existingTallyNames.has(tallyName)) {
        // Still need to populate mgrIdMap — find existing row
        const existing = existingFullMgrRows.find(r => String(r.tally_name) === tallyName);
        if (existing) mgrIdMap.set(mgr.Id as number, existing.id as string);
        mgrSkipped++;
        continue;
      }

      const mgrUuid = uuidv4();
      mgrIdMap.set(mgr.Id as number, mgrUuid);

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
        existingTallyNames.add(tallyName);
      }

      mgrInserted++;
    }

    // Load final mgrIdMap for allocations (covers both new inserts + pre-existing)
    if (APPLY) {
      const [finalMgrRows] = await hrms.query<any[]>(
        'SELECT id, tally_name FROM imprest_manager WHERE tally_name IS NOT NULL'
      );
      // Re-map using tally_name matching
      for (const mgr of mgrRows) {
        const tallyName = String(mgr.TallyHead ?? mgr.UserName ?? '').trim();
        const found = finalMgrRows.find(r => String(r.tally_name) === tallyName);
        if (found) mgrIdMap.set(mgr.Id as number, found.id as string);
      }
    }

    console.log(` Managers: ${mgrInserted} inserted, ${mgrSkipped} skipped (${mgrNoAuth} had no matching auth_user — skipped per Q3 decision)`);

    // ── Phase 2: Migrate imprest_allocation ───────────────────────────────
    let allocInserted  = 0;
    let allocSkipped   = 0;
    let ledgerInserted = 0;
    // Running balance per manager for ledger entries
    const managerBalance = new Map<string, number>();

    for (const alloc of allocRows) {
      const billId = alloc.Id as number;
      if (doneBillIds.has(billId)) { allocSkipped++; continue; }

      const hrMgrId  = mgrIdMap.get(alloc.ImprestManagerId as number);
      const branchId = branchMap.get(alloc.BranchId as number);

      if (!hrMgrId || !branchId) { allocSkipped++; continue; }

      const amount = parseFloat(String(alloc.Amount ?? 0)) || 0;
      const allocDate = safeDate(alloc.EntryDate) ?? safeDate(alloc.CreateDate) ?? '2017-04-01';
      const allocNo = allocationNo(allocDate, billId);
      const payMode = decodePayMode(alloc.PaymentMode as number | null);
      const refNo   = alloc.PaymentNo ? String(alloc.PaymentNo).trim() || null : null;
      const [, mm, yy] = allocNo.match(/IMP\/(\d{2})\/(\d{2})\//) ?? ['','00','00'];
      const periodFull = yy ? `20${yy}-${mm}` : null;

      if (!APPLY) {
        allocInserted++;
        doneBillIds.add(billId);
        continue;
      }

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
          'disbursed',               // all historical allocations are treated as disbursed
          alloc.CreateDate ? new Date(alloc.CreateDate) : new Date(),
          MIGRATION_USER,
          alloc.CreateDate ? new Date(alloc.CreateDate) : new Date(),
          periodFull,
          billId,
        ]
      );
      allocInserted++;
      doneBillIds.add(billId);

      // ── imprest_transaction_ledger credit entry ────────────────────
      const prevBalance = managerBalance.get(hrMgrId) ?? 0;
      const newBalance  = amount >= 0
        ? prevBalance + amount    // credit to float
        : prevBalance + amount;   // negative amount = return/adjustment (debit)
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
      ledgerInserted++;

      if (allocInserted % 200 === 0) {
        process.stdout.write(`\r  Allocations: ${allocInserted} inserted...`);
      }
    }

    // ── Phase 3: Ledger debit entries for imprest GRN vouchers ────────────
    // Each migrated GRN with grn_type='imprest' becomes a debit voucher on
    // the relevant manager's ledger. Match via imprest_manager_id on grn_request
    // if already set, or by branch + period for best-effort linkage.
    let voucherLedgerInserted = 0;
    if (APPLY) {
      const [imprestGrns] = await hrms.query<any[]>(
        `SELECT g.id, g.branch_id, g.amount_with_tax, g.accounting_period, g.bill_date,
                g.description, g.grn_number, g.imprest_manager_id
         FROM grn_request g
         WHERE g.grn_type = 'imprest'
           AND g.status != 'cancelled'
           AND g.bill_source_id IS NOT NULL`
      );

      for (const grn of imprestGrns) {
        // Use imprest_manager_id if already set on the GRN; otherwise find by branch
        let mgrId = grn.imprest_manager_id as string | null;
        if (!mgrId) {
          const [mgrMatchRows] = await hrms.query<any[]>(
            `SELECT id FROM imprest_manager WHERE branch_id = ? AND active_status = 1 LIMIT 1`,
            [grn.branch_id]
          );
          mgrId = mgrMatchRows[0]?.id ?? null;
        }
        if (!mgrId) continue;

        const prevBalance = managerBalance.get(mgrId) ?? 0;
        const amt = parseFloat(String(grn.amount_with_tax ?? 0)) || 0;
        const newBalance = prevBalance - amt;
        managerBalance.set(mgrId, newBalance);

        await hrms.execute(
          `INSERT IGNORE INTO imprest_transaction_ledger (
             id, imprest_manager_id, branch_id,
             entry_type, direction, amount, balance_after,
             reference_type, reference_id,
             period_code, transaction_date, narration,
             created_by, created_at
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            uuidv4(), mgrId, grn.branch_id,
            'voucher', 'debit', amt, newBalance,
            'grn_request', grn.id,
            grn.accounting_period, grn.bill_date,
            grn.description ? String(grn.description).substring(0,499) : `Imprest voucher ${grn.grn_number}`,
            MIGRATION_USER, new Date(),
          ]
        );

        // Link GRN to imprest_manager if not already linked
        if (!grn.imprest_manager_id) {
          await hrms.execute(
            'UPDATE grn_request SET imprest_manager_id = ? WHERE id = ? AND imprest_manager_id IS NULL',
            [mgrId, grn.id]
          );
        }
        voucherLedgerInserted++;
      }
    }

    // ── Report ─────────────────────────────────────────────────────────────
    console.log(`\n\n════════════════════════════════════════════════════════`);
    console.log(` RESULTS — ${APPLY ? 'APPLIED' : 'DRY RUN'}`);
    console.log(`════════════════════════════════════════════════════════`);
    console.log(` imprest_manager rows inserted   : ${mgrInserted}`);
    console.log(` imprest_manager rows skipped    : ${mgrSkipped}`);
    console.log(` imprest_manager (no auth, skip) : ${mgrNoAuth}`);
    console.log(` imprest_allocation inserted     : ${allocInserted}`);
    console.log(` imprest_allocation skipped      : ${allocSkipped}`);
    console.log(` ledger credit entries (alloc)   : ${ledgerInserted}`);
    console.log(` ledger debit entries (GRN)      : ${voucherLedgerInserted}`);
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
