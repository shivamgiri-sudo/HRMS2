#!/usr/bin/env tsx
/**
 * Full historical leave migration: db_bill.leave_management → mas_hrms.leave_request
 *
 * - Migrates all records from 2018-01-01 onwards
 * - Excludes IDC-prefix employees (per project directive)
 * - Skips employees not found in mas_hrms (IDC auto-excluded via the empMap)
 * - Idempotent via legacy_leave_id — safe to re-run at any time
 * - Paginates by Id ASC (no OFFSET performance penalty, no record cap)
 *
 * Usage (from backend/):
 *   npx tsx scripts/migrate-leave-history-full.ts          # full run
 *   npx tsx scripts/migrate-leave-history-full.ts --dry-run # count only, no writes
 */

import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { randomUUID } from 'crypto';

dotenv.config();

const BATCH_SIZE = 500;
const FROM_DATE  = '2018-01-01';

// ── Connections ──────────────────────────────────────────────────────────────

const legacyConfig: mysql.ConnectionOptions = {
  host:           process.env.BILL_DB_HOST,
  port:           3306,
  user:           process.env.BILL_DB_USER     ?? 'shivam_user',
  password:       process.env.BILL_DB_PASSWORD ?? process.env.DB_PASSWORD,
  database:       'db_bill',
  connectTimeout: 15_000,
};

const hrmsConfig: mysql.ConnectionOptions = {
  host:           process.env.DB_HOST,
  port:           Number(process.env.DB_PORT) || 3306,
  user:           process.env.DB_USER         ?? 'shivam_user',
  password:       process.env.DB_PASSWORD,
  database:       process.env.DB_NAME         ?? 'mas_hrms',
  connectTimeout: 15_000,
};

// ── Mapping helpers ──────────────────────────────────────────────────────────

function mapLeaveType(raw: string | null | undefined): string {
  if (!raw) return 'CL';
  const n = raw.trim().toUpperCase();
  const m: Record<string, string> = {
    CL: 'CL', CASUAL: 'CL',
    ML: 'ML', MEDICAL: 'ML', SICK: 'ML',
    DL: 'DL', DUTY: 'DL',
    EL: 'EL', EARNED: 'EL', PRIVILEGE: 'EL',
    PTRL: 'PTRL', PATERNITY: 'PTRL',
    MTRL: 'MTRL', MATERNITY: 'MTRL',
    LWP: 'LWP',
  };
  return m[n] ?? 'CL';
}

