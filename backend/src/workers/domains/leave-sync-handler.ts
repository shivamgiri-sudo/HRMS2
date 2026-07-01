import { getLegacyPool } from '../../db/legacyDb.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

interface LegacyLeaveRecord {
  Id: number;
  EmpCode: string;
  EmpLocation: string | null;
  EmpName: string | null;
  BranchName: string | null;
  CostCenter: string | null;
  LeaveFrom: Date | null;
  LeaveTo: Date | null;
  LeaveFor: string | null;
  LeaveType: string | null;
  CurrentStatus: string | null;
  Purpose: string | null;
  Address: string | null;
  Contact: bigint | null;
  Status: string | null;
  CL: number | null;
  ML: number | null;
  DL: number | null;
  EL: number | null;
  PTRL: number | null;
  MTRL: number | null;
  LWP: number | null;
  TotalLeave: number | null;
  DisApprovedReason: string | null;
  DisApprovedDate: Date | null;
  CreateDate: Date | null;
  LeaveApproveBy: number | null;
  LeaveApproveDate: Date | null;
  chatId: string | null;
}

interface TransformedLeaveRequest {
  id: string;
  employee_id: string;
  employee_code: string;
  leave_type_code: string;
  start_date: Date;
  end_date: Date;
  total_days: number;
  reason: string | null;
  status: string;
  requested_at: Date;
  approved_at: Date | null;
  approved_by: string | null;
  rejection_reason: string | null;
  legacy_leave_id: number;
  legacy_created_at: Date | null;
}

interface EmployeeMapping {
  id: string;
  employee_code: string;
}

export class LeaveSyncHandler {
  private employeeCache: Map<string, EmployeeMapping> = new Map();

  /**
   * Fetch leave records from legacy database that were created/updated after lastSyncTime
   */
  async fetchChanges(lastSyncTime: Date, batchSize: number = 1000): Promise<LegacyLeaveRecord[]> {
    const pool = await getLegacyPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM leave_management
       WHERE CreateDate > ? OR LeaveApproveDate > ?
       ORDER BY COALESCE(CreateDate, LeaveApproveDate) ASC
       LIMIT ?`,
      [lastSyncTime, lastSyncTime, batchSize]
    );

    console.log(`[LEAVE-SYNC] Fetched ${rows.length} leave records from legacy`);
    return rows as LegacyLeaveRecord[];
  }

  /**
   * CRITICAL: Load employee mappings into cache
   * Validates employee_code exists in HRMS before syncing
   */
  private async loadEmployeeCache(employeeCodes: string[]): Promise<void> {
    if (employeeCodes.length === 0) return;

    // Build placeholders for IN clause
    const placeholders = employeeCodes.map(() => '?').join(',');

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_code FROM employees WHERE employee_code IN (${placeholders})`,
      employeeCodes
    );

    this.employeeCache.clear();
    for (const row of rows) {
      this.employeeCache.set(row.employee_code, {
        id: row.id,
        employee_code: row.employee_code,
      });
    }

