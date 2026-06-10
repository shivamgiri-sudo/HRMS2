// backend/src/modules/wfm/attendance-engine.service.ts
import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AttendanceSource = 'dialler' | 'biometric';
export type AttendanceStatus =
  | 'present' | 'half_day' | 'absent'
  | 'leave_approved' | 'holiday' | 'week_off' | 'unreconciled';

export interface AttendanceRuleConfig {
  id: string;
  rule_name: string;
  scope_type: string;
  designation_id: string | null;
  process_id: string | null;
  branch_id: string | null;
  attendance_source: AttendanceSource;
  full_day_minutes: number;
  half_day_minutes: number;
  grace_minutes: number;
  effective_from: string;
  effective_to: string | null;
  active_status: number;
}

export interface AttendanceDailyRecord {
  id: string;
  employee_id: string;
  record_date: string;
  process_id: string | null;
  branch_id: string | null;
  attendance_source: AttendanceSource;
  dialler_minutes: number | null;
  biometric_minutes: number | null;
  raw_minutes: number;
  attendance_status: AttendanceStatus;
  lwp_value: number;
  late_mark: number;
  late_by_minutes: number;
  rule_config_id: string | null;
  regularization_id: string | null;
  override_by: string | null;
  override_reason: string | null;
  is_locked: number;
  processed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface EngineResult {
  employeeId: string;
  date: string;
  processId: string | null;
  branchId: string | null;
  source: AttendanceSource;
  diallerMinutes: number | null;
  biometricMinutes: number | null;
  rawMinutes: number;
  status: AttendanceStatus;
  lwpValue: number;
  lateMark: number;
  lateByMinutes: number;
  ruleConfigId: string | null;
}

export interface CorrectionInput {
  attendanceStatus: AttendanceStatus;
  lwpValue: number;
  overrideReason: string;
  isLocked?: boolean;
  regularizationId?: string | null;
}

export interface MonthlySummary {
  presentDays: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
  holidayDays: number;
  weekOffDays: number;
  totalLwp: number;
  lateMarks: number;
  totalWorkingDays: number;
}

export interface BatchResult {
  processed: number;
  skipped: number;
  failed: number;
  errors: string[];
}

// ── Service ───────────────────────────────────────────────────────────────────

export const attendanceEngineService = {

  // Rule resolution — specificity scoring query
  async resolveRule(
    designationId: string | null,
    processId: string | null,
    branchId: string | null,
    date: string
  ): Promise<AttendanceRuleConfig> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT *,
         (CASE WHEN designation_id IS NOT NULL THEN 4 ELSE 0 END +
          CASE WHEN process_id     IS NOT NULL THEN 2 ELSE 0 END +
          CASE WHEN branch_id      IS NOT NULL THEN 1 ELSE 0 END) AS specificity
       FROM attendance_rule_config
       WHERE active_status = 1
         AND effective_from <= ?
         AND (effective_to IS NULL OR effective_to >= ?)
         AND (designation_id = ? OR designation_id IS NULL)
         AND (process_id     = ? OR process_id     IS NULL)
         AND (branch_id      = ? OR branch_id      IS NULL)
       ORDER BY specificity DESC
       LIMIT 1`,
      [date, date, designationId, processId, branchId]
    );
    if (!rows[0]) {
      // Fallback: return hardcoded biometric default if no rule at all in DB
      return {
        id: 'fallback', rule_name: 'Fallback Default', scope_type: 'global',
        designation_id: null, process_id: null, branch_id: null,
        attendance_source: 'biometric', full_day_minutes: 540, half_day_minutes: 270,
        grace_minutes: 15, effective_from: date, effective_to: null, active_status: 1,
      };
    }
    return rows[0] as AttendanceRuleConfig;
  },

  // Check leave/holiday/week-off overrides — returns first match or null
  async resolveOverridePriority(
    employeeId: string,
    date: string,
    branchId: string | null
  ): Promise<{ status: AttendanceStatus } | null> {
    // 1. Approved leave
    const [leaveRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM leave_request
       WHERE employee_id = ? AND status = 'approved'
         AND ? BETWEEN from_date AND to_date LIMIT 1`,
      [employeeId, date]
    );
    if ((leaveRows as RowDataPacket[]).length > 0) return { status: 'leave_approved' };

