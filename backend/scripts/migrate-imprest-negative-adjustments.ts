/**
 * migrate-imprest-negative-adjustments.ts
 *
 * Migrates 122 negative entries from db_bill imprest_allotment_master that were
 * not included in the original migration. These represent allocation reversals,
 * corrections, and adjustments that reduce a manager's float balance.
 *
 * Each negative entry becomes:
 *   1. An imprest_allocation record (with negative amount, status=disbursed, bill_source_id set)
 *   2. An adjustment DEBIT entry in imprest_transaction_ledger
 *
 * SAFE TO RE-RUN — checks bill_source_id to skip already-migrated entries.
 *
 * USAGE
 *   npx ts-node scripts/migrate-imprest-negative-adjustments.ts           # dry-run
 *   npx ts-node scripts/migrate-imprest-negative-adjustments.ts --apply   # write
 */

import * as mysql from 'mysql2/promise';
import 'dotenv/config';
import { randomUUID } from 'crypto';

const APPLY = process.argv.includes('--apply');
const MIGRATION_USER = '00000000-0000-0000-0000-dbbill000001';

// db_bill PaymentMode int → string
const PAYMENT_MODE_MAP: Record<number, string> = {
  1: 'Cash',
  2: 'Adjustment',
  3: 'NEFT',
  4: 'Cheque',
  5: 'RTGS',
  6: 'IMPS',
  7: 'UPI',
};