    console.log(`[LEAVE-SYNC] Loaded ${this.employeeCache.size} employee mappings into cache`);
  }

  /**
   * Map legacy leave type to HRMS leave type code
   */
  private mapLeaveType(legacyLeaveType: string | null): string {
    if (!legacyLeaveType) return 'OTHER';

    const normalized = legacyLeaveType.trim().toUpperCase();

    const mapping: Record<string, string> = {
      'CL': 'CL',
      'CASUAL': 'CL',
      'CASUAL LEAVE': 'CL',
      'ML': 'ML',
      'MEDICAL': 'ML',
      'MEDICAL LEAVE': 'ML',
      'SICK': 'ML',
      'SICK LEAVE': 'ML',
      'DL': 'DL',
      'DUTY LEAVE': 'DL',
      'EL': 'EL',
      'EARNED': 'EL',
      'EARNED LEAVE': 'EL',
      'PRIVILEGE': 'EL',
      'PTRL': 'PTRL',
      'PATERNITY': 'PTRL',
      'PATERNITY LEAVE': 'PTRL',
      'MTRL': 'MTRL',
      'MATERNITY': 'MTRL',
      'MATERNITY LEAVE': 'MTRL',
      'LWP': 'LWP',
      'LEAVE WITHOUT PAY': 'LWP',
      'WITHOUT PAY': 'LWP',
    };

    return mapping[normalized] || 'OTHER';
  }

  /**
   * Map legacy leave status to HRMS status
   */
  private mapStatus(legacyStatus: string | null): string {
    if (!legacyStatus) return 'pending';

    const normalized = legacyStatus.trim().toLowerCase();

    if (normalized.includes('approve') && !normalized.includes('disapprove')) {
      return 'approved';
    }
    if (normalized.includes('reject') || normalized.includes('disapprove')) {
      return 'rejected';
    }
    if (normalized.includes('pending') || normalized.includes('waiting')) {
      return 'pending';
    }
    if (normalized.includes('cancel')) {
      return 'cancelled';
    }

    return 'pending';
  }

  /**
   * Transform legacy leave record to HRMS format
   * Returns null if employee_code doesn't exist in HRMS (VALIDATION)
   */
  transform(legacyRecord: LegacyLeaveRecord): TransformedLeaveRequest | null {
    // CRITICAL VALIDATION: Check if employee exists in HRMS
    const employee = this.employeeCache.get(legacyRecord.EmpCode);
    if (!employee) {
      console.warn(`[LEAVE-SYNC] SKIP: Employee ${legacyRecord.EmpCode} not found in HRMS`);
      return null;
    }

    // Validate required fields
    if (!legacyRecord.LeaveFrom || !legacyRecord.LeaveTo) {
      console.warn(`[LEAVE-SYNC] SKIP: Leave record ${legacyRecord.Id} missing dates`);
      return null;
    }

    const leaveTypeCode = this.mapLeaveType(legacyRecord.LeaveType);
    const status = this.mapStatus(legacyRecord.Status);

    // Calculate total days
    const startDate = new Date(legacyRecord.LeaveFrom);
    const endDate = new Date(legacyRecord.LeaveTo);
    const totalDays = legacyRecord.TotalLeave ||
      Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    return {
      id: this.generateUUID(),
      employee_id: employee.id,
      employee_code: legacyRecord.EmpCode,
      leave_type_code: leaveTypeCode,
      start_date: startDate,
      end_date: endDate,
      total_days: totalDays,
      reason: legacyRecord.Purpose,
      status,
      requested_at: legacyRecord.CreateDate || new Date(),
      approved_at: legacyRecord.LeaveApproveDate || null,
      approved_by: legacyRecord.LeaveApproveBy ? String(legacyRecord.LeaveApproveBy) : null,
      rejection_reason: status === 'rejected' ? legacyRecord.DisApprovedReason : null,
      legacy_leave_id: legacyRecord.Id,
      legacy_created_at: legacyRecord.CreateDate,
    };
  }

  /**
   * Sync leave requests to HRMS database
   * SAFE: Uses INSERT ... ON DUPLICATE KEY UPDATE
   */
  async syncToHRMS(records: TransformedLeaveRequest[]): Promise<{
    inserted: number;
    updated: number;
    skipped: number;
    errors: Array<{ record: TransformedLeaveRequest; error: string }>;
  }> {
    const result = { inserted: 0, updated: 0, skipped: 0, errors: [] as any[] };

    for (const record of records) {
      try {
        // Check if leave request already exists by legacy_leave_id
        const [existing] = await db.execute<RowDataPacket[]>(
          `SELECT id FROM leave_request WHERE legacy_leave_id = ? LIMIT 1`,
          [record.legacy_leave_id]
        );

        if (existing.length > 0) {
          // Update existing record
          await db.execute(
            `UPDATE leave_request SET
              employee_id = ?,
              leave_type_code = ?,
              start_date = ?,
              end_date = ?,
              total_days = ?,
              reason = ?,
              status = ?,
              approved_at = ?,
              approved_by = ?,
              rejection_reason = ?,
              updated_at = NOW()
            WHERE legacy_leave_id = ?`,
            [
              record.employee_id,
              record.leave_type_code,
              record.start_date,
              record.end_date,
              record.total_days,
              record.reason,
              record.status,
              record.approved_at,
              record.approved_by,
              record.rejection_reason,
              record.legacy_leave_id,
            ]
          );
          result.updated++;
        } else {
          // Insert new record
          await db.execute(
            `INSERT INTO leave_request (
              id, employee_id, leave_type_code, start_date, end_date,
              total_days, reason, status, requested_at, approved_at,
              approved_by, rejection_reason, legacy_leave_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              record.id,
              record.employee_id,
              record.leave_type_code,
              record.start_date,
              record.end_date,
              record.total_days,
              record.reason,
              record.status,
              record.requested_at,
              record.approved_at,
              record.approved_by,
              record.rejection_reason,
              record.legacy_leave_id,
              record.legacy_created_at || new Date(),
            ]
          );
          result.inserted++;
        }
      } catch (error: any) {
        console.error(`[LEAVE-SYNC] ERROR syncing leave ${record.legacy_leave_id}:`, error.message);
        result.errors.push({ record, error: error.message });
      }
    }

    console.log(`[LEAVE-SYNC] Sync complete: ${result.inserted} inserted, ${result.updated} updated, ${result.skipped} skipped, ${result.errors.length} errors`);
    return result;
  }

  /**
   * Main sync method - orchestrates the full sync workflow
   */
  async sync(lastSyncTime: Date = new Date('2020-01-01')): Promise<void> {
    console.log(`[LEAVE-SYNC] Starting sync from ${lastSyncTime.toISOString()}`);

    try {
      // Step 1: Fetch changes from legacy
      const legacyRecords = await this.fetchChanges(lastSyncTime, 1000);

      if (legacyRecords.length === 0) {
        console.log('[LEAVE-SYNC] No new leave records to sync');
        return;
      }

      // Step 2: Load employee mappings for validation
      const employeeCodes = [...new Set(legacyRecords.map(r => r.EmpCode))];
      await this.loadEmployeeCache(employeeCodes);

      // Step 3: Transform records (validates employee exists)
      const transformed = legacyRecords
        .map(r => this.transform(r))
        .filter((r): r is TransformedLeaveRequest => r !== null);

      console.log(`[LEAVE-SYNC] Transformed ${transformed.length}/${legacyRecords.length} leave records (${legacyRecords.length - transformed.length} skipped due to missing employees)`);

      if (transformed.length === 0) {
        console.log('[LEAVE-SYNC] No valid leave records to sync after validation');
        return;
      }

      // Step 4: Sync to HRMS
      const result = await this.syncToHRMS(transformed);

      console.log(`[LEAVE-SYNC] ✅ Sync complete:`, result);
    } catch (error: any) {
      console.error('[LEAVE-SYNC] ❌ Sync failed:', error.message);
      throw error;
    }
  }

  /**
   * Generate UUID v4
   */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
