/**
 * fix-grn-legacy-status-reclassify.ts
 *
 * F-02 + F-03 — Reclassify legacy migrated GRNs to terminal status so the live
 * application can no longer present them in the active approval queue.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * F-02 — 6,518 vendor GRNs imported from db_bill landed in 'finance_head_approved'.
 *   The live application never writes this status and has no exit transition for
 *   it. They cannot be cancelled, reversed, or moved to payment.
 *   FIX: move them to the status specified by --decision (paid | cancelled).
 *
 * F-03 — 22,669 legacy GRNs from 2017-2018 sit in 'submitted' or
 *   'branch_head_approved' with budget_line_id IS NULL.  Every approval attempt
 *   throws "GRN has no approved budget mapping".  They bury the 16 real pending
 *   approvals that staff are waiting on.
 *   FIX:
 *     grn_type = 'imprest'  → 'approved'  (was already processed externally)
 *     grn_type = 'salary'   → 'approved'  (same — externally processed)
 *     grn_type = 'vendor'   → 'cancelled' (no payment was ever made)
 *     any other type        → skip with a warning
 *
 * AUDIT: every status change writes one row to sensitive_action_log with
 *   action_type = 'LEGACY_MIGRATION_RECLASSIFY'.
 *
 * IDEMPOTENCY: WHERE clauses target only the original legacy statuses, so a
 *   second run after --apply is a safe no-op.
 *
 * USAGE
 *   cd backend && npx ts-node scripts/fix-grn-legacy-status-reclassify.ts --decision paid
 *   cd backend && npx ts-node scripts/fix-grn-legacy-status-reclassify.ts --decision cancelled
 *   cd backend && npx ts-node scripts/fix-grn-legacy-status-reclassify.ts --decision paid --apply
 *
 * NOTE: --apply requires explicit Finance sign-off AND user approval.  Default
 *   mode is dry-run.  DO NOT pass --apply without that approval.
 */

import mysql, { type RowDataPacket, type ResultSetHeader } from 'mysql2/promise';
import 'dotenv/config';
import { v4 as uuidv4 } from 'uuid';

// ── CLI argument parsing ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

const decisionIndex = args.indexOf('--decision');
const DECISION: string | null = decisionIndex !== -1 ? (args[decisionIndex + 1] ?? null) : null;

// --decision is required and must be 'paid' or 'cancelled'.
// Exit(1) immediately — before any DB work — if missing or invalid.
if (!DECISION || !['paid', 'cancelled'].includes(DECISION)) {
  console.error('');
  console.error('ERROR: --decision flag is required for F-02 reclassification.');
  console.error('');
  console.error('  Finance must decide what terminal status the 6,518 legacy');
  console.error('  vendor GRNs currently stuck in "finance_head_approved" should');
  console.error('  be moved to:');
  console.error('');
  console.error('    --decision paid      (treat as already-paid; no payment workflow needed)');
  console.error('    --decision cancelled (cancel the GRNs; they were never actioned)');
  console.error('');
  console.error('  This decision has accounting implications and must be made by');
  console.error('  the Finance team before this script is run.');
  console.error('');
  process.exit(1);
}

const MIGRATION_ACTOR = '00000000-0000-0000-0000-migration0002';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString('en-IN');
}