function mapStatus(raw: string | null | undefined): string {
  if (!raw) return 'pending';
  const n = raw.trim().toLowerCase();
  if (n.includes('approve') && !n.includes('not') && !n.includes('dis')) return 'approved';
  if (n.includes('reject') || n.includes('not approved') || n.includes('disapprove')) return 'rejected';
  if (n.includes('cancel')) return 'cancelled';
  return 'pending';
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) console.log('[DRY-RUN] No writes will be made.\n');

  const legacy = await mysql.createConnection(legacyConfig);
  const hrms   = await mysql.createConnection(hrmsConfig);

  console.log('Connected to db_bill (legacy) and mas_hrms.');

  // Build employee map from mas_hrms: empCode → employee UUID
  // IDC employees are never in mas_hrms — they're auto-excluded by a missing map entry
  const [empRows]: any = await hrms.execute(
    `SELECT id, employee_code FROM employees WHERE employee_code IS NOT NULL`
  );
  const empMap = new Map<string, string>();
  for (const e of empRows) empMap.set(e.employee_code as string, e.id as string);
  console.log(`Employee map loaded: ${empMap.size} employees in mas_hrms`);

  // Build leave type map: leave_code → leave_type_master UUID
  const [ltRows]: any = await hrms.execute(
    `SELECT id, leave_code FROM leave_type_master WHERE active_status = 1`
  );
  const ltMap = new Map<string, string>();
  for (const lt of ltRows) ltMap.set(lt.leave_code as string, lt.id as string);
  console.log(`Leave type map loaded: ${ltMap.size} types`);

  // Count total records to migrate (for progress display)
  const [[countRow]]: any = await legacy.execute(
    `SELECT COUNT(*) AS cnt FROM leave_management
     WHERE EmpCode NOT LIKE 'IDC%' AND CreateDate >= ?`,
    [FROM_DATE]
  );
  const total = Number(countRow.cnt);
  console.log(`\nTotal source records (non-IDC, from ${FROM_DATE}): ${total}`);
  if (total === 0) {
    console.log('Nothing to migrate.');
    await legacy.end(); await hrms.end(); return;
  }
  console.log();

  const stats = { inserted: 0, updated: 0, skipped: 0, errors: 0 };
  let lastId  = 0;
  let batchNum = 0;

  // Paginate by Id ASC — avoids OFFSET slowdown on large tables
  while (true) {
    batchNum++;

    const [rows]: any = await legacy.execute(
      `SELECT Id, EmpCode, LeaveType, LeaveFrom, LeaveTo, TotalLeave,
              Purpose, Status, CreateDate, LeaveApproveDate, LeaveApproveBy,
              DisApprovedReason
       FROM leave_management
       WHERE Id > ? AND EmpCode NOT LIKE 'IDC%' AND CreateDate >= ?
       ORDER BY Id ASC
       LIMIT ?`,
      [lastId, FROM_DATE, BATCH_SIZE]
    );

    if ((rows as any[]).length === 0) break;

    for (const row of rows as any[]) {
      lastId = row.Id;

      try {
        // Skip employees not in mas_hrms (IDC or any unmapped code)
        const employeeId = empMap.get(row.EmpCode as string);
        if (!employeeId) { stats.skipped++; continue; }

        // Skip records with missing dates
        if (!row.LeaveFrom || !row.LeaveTo) { stats.skipped++; continue; }

        const leaveCode   = mapLeaveType(row.LeaveType);
        const leaveTypeId = ltMap.get(leaveCode);
        if (!leaveTypeId) { stats.skipped++; continue; }

        const fromDate  = new Date(row.LeaveFrom);
        const toDate    = new Date(row.LeaveTo);
        const totalDays = row.TotalLeave
          ? Number(row.TotalLeave)
          : Math.max(1, Math.ceil((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1);
        const status    = mapStatus(row.Status);
        const appliedAt = row.CreateDate ?? new Date();
        const approvedBy = row.LeaveApproveBy != null ? String(row.LeaveApproveBy) : null;
        const rejReason  = status === 'rejected' ? (row.DisApprovedReason ?? null) : null;

        if (dryRun) { stats.inserted++; continue; }

        // Idempotency: check for existing record by legacy_leave_id
        const [[existing]]: any = await hrms.execute(
          `SELECT id FROM leave_request WHERE legacy_leave_id = ? LIMIT 1`,
          [row.Id]
        );

        if (existing) {
          // Update in case status/dates changed in db_bill after initial migration
          await hrms.execute(
            `UPDATE leave_request SET
               employee_id = ?, leave_type_id = ?, leave_type_code = ?,
               from_date = ?, to_date = ?, start_date = ?, end_date = ?,
               total_days = ?, reason = ?, status = ?,
               requested_at = ?, approved_at = ?, approved_by = ?,
               rejection_reason = ?, legacy_created_at = ?
             WHERE legacy_leave_id = ?`,
            [
              employeeId, leaveTypeId, leaveCode,
              fromDate, toDate, fromDate, toDate,
              totalDays, row.Purpose ?? null, status,
              appliedAt, row.LeaveApproveDate ?? null, approvedBy,
              rejReason, appliedAt,
              row.Id,
            ]
          );
          stats.updated++;
        } else {
          // INSERT IGNORE: silently skips if the unique key (employee_id, leave_type_id, from_date, to_date)
          // already exists — covers duplicate db_bill entries and native HRMS records for the same dates
          const [insResult]: any = await hrms.execute(
            `INSERT IGNORE INTO leave_request (
               id, employee_id, leave_type_id, leave_type_code,
               from_date, to_date, start_date, end_date, total_days,
               reason, status, applied_at, requested_at, approved_at,
               approved_by, rejection_reason, legacy_leave_id,
               legacy_created_at, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              randomUUID(), employeeId, leaveTypeId, leaveCode,
              fromDate, toDate, fromDate, toDate, totalDays,
              row.Purpose ?? null, status,
              appliedAt, appliedAt, row.LeaveApproveDate ?? null,
              approvedBy, rejReason, row.Id,
              appliedAt, appliedAt,
            ]
          );
          if (insResult.affectedRows === 0) {
            stats.skipped++; // duplicate (same emp+type+dates already in mas_hrms)
          } else {
            stats.inserted++;
          }
        }
      } catch (err: any) {
        stats.errors++;
        if (stats.errors <= 20) {
          console.error(`  ERROR Id=${row.Id} EmpCode=${row.EmpCode}: ${err.message}`);
        }
      }
    }

    const done = stats.inserted + stats.updated + stats.skipped + stats.errors;
    const pct  = total > 0 ? ((done / total) * 100).toFixed(1) : '0.0';
    console.log(
      `  Batch ${batchNum} | ${done}/${total} (${pct}%) | ` +
      `+${stats.inserted} new, ~${stats.updated} updated, ${stats.skipped} skipped, ${stats.errors} errors`
    );
  }

  console.log('\n==========================================================');
  console.log('MIGRATION COMPLETE');
  console.log(`  Inserted : ${stats.inserted}`);
  console.log(`  Updated  : ${stats.updated}`);
  console.log(`  Skipped  : ${stats.skipped}  (not in mas_hrms or missing dates/type)`);
  console.log(`  Errors   : ${stats.errors}`);
  console.log('==========================================================\n');

  await legacy.end();
  await hrms.end();
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
