/**
 * fix-grn-null-numbers.ts
 *
 * F-01 — Backfill grn_number on non-draft GRN rows that were submitted before
 * resolveGrnNumberOnSubmit() was wired into the submit path.
 *
 * WHY THIS EXISTS
 *   7 purchase orders (GRNs) reached non-draft status (some are already Branch-Head-
 *   approved) with grn_number = NULL. The submit path now assigns numbers correctly, but
 *   these 7 pre-date that fix and need a one-time backfill.
 *
 * ATOMICITY GUARANTEE
 *   Each GRN gets its own transaction on a single connection that wraps BOTH the
 *   sequence-counter increment AND the grn_request UPDATE. This prevents the race window
 *   identified in audit finding F-05: sequence committed in its own transaction before the
 *   UPDATE, burning a serial permanently if the UPDATE fails.
 *
 * IDEMPOTENCY
 *   The UPDATE uses WHERE id = ? AND grn_number IS NULL, so a re-run after a partial apply
 *   will skip rows that were already assigned.
 *
 * USAGE
 *   npx ts-node backend/scripts/fix-grn-null-numbers.ts           # dry-run (default)
 *   npx ts-node backend/scripts/fix-grn-null-numbers.ts --apply   # write
 */

import mysql, { type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import 'dotenv/config';

const APPLY = process.argv.includes('--apply');
const DEFAULT_COMPANY = 'MAS';

// ── Inline allocateMonthlyGrnNumber ──────────────────────────────────────────
//
// We inline this instead of importing from grn-number-monthly.service.ts because
// ts-node in standalone mode cannot cleanly resolve the ESM module graph used by
// the service layer (it imports db from ../../db/mysql.js which in turn expects
// the full Express startup context).
//
// The locking sequence is identical to the service:
//   INSERT ... ON DUPLICATE KEY UPDATE next_sequence = next_sequence  (ensure row)
//   SELECT next_sequence ... FOR UPDATE                               (lock)
//   UPDATE next_sequence = next_sequence + 1                         (claim)
// The no-op ON DUPLICATE KEY UPDATE is load-bearing — it guarantees a row exists
// before FOR UPDATE, serialising concurrent creates at the unique index.

async function allocateMonthlyGrnNumber(input: {
  connection: mysql.Connection;
  periodCode: string;
  companyCode?: string | null;
}): Promise<string> {
  const { connection, periodCode } = input;
  const companyCode = (input.companyCode?.trim() || DEFAULT_COMPANY).toUpperCase();

  // Resolve prefix from finance_company
  const [companyRows] = await connection.execute<RowDataPacket[]>(
    `SELECT grn_prefix FROM finance_company WHERE company_code = ? AND active_status = 1 LIMIT 1`,
    [companyCode],
  );
  if (!companyRows[0]) {
    throw new Error(`No active company configured for code "${companyCode}"`);
  }
  const prefix = String(companyRows[0].grn_prefix);

  // Ensure the sequence row exists (no-op on duplicate — load-bearing)
  await connection.execute(
    `INSERT INTO finance_grn_monthly_sequence (company_code, period_code, next_sequence)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE next_sequence = next_sequence`,
    [companyCode, periodCode],
  );

  // Lock and read the current sequence
  const [seqRows] = await connection.execute<RowDataPacket[]>(
    `SELECT next_sequence
       FROM finance_grn_monthly_sequence
      WHERE company_code = ? AND period_code = ?
      FOR UPDATE`,
    [companyCode, periodCode],
  );
  if (!seqRows[0]) throw new Error('GRN sequence row could not be initialised');

  const sequence = Number(seqRows[0].next_sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error(`GRN sequence is invalid: ${sequence}`);
  }

  // Increment — claim the serial
  await connection.execute(
    `UPDATE finance_grn_monthly_sequence
        SET next_sequence = next_sequence + 1
      WHERE company_code = ? AND period_code = ?`,
    [companyCode, periodCode],
  );

  const [yyyy, mm] = periodCode.split('-');
  return `${prefix}/${mm}/${yyyy.slice(2, 4)}/${String(sequence).padStart(4, '0')}`;
}

// ── Dry-run peek: reads next_sequence WITHOUT incrementing ───────────────────

async function peekNextGrnNumber(input: {
  connection: mysql.Connection;
  periodCode: string;
  companyCode?: string | null;
}): Promise<string> {
  const { connection, periodCode } = input;
  const companyCode = (input.companyCode?.trim() || DEFAULT_COMPANY).toUpperCase();

  const [companyRows] = await connection.execute<RowDataPacket[]>(
    `SELECT grn_prefix FROM finance_company WHERE company_code = ? AND active_status = 1 LIMIT 1`,
    [companyCode],
  );
  const prefix = companyRows[0] ? String(companyRows[0].grn_prefix) : companyCode;

  const [seqRows] = await connection.execute<RowDataPacket[]>(
    `SELECT next_sequence
       FROM finance_grn_monthly_sequence
      WHERE company_code = ? AND period_code = ?`,
    [companyCode, periodCode],
  );
  // If no sequence row yet, next would be 0001
  const next = seqRows[0] ? Number(seqRows[0].next_sequence) : 1;
  const [yyyy, mm] = periodCode.split('-');
  return `${prefix}/${mm}/${yyyy.slice(2, 4)}/${String(next).padStart(4, '0')}`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    console.log('\n════════════════════════════════════════════════════════');
    console.log(' F-01: Backfill grn_number on non-draft GRNs');
    console.log('════════════════════════════════════════════════════════');
    console.log(` Mode: ${APPLY ? 'APPLY (writes to DB)' : 'DRY RUN (no writes)'}\n`);

    // Find all non-draft GRNs missing a grn_number
    const [candidates] = await conn.execute<RowDataPacket[]>(
      `SELECT id, grn_number, status, accounting_period, bill_date,
              company_code, description, created_at
         FROM grn_request
        WHERE grn_number IS NULL
          AND status != 'draft'
        ORDER BY created_at ASC`,
    );

    console.log(` Candidates (grn_number IS NULL AND status != 'draft'): ${candidates.length}`);

    if (candidates.length === 0) {
      console.log('\n No rows need backfilling. Nothing to do.\n');
    } else {
      console.log('');

      if (!APPLY) {
        // ── DRY RUN: preview numbers without touching the sequence counter ────
        for (const row of candidates) {
          const periodCode = row.accounting_period
            ? String(row.accounting_period)
            : row.bill_date
              ? String(row.bill_date).slice(0, 7)
              : null;

          if (!periodCode || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodCode)) {
            console.log(`  GRN id=${row.id}  status=${row.status}  → Cannot preview: no valid period (accounting_period=${row.accounting_period ?? 'NULL'}, bill_date=${row.bill_date ?? 'NULL'})`);
            continue;
          }

          const preview = await peekNextGrnNumber({
            connection: conn,
            periodCode,
            companyCode: row.company_code || null,
          });
          console.log(`  GRN id=${row.id}  status=${row.status}  period=${periodCode}  → Would assign: ${preview}`);
        }
        console.log('\n DRY RUN complete — nothing written.');
        console.log(' Re-run with --apply to execute.\n');
      } else {
        // ── APPLY: assign numbers atomically, one transaction per GRN ─────────
        let assigned = 0;
        let skipped = 0;
        let failed = 0;

        for (const row of candidates) {
          const periodCode = row.accounting_period
            ? String(row.accounting_period)
            : row.bill_date
              ? String(row.bill_date).slice(0, 7)
              : null;

          if (!periodCode || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodCode)) {
            console.warn(`  SKIP GRN id=${row.id}: no valid accounting period (accounting_period=${row.accounting_period ?? 'NULL'}, bill_date=${row.bill_date ?? 'NULL'})`);
            skipped++;
            continue;
          }

          // Each GRN gets its OWN transaction so that a single failure does not
          // roll back numbers already assigned to earlier GRNs.
          await conn.beginTransaction();
          try {
            const grnNumber = await allocateMonthlyGrnNumber({
              connection: conn,
              periodCode,
              companyCode: row.company_code || null,
            });

            const [result] = await conn.execute<mysql.ResultSetHeader>(
              `UPDATE grn_request
                  SET grn_number = ?
                WHERE id = ?
                  AND grn_number IS NULL`,
              [grnNumber, row.id],
            );

            if (result.affectedRows === 0) {
              // Row was already assigned between our SELECT and UPDATE — safe to roll back
              await conn.rollback();
              console.log(`  SKIP GRN id=${row.id}: grn_number already assigned (concurrent write?)`);
              skipped++;
            } else {
              await conn.commit();
              console.log(`  ASSIGNED GRN id=${row.id}  status=${row.status}  → ${grnNumber}`);
              assigned++;
            }
          } catch (err) {
            await conn.rollback();
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  FAILED GRN id=${row.id}: ${msg}`);
            failed++;
          }
        }

        console.log(`\n Summary: assigned=${assigned}  skipped=${skipped}  failed=${failed}`);
      }
    }

    // ── Post-fix verification count ───────────────────────────────────────────
    const [remaining] = await conn.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
         FROM grn_request
        WHERE grn_number IS NULL
          AND status != 'draft'`,
    );
    const remainingCount = Number(remaining[0]?.cnt ?? 0);
    console.log(` Post-check: non-draft GRNs with NULL grn_number remaining = ${remainingCount}`);
    if (remainingCount > 0 && APPLY) {
      console.warn(` WARNING: ${remainingCount} row(s) still lack a grn_number after apply. Investigate manually.`);
    }
    console.log('');

  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error('\nFIX FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