function fmtRupee(v: unknown): string {
  const n = parseFloat(String(v ?? 0));
  return `₹${(isFinite(n) ? n : 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    console.log('\n════════════════════════════════════════════════════════════════');
    console.log(' F-02 + F-03: Legacy GRN Status Reclassification');
    console.log('════════════════════════════════════════════════════════════════');
    console.log(` Mode        : ${APPLY ? 'APPLY (writes to DB)' : 'DRY RUN (no writes)'}`);
    console.log(` F-02 target : ${DECISION}`);
    console.log('════════════════════════════════════════════════════════════════\n');

    // ── F-02: finance_head_approved legacy vendor GRNs ───────────────────────
    const [f02Rows] = await conn.execute<RowDataPacket[]>(`
      SELECT id, grn_type, grn_number, amount_with_tax, status,
             accounting_period, bill_date, description
        FROM grn_request
       WHERE status = 'finance_head_approved'
         AND bill_source_id IS NOT NULL
       ORDER BY bill_date ASC, id ASC
    `);

    const f02Total = f02Rows.reduce((s, r) => s + parseFloat(String(r.amount_with_tax ?? 0)), 0);
    const f02TypeCounts: Record<string, number> = {};
    for (const r of f02Rows) {
      const t = String(r.grn_type ?? 'unknown');
      f02TypeCounts[t] = (f02TypeCounts[t] ?? 0) + 1;
    }

    console.log('── F-02: finance_head_approved (no exit transition) ────────────');
    console.log(` Rows found     : ${fmt(f02Rows.length)}`);
    console.log(` Gross total    : ${fmtRupee(f02Total)}`);
    console.log(` By grn_type    :`);
    for (const [type, count] of Object.entries(f02TypeCounts)) {
      console.log(`   ${type.padEnd(20)}: ${fmt(count)}`);
    }
    console.log(` → Would move to: '${DECISION}'\n`);

    // ── F-03: submitted / branch_head_approved with NULL budget_line_id ──────
    const [f03Rows] = await conn.execute<RowDataPacket[]>(`
      SELECT id, grn_type, grn_number, amount_with_tax, status,
             accounting_period, bill_date, description
        FROM grn_request
       WHERE status IN ('submitted', 'branch_head_approved')
         AND bill_source_id IS NOT NULL
       ORDER BY grn_type ASC, status ASC, bill_date ASC, id ASC
    `);

    // Build buckets: grn_type × status → { count, target }
    type Bucket = { count: number; total: number; target: string | null };
    const f03Buckets: Record<string, Bucket> = {};

    for (const r of f03Rows) {
      const type   = String(r.grn_type ?? 'unknown');
      const status = String(r.status);
      const key    = `${type}|${status}`;
      const amt    = parseFloat(String(r.amount_with_tax ?? 0));

      let target: string | null;
      if (type === 'imprest' || type === 'salary') {
        target = 'approved';
      } else if (type === 'vendor') {
        target = 'cancelled';
      } else {
        target = null; // skip
      }

      if (!f03Buckets[key]) {
        f03Buckets[key] = { count: 0, total: 0, target };
      }
      f03Buckets[key].count++;
      f03Buckets[key].total += isFinite(amt) ? amt : 0;
    }

    const f03Total = f03Rows.reduce((s, r) => s + parseFloat(String(r.amount_with_tax ?? 0)), 0);
    console.log('── F-03: submitted / branch_head_approved (budget_line_id NULL) ─');
    console.log(` Rows found     : ${fmt(f03Rows.length)}`);
    console.log(` Gross total    : ${fmtRupee(f03Total)}`);
    console.log(` By (grn_type × status) → target:`);
    for (const [key, bucket] of Object.entries(f03Buckets)) {
      const action = bucket.target ? `→ '${bucket.target}'` : '→ SKIP (unrecognised type)';
      console.log(`   ${key.padEnd(38)} ${fmt(bucket.count).padStart(6)} rows   ${action}`);
    }
    console.log('');

    // ── Native (real) queue: not touched by this script ──────────────────────
    const [nativeRows] = await conn.execute<RowDataPacket[]>(`
      SELECT COUNT(*) AS cnt
        FROM grn_request
       WHERE status IN ('submitted', 'branch_head_approved')
         AND bill_source_id IS NULL
    `);
    const nativeCount = Number(nativeRows[0]?.cnt ?? 0);
    console.log(`── Native queue items (real, untouched): ${fmt(nativeCount)}`);
    console.log('');

    if (!APPLY) {
      console.log('DRY RUN complete — nothing written.');
      console.log('Re-run with --apply to execute (requires Finance sign-off + user approval).\n');
      return;
    }

    // ════════════════════════════════════════════════════════════════════════
    // APPLY mode
    // ════════════════════════════════════════════════════════════════════════

    // ── APPLY F-02 ───────────────────────────────────────────────────────────
    console.log(`[F-02] Moving ${fmt(f02Rows.length)} rows to '${DECISION}'...`);
    let f02Done = 0;
    let f02Failed = 0;

    for (const row of f02Rows) {
      const fromStatus = String(row.status);
      const toStatus   = DECISION;
      const grnId      = String(row.id);

      try {
        const [upd] = await conn.execute<ResultSetHeader>(
          `UPDATE grn_request
              SET status = ?
            WHERE id = ?
              AND status = 'finance_head_approved'
              AND bill_source_id IS NOT NULL`,
          [toStatus, grnId],
        );

        if (upd.affectedRows > 0) {
          await conn.execute(
            `INSERT INTO sensitive_action_log
               (id, action_type, module_key, entity_type, entity_id,
                actor_user_id, actor_role, change_summary, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
              uuidv4(),
              'LEGACY_MIGRATION_RECLASSIFY',
              'FINANCE',
              'grn_request',
              grnId,
              MIGRATION_ACTOR,
              'migration_script',
              JSON.stringify({
                from_status: fromStatus,
                to_status: toStatus,
                reason: 'F-02/F-03 legacy migration reclassification',
              }),
            ],
          );
          f02Done++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  FAILED F-02 GRN id=${grnId}: ${msg}`);
        f02Failed++;
      }

      if (f02Done % 500 === 0 && f02Done > 0) {
        process.stdout.write(`\r  ${fmt(f02Done)} moved...`);
      }
    }
    console.log(`\n  F-02 done: moved=${fmt(f02Done)}, failed=${fmt(f02Failed)}`);

    // ── APPLY F-03 ───────────────────────────────────────────────────────────
    console.log(`\n[F-03] Reclassifying ${fmt(f03Rows.length)} rows...`);
    let f03Done = 0;
    let f03Skipped = 0;
    let f03Failed = 0;

    for (const row of f03Rows) {
      const type       = String(row.grn_type ?? 'unknown');
      const fromStatus = String(row.status);
      const grnId      = String(row.id);

      let toStatus: string;
      if (type === 'imprest' || type === 'salary') {
        toStatus = 'approved';
      } else if (type === 'vendor') {
        toStatus = 'cancelled';
      } else {
        console.warn(`  SKIP F-03 GRN id=${grnId}: unrecognised grn_type '${type}'`);
        f03Skipped++;
        continue;
      }

      try {
        const [upd] = await conn.execute<ResultSetHeader>(
          `UPDATE grn_request
              SET status = ?
            WHERE id = ?
              AND status IN ('submitted', 'branch_head_approved')
              AND bill_source_id IS NOT NULL`,
          [toStatus, grnId],
        );

        if (upd.affectedRows > 0) {
          await conn.execute(
            `INSERT INTO sensitive_action_log
               (id, action_type, module_key, entity_type, entity_id,
                actor_user_id, actor_role, change_summary, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
              uuidv4(),
              'LEGACY_MIGRATION_RECLASSIFY',
              'FINANCE',
              'grn_request',
              grnId,
              MIGRATION_ACTOR,
              'migration_script',
              JSON.stringify({
                from_status: fromStatus,
                to_status: toStatus,
                reason: 'F-02/F-03 legacy migration reclassification',
              }),
            ],
          );
          f03Done++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  FAILED F-03 GRN id=${grnId}: ${msg}`);
        f03Failed++;
      }

      if (f03Done % 500 === 0 && f03Done > 0) {
        process.stdout.write(`\r  ${fmt(f03Done)} reclassified...`);
      }
    }
    console.log(`\n  F-03 done: reclassified=${fmt(f03Done)}, skipped=${fmt(f03Skipped)}, failed=${fmt(f03Failed)}`);

    // ── Post-apply verification ───────────────────────────────────────────────
    console.log('\n────────────────────────────────────────────────────────────────');
    console.log(' Post-apply verification');
    console.log('────────────────────────────────────────────────────────────────');

    const [remainF02] = await conn.execute<RowDataPacket[]>(`
      SELECT COUNT(*) AS cnt
        FROM grn_request
       WHERE status = 'finance_head_approved'
         AND bill_source_id IS NOT NULL
    `);
    console.log(` F-02 remaining in finance_head_approved (should be 0): ${Number(remainF02[0]?.cnt ?? 0)}`);

    const [remainF03] = await conn.execute<RowDataPacket[]>(`
      SELECT COUNT(*) AS cnt
        FROM grn_request
       WHERE status IN ('submitted', 'branch_head_approved')
         AND bill_source_id IS NOT NULL
    `);
    console.log(` F-03 remaining in submitted/branch_head_approved (legacy only, should be 0): ${Number(remainF03[0]?.cnt ?? 0)}`);

    const [nativePost] = await conn.execute<RowDataPacket[]>(`
      SELECT COUNT(*) AS cnt
        FROM grn_request
       WHERE status IN ('submitted', 'branch_head_approved')
         AND bill_source_id IS NULL
    `);
    console.log(` Native queue items (real, untouched): ${Number(nativePost[0]?.cnt ?? 0)}`);

    console.log('\n Migration fix complete.\n');

  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error('\nFIX FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
