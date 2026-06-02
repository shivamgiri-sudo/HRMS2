// backend/scripts/migrate-legacy.leave.ts
import type { Connection, RowDataPacket } from 'mysql2/promise';
import type { MasterMaps } from './migrate-legacy.masters.js';
import type { LegacyLeaveRow } from './migrate-legacy.transforms.js';
import {
  parseLegacyDate, sumLeaveDays, normalizeLeaveStatus,
} from './migrate-legacy.transforms.js';

export interface LeaveMigrationResult {
  inserted: number;
  skipped:  number;
  errors:   Array<{ legacyId: number; error: string }>;
}

export async function migrateLeave(
  src: Connection,
  dst: Connection,
  srcTable: string,
  masters: MasterMaps,
): Promise<LeaveMigrationResult> {
  console.log('  [Phase 3] Migrating leave records…');

  const [rows] = await src.execute<RowDataPacket[]>(`SELECT * FROM ${srcTable}`);
  const result: LeaveMigrationResult = { inserted: 0, skipped: 0, errors: [] };

  for (const raw of rows) {
    const row = raw as LegacyLeaveRow;
    try {
      await migrateOneLeave(dst, row, masters, result);
    } catch (err) {
      result.errors.push({ legacyId: row.Id, error: String(err) });
    }
  }

  console.log(`  [Phase 3] Done. inserted:${result.inserted} skipped:${result.skipped} errors:${result.errors.length}`);
  return result;
}

async function migrateOneLeave(
  dst: Connection,
  row: LegacyLeaveRow,
  masters: MasterMaps,
  result: LeaveMigrationResult,
): Promise<void> {
  // Resolve employee
  const [empRows] = await dst.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE employee_code = ?`,
    [row.EmpCode],
  );
  const employeeId = empRows[0]?.id as string | undefined;
  if (!employeeId) {
    result.skipped++;
    return;
  }

  // Resolve leave type
  const leaveTypeId = masters.leaveType.get(row.LeaveType.toUpperCase().trim());
  if (!leaveTypeId) {
    result.errors.push({ legacyId: row.Id, error: `Unknown LeaveType: ${row.LeaveType}` });
    return;
  }

  const fromDate = parseLegacyDate(row.LeaveFrom);
  const toDate   = parseLegacyDate(row.LeaveTo);
  if (!fromDate || !toDate) {
    result.errors.push({ legacyId: row.Id, error: `Invalid dates: ${row.LeaveFrom} / ${row.LeaveTo}` });
    return;
  }

  const totalDays = sumLeaveDays(row) || 1;
  const status    = normalizeLeaveStatus(row.Status);
  const reason    = [row.LeaveFor, row.Purpose].filter(Boolean).join(' — ') || null;
  const appliedAt = parseLegacyDate(row.CreateDate);

  // Idempotency key: employee + from + to + leave_type
  await dst.execute(
    `INSERT INTO leave_request
       (employee_id, leave_type_id, from_date, to_date, total_days, reason, status, applied_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE status = VALUES(status), reason = VALUES(reason)`,
    [employeeId, leaveTypeId, fromDate, toDate, totalDays, reason, status, appliedAt ?? fromDate],
  );

  // ── Approval log ─────────────────────────────────────────────────────────────
  if (row.LeaveApproveBy && status === 'approved') {
    const [lrRows] = await dst.execute<RowDataPacket[]>(
      `SELECT id FROM leave_request
       WHERE employee_id = ? AND from_date = ? AND to_date = ? AND leave_type_id = ?`,
      [employeeId, fromDate, toDate, leaveTypeId],
    );
    const leaveRequestId = lrRows[0]?.id as string | undefined;
    if (leaveRequestId) {
      const approveAt = parseLegacyDate(row.LeaveApproveDate) ?? fromDate;
      // Fixed system UUID as action_by for legacy approvals — no real user FK
      const SYSTEM_UUID = '00000000-0000-0000-0000-000000000001';
      await dst.execute(
        `INSERT IGNORE INTO leave_approval_log
           (leave_request_id, action, action_by, action_at, remarks)
         VALUES (?, 'approved', ?, ?, ?)`,
        [leaveRequestId, SYSTEM_UUID, approveAt, `Legacy: approved by ${row.LeaveApproveBy}`],
      );
    }
  }

  result.inserted++;
}