async function main() {
  const hrms = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const bill = await mysql.createConnection({
    host: process.env.BILL_DB_HOST,
    port: Number(process.env.BILL_DB_PORT ?? 3306),
    user: process.env.BILL_DB_USER,
    password: process.env.BILL_DB_PASSWORD,
    database: process.env.BILL_DB_NAME,
    connectTimeout: 10000,
  });

  try {
    console.log('\n════════════════════════════════════════════════════════');
    console.log(' Migrate Imprest Negative Adjustments from db_bill');
    console.log('════════════════════════════════════════════════════════');
    console.log(` Mode: ${APPLY ? 'APPLY (writes to DB)' : 'DRY RUN (no writes)'}\n`);

    // ── Branch map: db_bill BranchId → mas_hrms branch UUID ─────────────────
    const [branchMapRows] = await hrms.query<any[]>(
      'SELECT dbbill_branch_id, hrms_branch_id FROM grn_migration_branch_map'
    );
    const branchMap = new Map<number, string>(
      branchMapRows.map(r => [Number(r.dbbill_branch_id), String(r.hrms_branch_id)])
    );

    // ── Manager map: db_bill imprest_manager → mas_hrms imprest_manager ──────
    const [billMgrs] = await bill.query<any[]>(
      'SELECT Id, TallyHead, BranchId FROM imprest_manager'
    );
    const [hrmsMgrs] = await hrms.query<any[]>(
      'SELECT id, tally_name, branch_id FROM imprest_manager'
    );
    const hrmsMgrByNameBranch = new Map<string, string>();
    const hrmsMgrByName = new Map<string, string[]>(); // tally_name → [id, ...] (for fallback)
    for (const m of hrmsMgrs) {
      hrmsMgrByNameBranch.set(`${m.tally_name}|${m.branch_id}`, String(m.id));
      const existing = hrmsMgrByName.get(String(m.tally_name)) ?? [];
      existing.push(String(m.id));
      hrmsMgrByName.set(String(m.tally_name), existing);
    }
    const billToHrmsMgr = new Map<number, { hrmsId: string; branchUuid: string }>();
    for (const m of billMgrs) {
      const branchUuid = branchMap.get(Number(m.BranchId));
      if (!branchUuid) continue;
      let hrmsId = hrmsMgrByNameBranch.get(`${m.TallyHead}|${branchUuid}`);
      let resolvedBranch = branchUuid;
      // Fallback: if branch-specific lookup misses but there is exactly one manager with this
      // tally name across all branches (e.g. RUPALI whose mas_hrms branch_id differs from
      // the branch map for JAIPUR IDC), use that unique manager.
      if (!hrmsId) {
        const byName = hrmsMgrByName.get(String(m.TallyHead)) ?? [];
        if (byName.length === 1) {
          hrmsId = byName[0];
          // resolve the actual branch from mas_hrms
          const mgrRow = hrmsMgrs.find((r: any) => String(r.id) === hrmsId);
          if (mgrRow) resolvedBranch = String(mgrRow.branch_id);
        }
      }
      if (hrmsId) billToHrmsMgr.set(Number(m.Id), { hrmsId, branchUuid: resolvedBranch });
    }

    // ── Already-migrated bill_source_ids ─────────────────────────────────────
    const [alreadyMig] = await hrms.query<any[]>(`
      SELECT ia.bill_source_id
        FROM imprest_allocation ia
        JOIN imprest_transaction_ledger l
             ON l.reference_id = ia.id AND l.reference_type = 'imprest_allocation'
       WHERE l.entry_type IN ('return','adjustment')
         AND l.created_by = ?
         AND ia.bill_source_id IS NOT NULL
    `, [MIGRATION_USER]);
    const alreadyMigIds = new Set(alreadyMig.map(r => Number(r.bill_source_id)));

    // ── Load negative entries from db_bill ───────────────────────────────────
    const [negEntries] = await bill.query<any[]>(`
      SELECT a.Id, a.BranchId, a.ImprestManagerId, a.EntryDate, a.CreateDate, a.Amount,
             a.PaymentMode, a.Remarks, m.TallyHead, m.Branch
        FROM imprest_allotment_master a
        LEFT JOIN imprest_manager m ON m.Id = a.ImprestManagerId
       WHERE a.Amount < 0
       ORDER BY a.EntryDate ASC, a.Id ASC
    `);

    const toMigrate = negEntries.filter(r => !alreadyMigIds.has(Number(r.Id)));
    console.log(`db_bill negative entries: ${negEntries.length}`);
    console.log(`Already migrated: ${alreadyMigIds.size}`);
    console.log(`To migrate: ${toMigrate.length}`);

    // ── Validate mappings ─────────────────────────────────────────────────────
    const canMigrate: typeof toMigrate = [];
    const skipNoMapping: typeof toMigrate = [];
    for (const r of toMigrate) {
      const mgr = billToHrmsMgr.get(Number(r.ImprestManagerId));
      if (!mgr) {
        skipNoMapping.push(r);
      } else {
        canMigrate.push(r);
      }
    }

    if (skipNoMapping.length > 0) {
      console.log(`\n⚠  Skipped (no manager mapping): ${skipNoMapping.length}`);
      for (const r of skipNoMapping) {
        console.log(`   Id=${r.Id} | mgr=${r.TallyHead} (BranchId=${r.BranchId}) | amt=${r.Amount}`);
      }
    }

    console.log(`\nReady to insert: ${canMigrate.length} adjustment entries`);

    // ── Print preview ─────────────────────────────────────────────────────────
    console.log('\n── Preview (by manager) ────────────────────────────────────────');
    const previewByMgr = new Map<string, { branch: string; cnt: number; total: number }>();
    for (const r of canMigrate) {
      const mgr = billToHrmsMgr.get(Number(r.ImprestManagerId))!;
      const key = String(r.TallyHead);
      const existing = previewByMgr.get(key) ?? { branch: String(r.Branch), cnt: 0, total: 0 };
      existing.cnt++;
      existing.total += Number(r.Amount);
      previewByMgr.set(key, existing);
    }
    for (const [name, v] of Array.from(previewByMgr.entries()).sort((a, b) => a[1].total - b[1].total)) {
      console.log(`  ${String(name).padEnd(42)} | ${String(v.branch).padEnd(22)} | cnt=${v.cnt} | adj=₹${v.total.toLocaleString('en-IN')}`);
    }

    if (!APPLY) {
      console.log('\n DRY RUN complete — nothing written. Re-run with --apply to execute.\n');
      return;
    }

    // ── Apply ─────────────────────────────────────────────────────────────────
    let allocInserted = 0;
    let ledgerInserted = 0;

    for (const r of canMigrate) {
      const mgr = billToHrmsMgr.get(Number(r.ImprestManagerId))!;
      const amount = Math.abs(Number(r.Amount)); // store positive, direction carries sign
      const toIsoDate = (v: any): string | null => {
        if (!v) return null;
        if (v instanceof Date) {
          const y = v.getFullYear(), mo = v.getMonth() + 1, d = v.getDate();
          return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        }
        const s = String(v).slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(s) && s > '1900-01-01' ? s : null;
      };
      const entryDate = toIsoDate(r.EntryDate) ?? toIsoDate(r.CreateDate) ?? '2017-04-01';
      const periodCode = entryDate.slice(0, 7);
      const payMode = PAYMENT_MODE_MAP[Number(r.PaymentMode)] ?? 'Adjustment';
      const remarks = r.Remarks ? String(r.Remarks).substring(0, 999) : `Adjustment Id ${r.Id}`;
      const allocationId = randomUUID();

      // 1. Create imprest_allocation record (negative amount, disbursed)
      await hrms.execute(`
        INSERT INTO imprest_allocation
          (id, allocation_no, imprest_manager_id, branch_id, allocation_date, amount,
           payment_mode, reference_no, remarks, status, submitted_by, submitted_at,
           disbursed_at, created_by, created_at, updated_at, accounting_period, bill_source_id)
        VALUES (?,?,?,?,?,?,?,?,?,'disbursed',NULL,NOW(),NOW(),?,NOW(),NOW(),?,?)
      `, [
        allocationId,
        `ADJ/${String(r.Id).padStart(5, '0')}`,
        mgr.hrmsId,
        mgr.branchUuid,
        entryDate,
        -amount,                  // negative amount signals this is a reduction
        payMode,
        '',                       // no cheque/ref for adjustments
        remarks,
        MIGRATION_USER,
        periodCode,
        Number(r.Id),
      ]);
      allocInserted++;

      // 2. Post adjustment DEBIT to ledger
      const ledgerId = randomUUID();
      await hrms.execute(`
        INSERT INTO imprest_transaction_ledger
          (id, imprest_manager_id, branch_id, entry_type, direction, amount, balance_after,
           reference_type, reference_id, period_code, transaction_date, narration,
           created_by, created_at)
        VALUES (?,?,?,'adjustment','debit',?,0,'imprest_allocation',?,?,?,?,?,NOW())
      `, [
        ledgerId,
        mgr.hrmsId,
        mgr.branchUuid,
        amount,
        allocationId,
        periodCode,
        entryDate,
        remarks,
        MIGRATION_USER,
      ]);
      ledgerInserted++;
    }

    console.log(`\n════ Migration applied ════`);
    console.log(` imprest_allocation rows inserted: ${allocInserted}`);
    console.log(` imprest_transaction_ledger rows inserted: ${ledgerInserted}`);

    // ── Final balance check for affected managers ──────────────────────────
    const affectedMgrIds = Array.from(
      new Set(canMigrate.map(r => billToHrmsMgr.get(Number(r.ImprestManagerId))!.hrmsId))
    );
    const ph = affectedMgrIds.map(() => '?').join(',');
    const [finalBals] = await hrms.query<any[]>(`
      SELECT im.tally_name, b.branch_name,
             ROUND(SUM(CASE WHEN l.direction='credit' THEN l.amount ELSE 0 END),2) AS credits,
             ROUND(SUM(CASE WHEN l.direction='debit' THEN l.amount ELSE 0 END),2) AS debits,
             ROUND(SUM(CASE WHEN l.direction='credit' THEN l.amount ELSE 0 END)
                 - SUM(CASE WHEN l.direction='debit' THEN l.amount ELSE 0 END),2) AS balance
        FROM imprest_manager im
        JOIN branch_master b ON b.id = im.branch_id
        LEFT JOIN imprest_transaction_ledger l ON l.imprest_manager_id = im.id
       WHERE im.id IN (${ph})
       GROUP BY im.id, im.tally_name, b.branch_name
       ORDER BY balance ASC
    `, affectedMgrIds);

    console.log('\n════ Affected manager balances after adjustment migration ════');
    for (const r of finalBals) {
      const sign = Number(r.balance) < 0 ? '⚠' : '✓';
      console.log(`  ${sign} ${String(r.tally_name ?? '(null)').padEnd(42)} | ${String(r.branch_name).padEnd(22)} | ₹${Number(r.balance).toLocaleString('en-IN')}`);
    }

  } finally {
    await hrms.end();
    await bill.end();
  }
}

main().catch(err => {
  console.error('\nMIGRATION FAILED:', err?.message ?? err);
  process.exit(1);
});
