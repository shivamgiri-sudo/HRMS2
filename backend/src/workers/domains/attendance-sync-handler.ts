import { db } from '../../db/mysql.js';
import { DomainSyncBase } from './domain-sync-base.js';

const SYNC_MAP_ID = 'a1000000-0000-0000-0000-000000000005';

interface LegacyAttendance {
  id: number;
  EmpCode: string;
  AttDate: Date;
  InTime: string | null;
  OutTime: string | null;
  Status: string | null;
}

export class AttendanceSyncHandler extends DomainSyncBase {
  constructor() {
    super('attendance', SYNC_MAP_ID);
  }

  protected async fetchBatch(lastWatermark: string, batchSize: number): Promise<LegacyAttendance[]> {
    const pool = await this.getLegacy();
    const [rows] = await pool.execute<any[]>(
      `SELECT id, EmpCode, AttDate, InTime, OutTime, Status
       FROM db_bill.Attandence
       WHERE AttDate >= ?
       ORDER BY AttDate ASC
       LIMIT ?`,
      [lastWatermark, batchSize]
    );
    return rows as LegacyAttendance[];
  }

  protected extractWatermark(rows: LegacyAttendance[]): string | null {
    if (!rows.length) return null;
    const last = rows[rows.length - 1];
    const d = last.AttDate;
    if (!d) return null;
    const dt = new Date(d);
    // advance 1 day so next run won't re-fetch the same date
    dt.setDate(dt.getDate() + 1);
    return dt.toISOString().slice(0, 10) + ' 00:00:00';
  }

  protected async processBatch(rows: LegacyAttendance[]): Promise<{
    inserted: number; updated: number; skipped: number; failed: number;
  }> {
    const empMap = await this.loadEmployeeMap();
    let inserted = 0, updated = 0, skipped = 0, failed = 0;

    for (const row of rows) {
      const empId = this.resolveEmployeeId(empMap, row.EmpCode);
      if (!empId) { skipped++; continue; }

      const sessionDate = row.AttDate
        ? new Date(row.AttDate).toISOString().slice(0, 10)
        : null;
      if (!sessionDate) { skipped++; continue; }

      const status = this.mapStatus(row.Status);
      const loginTime  = this.buildDateTime(sessionDate, row.InTime);
      const logoutTime = this.buildDateTime(sessionDate, row.OutTime);
      const minutes    = loginTime && logoutTime
        ? Math.max(0, (new Date(logoutTime).getTime() - new Date(loginTime).getTime()) / 60000)
        : 0;

      try {
        const [res] = await db.execute<any>(
          `INSERT INTO wfm_attendance_session
             (id, employee_id, session_date, login_time, logout_time,
              total_login_minutes, current_status, punch_source,
              biometric_user_code, created_at)
           VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'LEGACY_IMPORT', ?, NOW())
           ON DUPLICATE KEY UPDATE
             login_time            = IF(VALUES(login_time) IS NOT NULL, VALUES(login_time), login_time),
             logout_time           = IF(VALUES(logout_time) IS NOT NULL, VALUES(logout_time), logout_time),
             total_login_minutes   = VALUES(total_login_minutes),
             current_status        = VALUES(current_status),
             updated_at            = NOW()`,
          [empId, sessionDate, loginTime, logoutTime, Math.round(minutes), status, row.EmpCode]
        );
        // affectedRows=1 → insert, affectedRows=2 → update
        if (res.affectedRows === 1) inserted++;
        else updated++;
      } catch {
        failed++;
      }
    }

    return { inserted, updated, skipped, failed };
  }

  private mapStatus(raw: string | null): string {
    const map: Record<string, string> = {
      P: 'Present', A: 'Absent', L: 'OnLeave',
      WO: 'WeekOff', HD: 'HalfDay', LWP: 'LWP',
    };
    return map[(raw ?? '').toUpperCase()] ?? 'Absent';
  }

  private buildDateTime(date: string, time: string | null): string | null {
    if (!time || time === '00:00:00' || time === '00:00') return null;
    return `${date} ${time}`;
  }
}

export const attendanceSyncHandler = new AttendanceSyncHandler();
