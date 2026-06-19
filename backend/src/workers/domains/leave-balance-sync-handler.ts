import { db } from '../../db/mysql.js';
import { DomainSyncBase } from './domain-sync-base.js';

const SYNC_MAP_ID = 'a1000000-0000-0000-0000-000000000006';

interface LegacyLeave {
  id: number;
  EmpCode: string;
  CL: number | null;
  ML: number | null;
  DL: number | null;
  EL: number | null;
  PTRL: number | null;
  LWP: number | null;
  TotalLeave: number | null;
  CreateDate: Date | null;
}

// Maps db_bill leave column → mas_hrms leave_code
const LEAVE_MAP: Record<string, string> = {
  CL:   'CL',
  ML:   'ML',
  DL:   'DL',
  EL:   'EL',
  PTRL: 'PL',
};

export class LeaveBalanceSyncHandler extends DomainSyncBase {
  constructor() {
    super('leave_balance', SYNC_MAP_ID);
  }

  protected async fetchBatch(lastWatermark: string, batchSize: number): Promise<LegacyLeave[]> {
    const pool = await this.getLegacy();
    const [rows] = await pool.execute<any[]>(
      `SELECT id, EmpCode, CL, ML, DL, EL, PTRL, LWP, TotalLeave, CreateDate
       FROM db_bill.leave_management
       WHERE CreateDate >= ? OR CreateDate IS NULL
       ORDER BY CreateDate ASC
       LIMIT ?`,
      [lastWatermark, batchSize]
    );
    return rows as LegacyLeave[];
  }

  protected extractWatermark(rows: LegacyLeave[]): string | null {
    const last = [...rows].reverse().find(r => r.CreateDate);
    if (!last?.CreateDate) return null;
    const d = new Date(last.CreateDate);
    d.setSeconds(d.getSeconds() + 1);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }

  protected async processBatch(rows: LegacyLeave[]): Promise<{
    inserted: number; updated: number; skipped: number; failed: number;
  }> {
    const empMap = await this.loadEmployeeMap();
    const leaveTypeMap = await this.loadLeaveTypeMap();
    let inserted = 0, updated = 0, skipped = 0, failed = 0;

    for (const row of rows) {
      const empId = this.resolveEmployeeId(empMap, row.EmpCode);
      if (!empId) { skipped++; continue; }

      const year = row.CreateDate
        ? new Date(row.CreateDate).getFullYear()
        : 2025;

      for (const [legacyCol, leaveCode] of Object.entries(LEAVE_MAP)) {
        const allocated = (row as any)[legacyCol];
        if (allocated == null || Number(allocated) <= 0) continue;

        const leaveTypeId = leaveTypeMap.get(leaveCode);
        if (!leaveTypeId) continue;

        // Get currently used days from leave_request
        const [[usedRow]] = await db.execute<any[]>(
          `SELECT COALESCE(SUM(lr.total_days), 0) AS used_days
           FROM leave_request lr
           WHERE lr.employee_id = ?
             AND lr.leave_type_id = ?
             AND lr.status = 'approved'
             AND YEAR(lr.from_date) = ?`,
          [empId, leaveTypeId, year]
        );
        const usedDays = Number(usedRow?.used_days ?? 0);

        try {
          const [res] = await db.execute<any>(
            `INSERT INTO leave_balance_ledger
               (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
             VALUES (UUID(), ?, ?, ?, ?, ?, 0)
             ON DUPLICATE KEY UPDATE
               allocated_days = VALUES(allocated_days),
               used_days      = VALUES(used_days),
               updated_at     = NOW()`,
            [empId, leaveTypeId, year, Number(allocated), usedDays]
          );
          if (res.affectedRows === 1) inserted++;
          else updated++;
        } catch {
          failed++;
        }
      }
    }

    return { inserted, updated, skipped, failed };
  }

  private async loadLeaveTypeMap(): Promise<Map<string, string>> {
    const [rows] = await db.execute<any[]>(
      `SELECT id, leave_code FROM leave_type_master`
    );
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.leave_code, r.id);
    return m;
  }
}

export const leaveBalanceSyncHandler = new LeaveBalanceSyncHandler();