    // 2. Holiday (branch-aware)
    const [holidayRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM leave_holiday_master
       WHERE holiday_date = ? AND active_status = 1
         AND (branch_id IS NULL OR branch_id = ?) LIMIT 1`,
      [date, branchId ?? null]
    );
    if ((holidayRows as RowDataPacket[]).length > 0) return { status: 'holiday' };

    // 3. Week off from roster
    const [woffRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM wfm_roster_assignment
       WHERE employee_id = ? AND roster_date = ? AND roster_status = 'Week Off' LIMIT 1`,
      [employeeId, date]
    );
    if ((woffRows as RowDataPacket[]).length > 0) return { status: 'week_off' };

    return null;
  },

  // Sum dialler login minutes — fallback join on employee_code if employee_id is null
  async getDiallerMinutes(employeeId: string, date: string): Promise<number> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(dsl.login_minutes), 0) AS total
       FROM dialer_session_log dsl
       WHERE dsl.employee_id = ? AND dsl.session_date = ?`,
      [employeeId, date]
    );
    let total = Number((rows[0] as any).total ?? 0);
    // Fallback: join via employee_code for unlinked imports
    if (total === 0) {
      const [fb] = await db.execute<RowDataPacket[]>(
        `SELECT COALESCE(SUM(dsl.login_minutes), 0) AS total
         FROM dialer_session_log dsl
         JOIN employees e ON e.employee_code = dsl.employee_code
         WHERE e.id = ? AND dsl.session_date = ?`,
        [employeeId, date]
      );
      total = Number((fb[0] as any).total ?? 0);
    }
    return total;
  },

  // Sum biometric login minutes
  async getBiometricMinutes(employeeId: string, date: string): Promise<number> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(total_login_minutes), 0) AS total
       FROM wfm_attendance_session
       WHERE employee_id = ? AND session_date = ?`,
      [employeeId, date]
    );
    return Number((rows[0] as any).total ?? 0);
  },

  // Pure classification — no DB
  classifyMinutes(
    rawMinutes: number,
    rule: AttendanceRuleConfig
  ): { status: 'present' | 'half_day' | 'absent'; lwpValue: number } {
    if (rawMinutes >= rule.full_day_minutes) return { status: 'present', lwpValue: 0.0 };
    if (rawMinutes >= rule.half_day_minutes) return { status: 'half_day', lwpValue: 0.5 };
    return { status: 'absent', lwpValue: 1.0 };
  },

  // Late arrival — biometric only; returns {0,0} immediately for dialler
  async calculateLateArrival(
    employeeId: string,
    date: string,
    rule: AttendanceRuleConfig
  ): Promise<{ lateMark: number; lateByMinutes: number }> {
    if (rule.attendance_source === 'dialler') return { lateMark: 0, lateByMinutes: 0 };

    // Get actual clock-in time
    const [sessionRows] = await db.execute<RowDataPacket[]>(
      `SELECT login_time FROM wfm_attendance_session
       WHERE employee_id = ? AND session_date = ? LIMIT 1`,
      [employeeId, date]
    );
    if (!(sessionRows as RowDataPacket[]).length || !(sessionRows[0] as any).login_time) {
      return { lateMark: 0, lateByMinutes: 0 };
    }

    // Get shift start from roster assignment → shift master
    const [shiftRows] = await db.execute<RowDataPacket[]>(
      `SELECT wsm.start_time FROM wfm_roster_assignment wra
       JOIN wfm_shift_master wsm ON wsm.id = wra.shift_id
       WHERE wra.employee_id = ? AND wra.roster_date = ? LIMIT 1`,
      [employeeId, date]
    );
    if (!(shiftRows as RowDataPacket[]).length) return { lateMark: 0, lateByMinutes: 0 };

    const loginTime = new Date((sessionRows[0] as any).login_time as string);
    const shiftStartStr = (shiftRows[0] as any).start_time as string; // "HH:MM:SS"
    const [h, m, s] = shiftStartStr.split(':').map(Number);
    const shiftStart = new Date(date);
    shiftStart.setHours(h, m, s ?? 0, 0);

    const lateByMs = loginTime.getTime() - shiftStart.getTime();
    const lateByMinutes = Math.floor(lateByMs / 60000);

    if (lateByMinutes > rule.grace_minutes) {
      return { lateMark: 1, lateByMinutes };
    }
    return { lateMark: 0, lateByMinutes: Math.max(0, lateByMinutes) };
  },

  // Per-employee orchestrator
  async processEmployee(employeeId: string, date: string): Promise<EngineResult> {
    // Fetch employee info
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT designation_id, process_id, branch_id FROM employees WHERE id = ? LIMIT 1`,
      [employeeId]
    );
    if (!(empRows as RowDataPacket[]).length) {
      throw new Error(`Employee ${employeeId} not found`);
    }
    const emp = empRows[0] as any;
    const designationId: string | null = emp.designation_id ?? null;
    const processId: string | null = emp.process_id ?? null;
    const branchId: string | null = emp.branch_id ?? null;

    // Resolve rule
    const rule = await this.resolveRule(designationId, processId, branchId, date);

    // Check overrides
    const override = await this.resolveOverridePriority(employeeId, date, branchId);
    if (override) {
      return {
        employeeId, date, processId, branchId,
        source: rule.attendance_source,
        diallerMinutes: null, biometricMinutes: null, rawMinutes: 0,
        status: override.status, lwpValue: 0.0,
        lateMark: 0, lateByMinutes: 0,
        ruleConfigId: rule.id === 'fallback' ? null : rule.id,
      };
    }

    // Fetch source minutes
    let diallerMinutes: number | null = null;
    let biometricMinutes: number | null = null;
    let rawMinutes: number;

    if (rule.attendance_source === 'dialler') {
      diallerMinutes = await this.getDiallerMinutes(employeeId, date);
      rawMinutes = diallerMinutes;
    } else {
      biometricMinutes = await this.getBiometricMinutes(employeeId, date);
      rawMinutes = biometricMinutes;
    }

    // Classify
    const classification = this.classifyMinutes(rawMinutes, rule);

    // Late arrival
    const lateResult = await this.calculateLateArrival(employeeId, date, rule);

    return {
      employeeId, date, processId, branchId,
      source: rule.attendance_source,
      diallerMinutes, biometricMinutes, rawMinutes,
      status: classification.status,
      lwpValue: classification.lwpValue,
      lateMark: lateResult.lateMark,
      lateByMinutes: lateResult.lateByMinutes,
      ruleConfigId: rule.id === 'fallback' ? null : rule.id,
    };
  },

  // DB write — is_locked guard enforced at SQL level
  async upsertDailyRecord(
    result: EngineResult,
    createdBy: string
  ): Promise<AttendanceDailyRecord> {
    await db.execute(
      `INSERT INTO attendance_daily_record
         (id, employee_id, record_date, process_id, branch_id, attendance_source,
          dialler_minutes, biometric_minutes, raw_minutes, attendance_status,
          lwp_value, late_mark, late_by_minutes, rule_config_id, processed_at, created_by)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE
         attendance_source  = IF(is_locked = 0, VALUES(attendance_source),  attendance_source),
         dialler_minutes    = IF(is_locked = 0, VALUES(dialler_minutes),    dialler_minutes),
         biometric_minutes  = IF(is_locked = 0, VALUES(biometric_minutes),  biometric_minutes),
         raw_minutes        = IF(is_locked = 0, VALUES(raw_minutes),        raw_minutes),
         attendance_status  = IF(is_locked = 0, VALUES(attendance_status),  attendance_status),
         lwp_value          = IF(is_locked = 0, VALUES(lwp_value),          lwp_value),
         late_mark          = IF(is_locked = 0, VALUES(late_mark),          late_mark),
         late_by_minutes    = IF(is_locked = 0, VALUES(late_by_minutes),    late_by_minutes),
         rule_config_id     = IF(is_locked = 0, VALUES(rule_config_id),     rule_config_id),
         processed_at       = IF(is_locked = 0, NOW(),                      processed_at),
         created_by         = IF(is_locked = 0, VALUES(created_by),         created_by)`,
      [
        result.employeeId, result.date, result.processId, result.branchId,
        result.source, result.diallerMinutes, result.biometricMinutes, result.rawMinutes,
        result.status, result.lwpValue, result.lateMark, result.lateByMinutes,
        result.ruleConfigId, createdBy
      ]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM attendance_daily_record WHERE employee_id = ? AND record_date = ? LIMIT 1`,
      [result.employeeId, result.date]
    );
    return rows[0] as AttendanceDailyRecord;
  },

  // WFM manual correction — always wins, sets is_locked = 1
  async correctDailyRecord(
    employeeId: string,
    date: string,
    input: CorrectionInput,
    correctedBy: string
  ): Promise<AttendanceDailyRecord> {
    const [check] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM attendance_daily_record WHERE employee_id = ? AND record_date = ? LIMIT 1`,
      [employeeId, date]
    );
    if (!(check as RowDataPacket[]).length) throw new Error('Attendance record not found');

    await db.execute(
      `UPDATE attendance_daily_record
       SET attendance_status  = ?,
           lwp_value          = ?,
           override_by        = ?,
           override_reason    = ?,
           is_locked          = ?,
           regularization_id  = ?,
           processed_at       = NOW(),
           created_by         = ?
       WHERE employee_id = ? AND record_date = ?`,
      [
        input.attendanceStatus, input.lwpValue, correctedBy,
        input.overrideReason, input.isLocked !== false ? 1 : 0,
        input.regularizationId ?? null, correctedBy,
        employeeId, date
      ]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM attendance_daily_record WHERE employee_id = ? AND record_date = ? LIMIT 1`,
      [employeeId, date]
    );
    return rows[0] as AttendanceDailyRecord;
  },

  // Batch processor
  async processDateBatch(date: string, batchSize = 50): Promise<BatchResult> {
    // Fetch all active employees
    const [employees] = await db.execute<RowDataPacket[]>(
      `SELECT id AS employee_id FROM employees
       WHERE employment_status = 'Active' AND active_status = 1
         AND (date_of_exit IS NULL OR date_of_exit >= ?)
       ORDER BY id`,
      [date]
    );

    // Fetch already-locked records for this date
    const [lockedRows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_id FROM attendance_daily_record WHERE record_date = ? AND is_locked = 1`,
      [date]
    );
    const lockedSet = new Set((lockedRows as RowDataPacket[]).map((r: any) => r.employee_id as string));

    let processed = 0, skipped = 0, failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < (employees as RowDataPacket[]).length; i += batchSize) {
      const chunk = (employees as RowDataPacket[]).slice(i, i + batchSize);
      const results = await Promise.allSettled(
        chunk.map(async (emp: any) => {
          if (lockedSet.has(emp.employee_id)) { skipped++; return; }
          const result = await this.processEmployee(emp.employee_id, date);
          await this.upsertDailyRecord(result, 'system');
          processed++;
        })
      );
      results.forEach((r, idx) => {
        if (r.status === 'rejected') {
          failed++;
          const empId = (chunk[idx] as any).employee_id;
          errors.push(`${empId}/${date}: ${(r.reason as Error)?.message ?? String(r.reason)}`);
        }
      });
    }

    return { processed, skipped, failed, errors };
  },

  // Read helpers
  async getRecord(employeeId: string, date: string): Promise<AttendanceDailyRecord | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM attendance_daily_record WHERE employee_id = ? AND record_date = ? LIMIT 1`,
      [employeeId, date]
    );
    return (rows[0] as AttendanceDailyRecord) ?? null;
  },

  async listRecords(filters: {
    employeeId?: string;
    processId?: string;
    fromDate?: string;
    toDate?: string;
    attendanceStatus?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: AttendanceDailyRecord[]; total: number; page: number; limit: number }> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    const offset = (page - 1) * limit;
    let q = 'SELECT * FROM attendance_daily_record WHERE 1=1';
    const p: unknown[] = [];
    if (filters.employeeId) { q += ' AND employee_id = ?'; p.push(filters.employeeId); }
    if (filters.processId)  { q += ' AND process_id = ?';  p.push(filters.processId); }
    if (filters.fromDate)   { q += ' AND record_date >= ?'; p.push(filters.fromDate); }
    if (filters.toDate)     { q += ' AND record_date <= ?'; p.push(filters.toDate); }
    if (filters.attendanceStatus) { q += ' AND attendance_status = ?'; p.push(filters.attendanceStatus); }
    const cq = q.replace('SELECT *', 'SELECT COUNT(*) AS total');
    const [countRows] = await db.execute<RowDataPacket[]>(cq, p);
    q += ` ORDER BY record_date DESC LIMIT ${limit} OFFSET ${offset}`;
    const [rows] = await db.execute<RowDataPacket[]>(q, p);
    return { data: rows as AttendanceDailyRecord[], total: (countRows[0] as any).total, page, limit };
  },

  async getMonthlySummary(employeeId: string, month: string): Promise<MonthlySummary> {
    const monthStart = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(CASE WHEN attendance_status = 'present'        THEN 1 END) AS present_days,
         COUNT(CASE WHEN attendance_status = 'half_day'       THEN 1 END) AS half_days,
         COUNT(CASE WHEN attendance_status = 'absent'         THEN 1 END) AS absent_days,
         COUNT(CASE WHEN attendance_status = 'leave_approved' THEN 1 END) AS leave_days,
         COUNT(CASE WHEN attendance_status = 'holiday'        THEN 1 END) AS holiday_days,
         COUNT(CASE WHEN attendance_status = 'week_off'       THEN 1 END) AS week_off_days,
         COALESCE(SUM(lwp_value), 0)                                       AS total_lwp,
         COALESCE(SUM(late_mark), 0)                                       AS late_marks,
         COUNT(CASE WHEN attendance_status NOT IN ('week_off','holiday') THEN 1 END) AS total_working_days
       FROM attendance_daily_record
       WHERE employee_id = ? AND record_date BETWEEN ? AND ?`,
      [employeeId, monthStart, monthEnd]
    );
    const r = rows[0] as any;
    return {
      presentDays:     Number(r.present_days),
      halfDays:        Number(r.half_days),
      absentDays:      Number(r.absent_days),
      leaveDays:       Number(r.leave_days),
      holidayDays:     Number(r.holiday_days),
      weekOffDays:     Number(r.week_off_days),
      totalLwp:        Number(r.total_lwp),
      lateMarks:       Number(r.late_marks),
      totalWorkingDays:Number(r.total_working_days),
    };
  },

  // Rules CRUD (admin)
  async listRules(): Promise<AttendanceRuleConfig[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT arc.*, dm.designation_code, pm.process_name, bm.branch_name
       FROM attendance_rule_config arc
       LEFT JOIN designation_master dm ON dm.id = arc.designation_id
       LEFT JOIN process_master pm     ON pm.id = arc.process_id
       LEFT JOIN branch_master bm      ON bm.id = arc.branch_id
       ORDER BY arc.active_status DESC, arc.created_at DESC`
    );
    return rows as AttendanceRuleConfig[];
  },

  async createRule(input: {
    rule_name: string; scope_type: string;
    designation_id?: string | null; process_id?: string | null; branch_id?: string | null;
    attendance_source: AttendanceSource; full_day_minutes: number; half_day_minutes: number;
    grace_minutes: number; effective_from: string; effective_to?: string | null;
    notes?: string | null; created_by?: string;
  }): Promise<AttendanceRuleConfig> {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO attendance_rule_config
         (id, rule_name, scope_type, designation_id, process_id, branch_id,
          attendance_source, full_day_minutes, half_day_minutes, grace_minutes,
          effective_from, effective_to, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.rule_name, input.scope_type, input.designation_id ?? null,
       input.process_id ?? null, input.branch_id ?? null, input.attendance_source,
       input.full_day_minutes, input.half_day_minutes, input.grace_minutes,
       input.effective_from, input.effective_to ?? null, input.notes ?? null,
       input.created_by ?? null]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM attendance_rule_config WHERE id = ? LIMIT 1`, [id]
    );
    return rows[0] as AttendanceRuleConfig;
  },

  async updateRule(id: string, updates: Partial<{
    rule_name: string; attendance_source: AttendanceSource;
    full_day_minutes: number; half_day_minutes: number; grace_minutes: number;
    effective_from: string; effective_to: string | null;
    notes: string | null; active_status: number;
  }>): Promise<AttendanceRuleConfig> {
    const fields: string[] = [];
    const params: unknown[] = [];
    const allowed = ['rule_name','attendance_source','full_day_minutes','half_day_minutes',
                     'grace_minutes','effective_from','effective_to','notes','active_status'];
    for (const k of allowed) {
      if (k in updates) { fields.push(`${k} = ?`); params.push((updates as any)[k]); }
    }
    if (!fields.length) throw new Error('No fields to update');
    params.push(id);
    await db.execute(`UPDATE attendance_rule_config SET ${fields.join(', ')} WHERE id = ?`, params);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM attendance_rule_config WHERE id = ? LIMIT 1`, [id]
    );
    return rows[0] as AttendanceRuleConfig;
  },

  async deactivateRule(id: string): Promise<void> {
    await db.execute(`UPDATE attendance_rule_config SET active_status = 0 WHERE id = ?`, [id]);
  },
};
