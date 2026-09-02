// backend/src/modules/wfm/attendance-engine.service.ts
import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import { EMPLOYMENT_END_DATE_SELECT } from '../payroll/employment-end-date.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { toIST, minutesOfDay } from '../../shared/timezone.js';
import { logger } from '../../logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AttendanceSource = 'dialler' | 'biometric';
export type AttendanceStatus =
  | 'present' | 'half_day' | 'absent'
  | 'leave_approved' | 'holiday' | 'week_off' | 'unreconciled'
  | 'missing_punch' | 'week_off_worked';

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
  sourceSystem: string;
  sourceRecordDate: string;
  sourceReference: string | null;
  diallerMinutes: number | null;
  biometricMinutes: number | null;
  rawMinutes: number;
  status: AttendanceStatus;
  lwpValue: number;
  lateMark: number;
  lateByMinutes: number;
  ruleConfigId: string | null;
  // G4: mismatch tracking
  biometricStatus: AttendanceStatus | null;
  aprStatus: AttendanceStatus | null;
  mismatchFlag: number;
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
  totalHours: number;
  wfoDays: number;
}

export interface BatchResult {
  processed: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export interface ShiftWindowInfo {
  isNightShift: boolean;
  startDate: string;
  endDate: string;
  shiftStartTime: string | null;
  shiftEndTime: string | null;
}

export function isCrossMidnightShift(
  shiftStartTime: string | null | undefined,
  shiftEndTime: string | null | undefined
): boolean {
  const start = String(shiftStartTime ?? '').trim();
  const end = String(shiftEndTime ?? '').trim();
  return Boolean(start && end && end < start);
}

export function nextIstDate(date: string): string {
  const d = new Date(`${date}T00:00:00+05:30`);
  d.setDate(d.getDate() + 1);
  return (toIST(d) ?? d.toISOString())!.slice(0, 10);
}

export function prevIstDate(date: string): string {
  const d = new Date(`${date}T00:00:00+05:30`);
  d.setDate(d.getDate() - 1);
  return (toIST(d) ?? d.toISOString())!.slice(0, 10);
}

export function buildShiftWindowInfo(
  date: string,
  shiftStartTime: string | null | undefined,
  shiftEndTime: string | null | undefined
): ShiftWindowInfo {
  const isNightShift = isCrossMidnightShift(shiftStartTime, shiftEndTime);
  return {
    isNightShift,
    startDate: date,
    endDate: isNightShift ? nextIstDate(date) : date,
    shiftStartTime: shiftStartTime ?? null,
    shiftEndTime: shiftEndTime ?? null,
  };
}

/**
 * How a scope's attendance is decided. Stored on apr_eligibility_config.attendance_logic
 * (migration 1648); 'apr' is the column default, so every pre-existing row keeps the
 * meaning it had when the table was a plain allow-list.
 *
 *   apr                    — dialler net login alone decides the day. A short or missing
 *                            login IS the attendance answer (ruling of 2026-08-07).
 *   cosec                  — biometric alone. A row carrying this is excluded from APR
 *                            matching, so it states the decision instead of leaving it to
 *                            be inferred from no row existing.
 *   apr_validated_by_cosec — APR first; when APR falls short of a full day the biometric
 *                            reading is classified too and the better of the two is used.
 */
export type AttendanceLogic = 'apr' | 'cosec' | 'apr_validated_by_cosec';

/** Ordering used by the tally: a better-evidenced day wins. */
const STATUS_RANK: Partial<Record<AttendanceStatus, number>> = {
  absent: 0,
  half_day: 1,
  present: 2,
};

function statusRank(status: AttendanceStatus | null): number {
  if (!status) return -1;
  return STATUS_RANK[status] ?? -1;
}

// Legacy regex fallback — used when apr_eligibility_config table is empty.
export function isOperationsExecutiveByRegex(departmentName: string, designationName: string): boolean {
  const department = departmentName.trim().toLowerCase();
  const designation = designationName.trim().toLowerCase();
  return (department === 'operations' || department === 'operation')
    && /^executive(?:\s*-\s*.+)?$/.test(designation);
}

function isOperationsDepartmentName(departmentName: string): boolean {
  const department = departmentName.trim().toLowerCase();
  return department === 'operations' || department === 'operation';
}

// G9: Read a feature flag from attendance_feature_config. Returns the raw string or null.
async function getFeatureFlag(key: string): Promise<string | null> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT config_value FROM attendance_feature_config WHERE config_key = ? LIMIT 1`,
      [key]
    );
    return (rows[0] as any)?.config_value ?? null;
  } catch {
    return null;
  }
}

async function getFeatureFlagBool(key: string, defaultVal = false): Promise<boolean> {
  const v = await getFeatureFlag(key);
  if (v === null) return defaultVal;
  return v === '1' || v.toLowerCase() === 'true';
}

/** Half-day floor used when none is configured, or when the configured value is unusable. */
export const DEFAULT_HALF_DAY_FLOOR_MINUTES = 240;

/**
 * Resolve a half-day floor from attendance_feature_config.
 *
 * A floor qualifies: a day reaching exactly this many minutes earns the half
 * day. Production holds 240 for both sources today.
 *
 * A malformed value is never applied. Silently coercing "" or "abc" would give
 * NaN — and `minutes >= NaN` is false for every input, quietly turning every
 * short day into an absence. Coercing to 0 would be worse still, marking every
 * day at least a half day. So anything non-finite or non-positive is refused,
 * logged, and the default stands.
 *
 * Call this ONCE per processing operation and pass the result down. It is a
 * database read, and the classifiers are deliberately synchronous so they can be
 * used inside a map or loop without a query per row.
 */
export async function resolveHalfDayFloorMinutes(
  key: 'netlogin_half_day_floor_minutes' | 'biometric_half_day_floor_minutes',
): Promise<number> {
  const raw = await getFeatureFlag(key);
  if (raw === null || String(raw).trim() === '') return DEFAULT_HALF_DAY_FLOOR_MINUTES;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.error(
      { key, configuredValue: raw, applied: DEFAULT_HALF_DAY_FLOOR_MINUTES },
      `[attendance] ${key} is not a usable number of minutes — refusing it and applying ` +
      `${DEFAULT_HALF_DAY_FLOOR_MINUTES}. Attendance is being classified against the default, ` +
      `not against this setting.`,
    );
    return DEFAULT_HALF_DAY_FLOOR_MINUTES;
  }
  return parsed;
}

/**
 * Classify an Operations/APR day from net login minutes.
 *
 * halfDayFloor is a parameter rather than a lookup so this stays synchronous and
 * safe to call per row; callers resolve it once via resolveHalfDayFloorMinutes.
 * It mirrors classifyCosecMinutes, which has taken its floor this way already —
 * the two paths measure different things (dialler net login vs biometric
 * presence) and so read separate configuration keys.
 *
 * The 480-minute full-day threshold is deliberately still fixed. Making it
 * configurable moves full-day pay and is a separate decision.
 */
export function classifyOperationsNetLogin(
  netLoginMinutes: number,
  halfDayFloor: number = DEFAULT_HALF_DAY_FLOOR_MINUTES,
): { status: 'present' | 'half_day' | 'absent'; lwpValue: number } {
  if (netLoginMinutes >= 480) return { status: 'present', lwpValue: 0.0 };
  if (netLoginMinutes >= halfDayFloor) return { status: 'half_day', lwpValue: 0.5 };
  return { status: 'absent', lwpValue: 1.0 };
}

// ── Per-employee attendance exceptions (migration 1652) ──────────────────────
// The COSEC full day, for everyone who has no explicit override on them.
export const COSEC_DEFAULT_FULL_DAY_MINUTES = 540;

/**
 * fullDayMinutes defaults to 540 (9h) — the threshold every employee was judged on before
 * employee_attendance_exception_bucket existed (migration 1652). Only a bucketed employee is
 * ever passed anything else, so an unbucketed employee's classification is bit-for-bit what it
 * was. It is a parameter for the same reason halfDayFloor already is: this stays synchronous
 * and safe to call per row, and the caller resolves the value once.
 */
export function classifyCosecMinutes(
  biometricMinutes: number,
  halfDayFloor = 240,
  fullDayMinutes = COSEC_DEFAULT_FULL_DAY_MINUTES
): { status: 'present' | 'half_day' | 'absent'; lwpValue: number } {
  if (biometricMinutes >= fullDayMinutes) return { status: 'present', lwpValue: 0.0 };
  if (biometricMinutes >= halfDayFloor) return { status: 'half_day', lwpValue: 0.5 };
  return { status: 'absent', lwpValue: 1.0 };
}

export interface AttendanceExceptionBucket {
  employeeId: string;
  /** A day with at least one punch but no matching pair counts as a full present day. */
  singlePunchCountsAsPresent: boolean;
  /** Minutes that make a full day for this employee; null = use COSEC_DEFAULT_FULL_DAY_MINUTES. */
  fullDayThresholdMinutes: number | null;
}

function mapBucketRow(row: any): AttendanceExceptionBucket {
  const threshold = row.full_day_threshold_minutes;
  return {
    employeeId: String(row.employee_id),
    singlePunchCountsAsPresent: Number(row.single_punch_counts_as_present ?? 0) === 1,
    fullDayThresholdMinutes:
      threshold === null || threshold === undefined ? null : Number(threshold),
  };
}

/**
 * A missing employee_attendance_exception_bucket table means the environment has not run
 * migration 1652 yet, and the correct reading of that is "nobody is bucketed" — the exact
 * behaviour this file had before the feature existed. Any OTHER error is a real fault and is
 * rethrown: swallowing it would turn a broken lookup into silently unapplied exceptions, which
 * is the failure mode where a privileged employee's day quietly reverts to missing_punch and
 * nobody is told.
 */
function isMissingBucketTable(err: any): boolean {
  return err?.code === 'ER_NO_SUCH_TABLE' || err?.errno === 1146;
}

// ── Service ───────────────────────────────────────────────────────────────────

export const attendanceEngineService = {
  async getShiftWindow(employeeId: string, date: string): Promise<ShiftWindowInfo> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
          COALESCE(wra.shift_start_time, wsm.start_time) AS shift_start_time,
          COALESCE(wra.shift_end_time, wsm.end_time) AS shift_end_time
       FROM wfm_roster_assignment wra
       LEFT JOIN wfm_shift_master wsm ON wsm.id = wra.shift_id
       WHERE wra.employee_id = ? AND wra.roster_date = ?
       ORDER BY FIELD(wra.publish_status, 'approved_final', 'published', 'draft'), wra.updated_at DESC, wra.created_at DESC
       LIMIT 1`,
      [employeeId, date]
    );
    const row = (rows as RowDataPacket[])[0] as any;
    return buildShiftWindowInfo(date, row?.shift_start_time ?? null, row?.shift_end_time ?? null);
  },


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

  // G1: DB-backed attendance-logic resolution (replaces hardcoded isOperationsExecutive).
  // Falls back to regex if apr_eligibility_config table is empty.
  //
  // Returns which of the three logics applies to this employee. A row whose
  // attendance_logic is 'cosec' states "biometric" outright and is excluded from matching
  // here, so it lands on the same answer as no row at all — the difference is that the
  // decision is recorded and visible in the config UI rather than inferred from silence.
  async resolveAttendanceLogic(
    designationId: string | null,
    departmentId: string | null,
    processId: string | null,
    deptNameLower: string,
    desigNameLower: string
  ): Promise<AttendanceLogic> {
    try {
      // First check if any active rules exist in the config table
      const [countRows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM apr_eligibility_config WHERE active_status = 1`
      );
      const configCount = Number((countRows[0] as any).cnt ?? 0);
      if (configCount === 0) {
        // Fall back to legacy regex if config is empty (safe deploy with no seed)
        return isOperationsExecutiveByRegex(deptNameLower, desigNameLower) ? 'apr' : 'cosec';
      }

      // Match: process_id (most specific) > department_id > designation_id > all NULL (global)
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT id, attendance_logic FROM apr_eligibility_config
         WHERE active_status = 1
           AND attendance_logic <> 'cosec'
           AND (designation_id = ? OR designation_id IS NULL)
           AND (department_id  = ? OR department_id  IS NULL)
           AND (process_id     = ? OR process_id     IS NULL)
         ORDER BY
           (CASE WHEN process_id    IS NOT NULL THEN 4 ELSE 0 END +
            CASE WHEN department_id IS NOT NULL THEN 2 ELSE 0 END +
            CASE WHEN designation_id IS NOT NULL THEN 1 ELSE 0 END) DESC
         LIMIT 1`,
        [designationId, departmentId, processId]
      );
      const matched = (rows as RowDataPacket[])[0] as any;
      if (!matched) return 'cosec';
      const logic = String(matched.attendance_logic ?? 'apr') as AttendanceLogic;
      return logic === 'apr_validated_by_cosec' ? 'apr_validated_by_cosec' : 'apr';
    } catch {
      // If table or column doesn't exist yet (migration pending), use regex fallback
      return isOperationsExecutiveByRegex(deptNameLower, desigNameLower) ? 'apr' : 'cosec';
    }
  },

  // Kept for the callers that only need the yes/no answer (apr-attendance.service,
  // attendance-apr-bulk.routes, universalDigitalFormFill, running-salary). Both APR logics
  // read the dialler feed, so both are "APR eligible" to those callers.
  async isAprEligible(
    designationId: string | null,
    departmentId: string | null,
    processId: string | null,
    deptNameLower: string,
    desigNameLower: string
  ): Promise<boolean> {
    const logic = await this.resolveAttendanceLogic(
      designationId, departmentId, processId, deptNameLower, desigNameLower);
    return logic !== 'cosec';
  },

  // Check leave/holiday/week-off overrides.
  // G7: doJ is passed for holiday exclusion in joining month.
  // G12: week-off is NOT returned directly here — caller checks actual attendance first.
  async resolveOverridePriority(
    employeeId: string,
    date: string,
    branchId: string | null,
    dateOfJoining?: string | null,
    costCentreId?: string | null,
    designationId?: string | null,
    employmentEndDate?: string | null
  ): Promise<{ status: AttendanceStatus; isRosterWeekOff?: boolean } | null> {
    // 1. Approved leave
    const [leaveRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM leave_request
       WHERE employee_id = ? AND status = 'approved'
         AND ? BETWEEN from_date AND to_date LIMIT 1`,
      [employeeId, date]
    );
    if ((leaveRows as RowDataPacket[]).length > 0) return { status: 'leave_approved' };

    // 2. Holiday (branch-aware) + cost centre/designation scope + G7 DOJ exclusion
    const dojExclusionEnabled = await getFeatureFlagBool('doj_holiday_exclusion_enabled', true);
    let holidaySql = `
      SELECT lhm.id
      FROM leave_holiday_master lhm
      WHERE lhm.holiday_date = ? AND lhm.active_status = 1
        AND (lhm.branch_id IS NULL OR lhm.branch_id = ?)`;
    const holidayParams: unknown[] = [date, branchId ?? null];
    if (dojExclusionEnabled && dateOfJoining) {
      holidaySql += ` AND lhm.holiday_date >= ?`;
      holidayParams.push(dateOfJoining);
    }
    // Leaver exclusion, the mirror image of the DOJ one above. A holiday falling AFTER an
    // employee's last working day is not theirs: someone who finished on 8 August is owed
    // neither the 15th nor the 28th, someone who finished on the 17th is owed the 15th only,
    // and someone who finished on the 30th is owed both.
    //
    // Without this the engine wrote a 'holiday' row for days after the employee had gone, and
    // because the cost-centre sign-off grid and the attendance register count those rows, a
    // leaver's salary days read higher on screen than payroll pays. Payroll resolves holidays
    // from leave_holiday_master and is separately bounded, so the two disagreed on the same
    // person: 10 salary days on the grid against the 8 payroll pays.
    //
    // Bounded on the same resolved last working day payroll prorates with, so attendance,
    // reports and the payslip cannot part company on when someone stopped being employed.
    if (employmentEndDate) {
      holidaySql += ` AND lhm.holiday_date <= ?`;
      holidayParams.push(String(employmentEndDate).slice(0, 10));
    }
    // Cost centre scope: if mapping exists, employee's cost centre must be mapped
    holidaySql += `
        AND (
          NOT EXISTS (SELECT 1 FROM holiday_cost_centre_mapping WHERE holiday_id = lhm.id)
          OR EXISTS (
            SELECT 1 FROM holiday_cost_centre_mapping hccm
            WHERE hccm.holiday_id = lhm.id AND hccm.cost_centre_id = ?
          )
        )`;
    holidayParams.push(costCentreId ?? null);
    // Designation scope: if mapping exists, employee's designation must be mapped
    holidaySql += `
        AND (
          NOT EXISTS (SELECT 1 FROM holiday_designation_mapping WHERE holiday_id = lhm.id)
          OR EXISTS (
            SELECT 1 FROM holiday_designation_mapping hdm
            WHERE hdm.holiday_id = lhm.id AND hdm.designation_id = ?
          )
        )`;
    holidayParams.push(designationId ?? null);
    holidaySql += ` LIMIT 1`;
    const [holidayRows] = await db.execute<RowDataPacket[]>(holidaySql, holidayParams);
    if ((holidayRows as RowDataPacket[]).length > 0) return { status: 'holiday' };

    // 3. Week off from roster — signal caller with isRosterWeekOff=true so it can
    //    cross-validate against actual Cosec/APR data (G12).
    //
    // This tested roster_status = 'Week Off', a literal that matches ZERO of the 413,386 rows in
    // wfm_roster_assignment — the column only ever holds 'Present' (412,032) or 'published'
    // (1,354). Measured live 2026-08-09. The real marker is the dedicated `is_week_off` tinyint,
    // set on 170 rows. Two engine outcomes were therefore unreachable, and attendance_daily_record
    // holds 0 rows of either status across its whole history: `week_off` never applied, so a
    // rostered day off was graded as an ordinary working day, and G12's `week_off_worked` could
    // never fire.
    //
    // THIS CHANGES PAY, which is why it is called out rather than slipped in. All 170
    // is_week_off rows overlap an attendance record: 16 present, 22 half_day, 23 absent, 109
    // missing_punch. Once the override applies, those 23 stop being absent on their own week-off
    // and the 16 who genuinely worked one regain the flag WFM reviews. Only re-processed days are
    // affected — rows already written are not rewritten by this change.
    //
    // Both predicates are kept. is_week_off is the column the roster actually populates;
    // roster_status is retained so that if any future writer does use the string, it still
    // registers rather than silently reverting to the bug this replaces.
    const [woffRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM wfm_roster_assignment
       WHERE employee_id = ? AND roster_date = ?
         AND (is_week_off = 1 OR roster_status = 'Week Off') LIMIT 1`,
      [employeeId, date]
    );
    if ((woffRows as RowDataPacket[]).length > 0) return { status: 'week_off', isRosterWeekOff: true };

    return null;
  },

  // APR Net_Login minutes for Operations+Executive employees (direct from mas_hrms.apr).
  // Sums across ALL campaigns for the employee on that date — an agent can span multiple
  // campaigns in a day and each row carries per-campaign login time.
  /**
   * Does the dialler feed actually carry this employee?
   *
   * Enrolment, not activity. The question is whether the APR feed knows this
   * agent code at all — not whether they logged in on the day being processed.
   * A covered employee is judged on APR alone: a day with no net login is an
   * absence. An uncovered one keeps the biometric fallback, because docking
   * someone for a system that has never held their code is not an attendance
   * decision, it is an onboarding gap.
   *
   * The 30-day look-back is what makes the two populations separable. Asking only
   * about `date` would answer "did they work today", which is the very thing
   * being judged, and would put every covered employee's quiet day straight into
   * absence via the wrong route. Asking about the whole month would flip an
   * employee's treatment retroactively as rows arrive mid-month.
   *
   * As coverage improves this needs no code change: an employee crosses over on
   * their own, the first time their code appears in the feed.
   */
  async isEnrolledInAprFeed(employeeCode: string, date: string): Promise<boolean> {
    if (!employeeCode) return false;
    try {
      const result = await db.execute<RowDataPacket[]>(
        `SELECT 1 FROM apr
          WHERE UserID = ?
            AND ReportDate BETWEEN DATE_SUB(?, INTERVAL 30 DAY) AND ?
          LIMIT 1`,
        [employeeCode, date, date],
      );
      const rows = (result?.[0] ?? []) as RowDataPacket[];
      return rows.length > 0;
    } catch {
      // Fail to "not covered", never to "covered". An unreachable feed table or a
      // query error must not be the reason someone is judged on a record that
      // could not be read — that direction ends in a day's pay removed. Treating
      // it as uncovered leaves them on the previous behaviour instead.
      return false;
    }
  },

  async getAprNetMinutes(employeeCode: string, date: string, shiftWindow?: ShiftWindowInfo): Promise<number> {
    const dates = shiftWindow?.isNightShift
      ? [shiftWindow.startDate, shiftWindow.endDate]
      : [date];
    const placeholders = dates.map(() => '?').join(', ');
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ReportDate, Net_Login FROM apr WHERE UserID = ? AND ReportDate IN (${placeholders})`,
      [employeeCode, ...dates]
    );
    if (!rows.length) return 0;
    let totalMinutes = 0;
    for (const row of rows as any[]) {
      const netLogin = row.Net_Login as string; // 'HH:MM:SS'
      if (!netLogin) continue;
      const parts = String(netLogin).split(':').map(Number);
      totalMinutes += (parts[0] * 60) + (parts[1] || 0) + Math.round((parts[2] || 0) / 60);
    }
    return totalMinutes;
  },

  // Sum dialler login minutes — fallback join on employee_code if employee_id is null
  async getDiallerMinutes(employeeId: string, date: string, shiftWindow?: ShiftWindowInfo): Promise<number> {
    const dates = shiftWindow?.isNightShift
      ? [shiftWindow.startDate, shiftWindow.endDate]
      : [date];
    const placeholders = dates.map(() => '?').join(', ');
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(dsl.login_minutes), 0) AS total
       FROM dialer_session_log dsl
       WHERE dsl.employee_id = ? AND dsl.session_date IN (${placeholders})`,
      [employeeId, ...dates]
    );
    let total = Number((rows[0] as any).total ?? 0);
    // Fallback: join via employee_code for unlinked imports
    if (total === 0) {
      const [fb] = await db.execute<RowDataPacket[]>(
        `SELECT COALESCE(SUM(dsl.login_minutes), 0) AS total
         FROM dialer_session_log dsl
         JOIN employees e ON e.employee_code = dsl.employee_code
         WHERE e.id = ? AND dsl.session_date IN (${placeholders})`,
        [employeeId, ...dates]
      );
      total = Number((fb[0] as any).total ?? 0);
    }
    return total;
  },

  // Sum biometric login minutes
  async getBiometricMinutes(employeeId: string, date: string): Promise<number> {
    return (await this.getBiometricEvidence(employeeId, date)).minutes;
  },

  // ── Exception bucket lookups (migration 1652) ───────────────────────────────

  /** One employee's active exception row, or null. Used by callers outside processDateBatch. */
  async getExceptionBucket(employeeId: string): Promise<AttendanceExceptionBucket | null> {
    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT employee_id, single_punch_counts_as_present, full_day_threshold_minutes
           FROM employee_attendance_exception_bucket
          WHERE employee_id = ? AND active_status = 1
          LIMIT 1`,
        [employeeId]
      );
      const row = (rows as RowDataPacket[])[0];
      return row ? mapBucketRow(row) : null;
    } catch (err: any) {
      if (isMissingBucketTable(err)) return null;
      throw err;
    }
  },

  /**
   * Every active exception row, keyed by employee_id — one query for a whole batch run rather
   * than one per employee. processDateBatch sweeps ~1,100 employees; the bucket is a handful of
   * people, so this is a small map that answers the question for all of them.
   */
  async getExceptionBucketMap(): Promise<Map<string, AttendanceExceptionBucket>> {
    const map = new Map<string, AttendanceExceptionBucket>();
    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT employee_id, single_punch_counts_as_present, full_day_threshold_minutes
           FROM employee_attendance_exception_bucket
          WHERE active_status = 1`
      );
      for (const row of rows as RowDataPacket[]) {
        const bucket = mapBucketRow(row);
        map.set(bucket.employeeId, bucket);
      }
    } catch (err: any) {
      if (!isMissingBucketTable(err)) throw err;
    }
    return map;
  },

  /**
   * Did COSEC see any punch at all for this employee on this date?
   *
   * This is the evidence behind the single-punch exception, and it has to be asked of
   * biometric_attendance_log rather than of the minutes, because the minutes are exactly what a
   * single punch destroys: cosec-sync.service.ts writes assessAggregatePunches()'s
   * effectiveWorkingMinutes (0 for reason 'single_punch') into raw_minutes, but writes the real
   * punch count and timestamps alongside it. total_punches >= 1 is therefore still true on a day
   * whose minutes are zero — which is precisely the day this exception is about.
   *
   * A person with no punch whatsoever has total_punches = 0 or no row, gets false here, and
   * still lands on missing_punch. The exception credits a partial punch, never an absent one.
   */
  async hasAnyBiometricPunch(employeeId: string, date: string): Promise<boolean> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1
         FROM biometric_attendance_log
        WHERE employee_id = ?
          AND punch_date = ?
          AND (COALESCE(total_punches, 0) >= 1 OR first_punch_in IS NOT NULL)
        LIMIT 1`,
      [employeeId, date]
    );
    return (rows as RowDataPacket[]).length > 0;
  },

  async getBiometricEvidence(
    employeeId: string,
    date: string
  ): Promise<{ minutes: number; sourceSystem: string; sourceReference: string | null }> {
    // Get all sessions for this IST date
    const [sessRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, total_login_minutes, current_status, login_time
       FROM wfm_attendance_session
       WHERE employee_id = ? AND session_date = ?`,
      [employeeId, date]
    );
    const sessions = sessRows as any[];
    let totalMinutes = sessions.reduce((s: number, r: any) => s + Number(r.total_login_minutes ?? 0), 0);
    const sourceRef = sessions.length > 0 ? String(sessions[sessions.length - 1].id) : null;

    // Night-shift cross-midnight merge: if any session on this IST date is Partial and started
    // after 20:00 IST, the shift continues into the next calendar day. Add those early-morning
    // continuation minutes so the full shift is counted against the shift-start date.
    // Feature flag: night_shift_cross_midnight_merge (default on).
    const mergeCrossMidnight = await getFeatureFlagBool('night_shift_cross_midnight_merge', true);
    if (mergeCrossMidnight && sessions.length > 0) {
      const hasNightStart = sessions.some((s: any) => {
        if (s.current_status !== 'Partial' || !s.login_time) return false;
        const loginDate = new Date(s.login_time);
        // Convert UTC to IST minutes-of-day (IST = UTC + 5h30m = +330 min)
        const istMinutesOfDay = (loginDate.getUTCHours() * 60 + loginDate.getUTCMinutes() + 330) % 1440;
        return istMinutesOfDay >= 20 * 60; // after 20:00 IST
      });

      if (hasNightStart) {
        const nextDate = nextIstDate(date);
        const [nextRows] = await db.execute<RowDataPacket[]>(
          `SELECT total_login_minutes, current_status, login_time
           FROM wfm_attendance_session
           WHERE employee_id = ? AND session_date = ?`,
          [employeeId, nextDate]
        );
        for (const s of nextRows as any[]) {
          if (!s.login_time) continue;
          const loginDate = new Date(s.login_time);
          const istMinutesOfDay = (loginDate.getUTCHours() * 60 + loginDate.getUTCMinutes() + 330) % 1440;
          // Include only early-morning sessions (before 08:00 IST) — these are the tail of the
          // night shift that started on `date`, not a new shift that began on the next day.
          if (istMinutesOfDay < 8 * 60) {
            totalMinutes += Number(s.total_login_minutes ?? 0);
          }
        }
      }
    }

    if (totalMinutes > 0) {
      return {
        minutes: totalMinutes,
        sourceSystem: 'wfm_attendance_session',
        sourceReference: sourceRef,
      };
    }

    // Fallback: integration_biometric_daily
    const [intRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(MAX(ibd.biometric_minutes), 0) AS minutes,
              CONCAT('integration:', MAX(ibd.integration_key)) AS source_system,
              CAST(MAX(ibd.id) AS CHAR) AS source_reference
       FROM integration_biometric_daily ibd
       JOIN employees e
         ON e.id = ?
        AND (ibd.employee_code = e.employee_code OR ibd.employee_code = e.biometric_code)
       WHERE ibd.activity_date = ?`,
      [employeeId, date]
    );
    const row = intRows[0] as any;
    const minutes = Number(row?.minutes ?? 0);
    return {
      minutes,
      sourceSystem: minutes > 0 ? String(row?.source_system ?? 'cosec') : 'cosec_policy_absence',
      sourceReference: minutes > 0 ? String(row?.source_reference ?? '') || null : null,
    };
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

    // ── Clock-in: fall back through every source that can carry a first punch ──
    //
    // This previously read ONLY wfm_attendance_session.login_time — the web
    // punch-in table, which is informational and empty for the biometric/COSEC
    // population that actually drives attendance. With no session row the
    // function returned 0, so late_mark was never set for anyone and every
    // "Late Marks" figure in the UI read 0/blank. Fall back to the engine's own
    // clock_in_time and then to the raw biometric log.
    const [clockRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(
                (SELECT was.login_time FROM wfm_attendance_session was
                  WHERE was.employee_id = ? AND was.session_date = ? LIMIT 1),
                (SELECT adr.clock_in_time FROM attendance_daily_record adr
                  WHERE adr.employee_id = ? AND adr.record_date = ? LIMIT 1),
                (SELECT bal.first_punch_in FROM biometric_attendance_log bal
                  WHERE bal.employee_id = ? AND bal.punch_date = ? LIMIT 1)
              ) AS clock_in`,
      [employeeId, date, employeeId, date, employeeId, date]
    );
    const clockInMinutes = minutesOfDay((clockRows[0] as any)?.clock_in);
    if (clockInMinutes === null) return { lateMark: 0, lateByMinutes: 0 };

    // ── Shift start: rostered shift, else the employee's configured hours ──
    //
    // Requiring a published roster row meant employees without one were never
    // marked late. Fall back to employees.working_hours_start.
    //
    // The assignment's own shift_start_time (set at generation time) is read first,
    // matching getShiftWindow() above — wfm_shift_master.start_time is a live,
    // editable value (wfm.service.ts:updateShift has no versioning), and reading it
    // directly here meant every historical late-mark figure for a shift would
    // silently be recomputed under its new time the moment anyone edited the shift,
    // regardless of whether the assignment already had its own snapshot.
    const [shiftRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(
                (SELECT COALESCE(wra.shift_start_time, wsm.start_time) FROM wfm_roster_assignment wra
                   LEFT JOIN wfm_shift_master wsm ON wsm.id = wra.shift_id
                  WHERE wra.employee_id = ? AND wra.roster_date = ? LIMIT 1),
                (SELECT e.working_hours_start FROM employees e WHERE e.id = ? LIMIT 1)
              ) AS start_time`,
      [employeeId, date, employeeId]
    );
    const shiftStartMinutes = minutesOfDay((shiftRows[0] as any)?.start_time);
    // No shift basis at all — cannot judge lateness, so do not guess.
    if (shiftStartMinutes === null) return { lateMark: 0, lateByMinutes: 0 };

    // Minutes-of-day arithmetic avoids the timezone drift of the previous
    // `new Date(date)` + setHours() mix (date parsed as UTC, hours set local).
    let lateByMinutes = clockInMinutes - shiftStartMinutes;
    // Night shift: a shift starting 22:00 with a 01:00 punch is 180 min late,
    // not -1260. Anything more than half a day negative wrapped past midnight.
    if (lateByMinutes < -720) lateByMinutes += 1440;

    if (lateByMinutes > rule.grace_minutes) {
      return { lateMark: 1, lateByMinutes };
    }
    return { lateMark: 0, lateByMinutes: Math.max(0, lateByMinutes) };
  },

  // Review alert when COSEC shows a full shift but net login is below eight hours.
  async checkAndNotifyBiometricMismatch(
    employeeId: string,
    date: string,
    result: EngineResult
  ): Promise<void> {
    if (result.source !== 'dialler') return;
    if ((result.diallerMinutes ?? 0) >= 480) return;
    const bioMinutes = result.biometricMinutes ?? 0;
    if (bioMinutes < 540) return;

    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT user_id, reporting_manager_id, employee_code,
         CONCAT(first_name,' ',COALESCE(last_name,'')) AS full_name
       FROM employees WHERE id = ? LIMIT 1`,
      [employeeId]
    );
    const emp = empRows[0] as any;
    if (!emp) return;

    let managerUserId: string | null = null;
    if (emp.reporting_manager_id) {
      const [managerRows] = await db.execute<RowDataPacket[]>(
        `SELECT user_id FROM employees WHERE id = ? LIMIT 1`, [emp.reporting_manager_id]
      );
      managerUserId = (managerRows[0] as any)?.user_id ?? null;
    }

    const recipients = Array.from(new Set(
      [emp.user_id, managerUserId].filter((userId): userId is string => Boolean(userId))
    ));
    if (recipients.length === 0) return;

    try {
      const { inboxService } = await import('../inbox/inbox.service.js');
      const actionUrl = `/attendance/regularizations?employeeId=${employeeId}&date=${date}`;
      const description =
        `${emp.employee_code} COSEC time is ${(bioMinutes / 60).toFixed(1)} hours on ${date}, `
        + `but net login is ${((result.diallerMinutes ?? 0) / 60).toFixed(1)} hours. `
        + `Attendance is marked ${result.status.replace('_', ' ')} and requires review.`;

      for (const userId of recipients) {
        const [existing] = await db.execute<RowDataPacket[]>(
          `SELECT id FROM work_inbox_item
           WHERE user_id = ? AND type = 'attendance_validation'
             AND entity_id = ? AND action_url = ?
           LIMIT 1`,
          [userId, employeeId, actionUrl]
        );
        if (existing.length > 0) continue;

        await inboxService.createItem({
          user_id: userId,
          type: 'attendance_validation',
          title: userId === emp.user_id
            ? 'Attendance review required'
            : `Attendance mismatch: ${emp.full_name}`,
          description,
          entity_type: 'attendance',
          entity_id: employeeId,
          action_url: actionUrl,
          priority: 'high',
        });
      }
    } catch {
      // Non-fatal
    }
  },

  // Per-employee orchestrator
  //
  // exceptionBucket (migration 1652) is tri-state on purpose:
  //   undefined — not resolved yet, so this function looks it up itself. Every existing caller
  //               that passes two arguments lands here and keeps working unchanged.
  //   null      — already resolved, this employee has no exception. Skips a redundant query.
  //   object    — already resolved, apply it. processDateBatch resolves the whole batch at once.
  async processEmployee(
    employeeId: string,
    date: string,
    exceptionBucket?: AttendanceExceptionBucket | null
  ): Promise<EngineResult> {
    // Fetch employee info including dept/designation/department_id for APR determination
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT e.employee_code, e.designation_id, e.department_id, e.process_id, e.branch_id, e.cost_centre_id,
         e.date_of_joining, e.reporting_manager_id,
         ${EMPLOYMENT_END_DATE_SELECT} AS employment_end_date,
         LOWER(COALESCE(dept.dept_name,'')) AS dept_name,
         LOWER(COALESCE(desig.designation_name,'')) AS designation_name
       FROM employees e
       LEFT JOIN department_master dept ON dept.id = e.department_id
       LEFT JOIN designation_master desig ON desig.id = e.designation_id
       WHERE e.id = ? LIMIT 1`,
      [employeeId]
    );
    if (!(empRows as RowDataPacket[]).length) {
      throw new Error(`Employee ${employeeId} not found`);
    }
    const emp = empRows[0] as any;
    const designationId: string | null = emp.designation_id ?? null;
    const departmentId: string | null = emp.department_id ?? null;
    const processId: string | null = emp.process_id ?? null;
    const branchId: string | null = emp.branch_id ?? null;
    const costCentreId: string | null = emp.cost_centre_id ?? null;
    const dateOfJoining: string | null = emp.date_of_joining ?? null;
    // Resolved last working day — exit_request's confirmed/proposed date, then date_of_exit,
    // then date_of_leaving. Null for anyone still employed.
    const employmentEndDate: string | null = emp.employment_end_date ?? null;
    const shiftWindow = await this.getShiftWindow(employeeId, date);

    // Per-employee COSEC exceptions. Resolved once here and used at every biometric
    // classification point below; an employee with no row behaves exactly as before.
    const bucket = exceptionBucket === undefined
      ? await this.getExceptionBucket(employeeId)
      : exceptionBucket;
    const cosecFullDayMinutes =
      bucket?.fullDayThresholdMinutes ?? COSEC_DEFAULT_FULL_DAY_MINUTES;

    // Resolve rule
    let rule = await this.resolveRule(designationId, processId, branchId, date);

    // G1: DB-backed attendance-logic resolution (replaces hardcoded regex)
    const attendanceLogic = await this.resolveAttendanceLogic(
      designationId, departmentId, processId,
      emp.dept_name, emp.designation_name
    );
    const configuredAprEmployee = attendanceLogic !== 'cosec';

    // Always fetch biometric minutes upfront — needed for G12 week-off cross-validation
    // and for mismatch detection even when employee is APR-eligible.
    const biometricEvidence = await this.getBiometricEvidence(employeeId, date);
    const biometricMinutes = biometricEvidence.minutes;
    const hasScopedDiallerRule = rule.attendance_source === 'dialler'
      && Boolean(rule.designation_id || rule.process_id || rule.branch_id);
    let isAprEmployee = configuredAprEmployee || hasScopedDiallerRule;
    let forcedAprMinutes: number | null = null;
    let forcedAprSourceSystem: string | null = null;

    // Production-safe fallback: if master data is incomplete but the employee belongs to
    // operations and biometric has no evidence for the day, let strong APR/dialler evidence
    // drive the attendance source for that date instead of forcing a missing_punch payroll gap.
    if (!isAprEmployee && biometricMinutes === 0 && isOperationsDepartmentName(emp.dept_name)) {
      const aprMinutes = await this.getAprNetMinutes(emp.employee_code, date, shiftWindow);
      const diallerMinutes = aprMinutes > 0
        ? aprMinutes
        : await this.getDiallerMinutes(employeeId, date, shiftWindow);
      if (diallerMinutes >= 240) {
        isAprEmployee = true;
        forcedAprMinutes = diallerMinutes;
        forcedAprSourceSystem = aprMinutes > 0
          ? (shiftWindow.isNightShift ? 'apr.night_shift_window' : 'apr.ReportDate')
          : (shiftWindow.isNightShift ? 'dialer_session_log.night_shift_window' : 'dialer_session_log.session_date');
      }
    }

    // Check overrides (leave/holiday/week-off) with G7 DOJ holiday exclusion
    const override = await this.resolveOverridePriority(
      employeeId, date, branchId, dateOfJoining, costCentreId, designationId, employmentEndDate
    );

    if (override) {
      // G12: If roster says week_off but employee actually has attendance data, mark week_off_worked.
      //
      // Night-shift cross-midnight guard: a night-shift worker whose roster is e.g. 22:00–07:00
      // punches out at 03:xx on the next calendar day. That next calendar day may be a week-off.
      // The biometric/APR evidence on the week-off date belongs to the previous night's shift —
      // it was already credited when the engine ran for the shift-start date. Firing week_off_worked
      // here would double-count the session and incorrectly penalise the employee.
      //
      // Guard logic: check whether the previous calendar day's roster shift is a cross-midnight
      // (night) shift whose end date lands on `date`. If yes, the evidence on `date` is carryover
      // — skip week_off_worked and fall through to the regular week_off result.
      if (override.isRosterWeekOff) {
        // For APR-strict employees biometric is not the attendance source.
        // Start from zero; only APR minutes count toward week_off_worked for these employees.
        let actualMinutesOnWeekOff = isAprEmployee ? 0 : biometricMinutes;

        if (isAprEmployee) {
          // Check whether previous day's night shift tail is landing on this week-off date.
          const prevDate = prevIstDate(date);
          const prevShiftWindow = await this.getShiftWindow(employeeId, prevDate);
          const isNightShiftCarryover =
            prevShiftWindow.isNightShift && prevShiftWindow.endDate === date;

          if (!isNightShiftCarryover) {
            // Genuine new APR activity on the week-off day — check for it.
            const aprCheck = forcedAprMinutes ?? await this.getAprNetMinutes(emp.employee_code, date, shiftWindow);
            if (aprCheck > 0) actualMinutesOnWeekOff = aprCheck;
          }
          // If isNightShiftCarryover: leave actualMinutesOnWeekOff = 0 → falls through to week_off.
        } else {
          // Biometric employee: same carryover guard applies.
          const prevDate = prevIstDate(date);
          const prevShiftWindow = await this.getShiftWindow(employeeId, prevDate);
          const isNightShiftCarryover =
            prevShiftWindow.isNightShift && prevShiftWindow.endDate === date;
          if (isNightShiftCarryover) {
            // Early-morning biometric sessions are carryover from previous night shift.
            // Only count sessions that started on/after midnight of this week-off date itself
            // (i.e. a genuinely new session, not the tail of yesterday's shift).
            const [weekOffSessions] = await db.execute<RowDataPacket[]>(
              `SELECT COALESCE(SUM(total_login_minutes), 0) AS mins
               FROM wfm_attendance_session
               WHERE employee_id = ? AND session_date = ?
               AND login_time >= CONCAT(?, ' 08:00:00')`,
              [employeeId, date, date]
            );
            actualMinutesOnWeekOff = Number((weekOffSessions[0] as any).mins ?? 0);
          }
        }

        if (actualMinutesOnWeekOff > 0) {
          // Employee genuinely worked on their roster week-off — flag for WFM review
          const wowResult: EngineResult = {
            employeeId, date, processId, branchId,
            source: isAprEmployee ? 'dialler' : 'biometric',
            sourceSystem: isAprEmployee ? 'apr' : biometricEvidence.sourceSystem,
            sourceRecordDate: date,
            sourceReference: isAprEmployee ? null : biometricEvidence.sourceReference,
            diallerMinutes: isAprEmployee ? actualMinutesOnWeekOff : null,
            biometricMinutes: isAprEmployee ? null : (biometricMinutes > 0 ? biometricMinutes : null),
            rawMinutes: actualMinutesOnWeekOff,
            status: 'week_off_worked',
            lwpValue: 0.0,
            lateMark: 0, lateByMinutes: 0,
            ruleConfigId: rule.id === 'fallback' ? null : rule.id,
            biometricStatus: null,
            aprStatus: null,
            mismatchFlag: 0,
          };
          return wowResult;
        }
      }

      // Regular override (leave, holiday, or confirmed week-off with no attendance)
      return {
        employeeId, date, processId, branchId,
        source: isAprEmployee ? 'dialler' : 'biometric',
        sourceSystem: 'attendance_override',
        sourceRecordDate: date,
        sourceReference: null,
        diallerMinutes: null, biometricMinutes: null, rawMinutes: 0,
        status: override.status, lwpValue: 0.0,
        lateMark: 0, lateByMinutes: 0,
        ruleConfigId: rule.id === 'fallback' ? null : rule.id,
        biometricStatus: null,
        aprStatus: null,
        mismatchFlag: 0,
      };
    }

    // Read feature-flagged half-day floor for biometric
    // Both floors resolved once here, before any per-row classification. The two
    // sources measure different things — biometric presence vs dialler net login
    // — so they read separate keys and can be set independently.
    //
    // Both floors now resolve through the same guard. The biometric line used to
    // parse inline as `raw ? Number(raw) : 240`, which yields NaN for a malformed
    // value — and `minutes >= NaN` is false for every input, so a single bad
    // setting would silently classify every biometric day as absent across the
    // whole workforce. resolveHalfDayFloorMinutes refuses an unusable value, logs
    // what it rejected, and applies the default instead. This was noted here as a
    // known follow-up; it is that follow-up.
    const halfDayFloor = await resolveHalfDayFloorMinutes('biometric_half_day_floor_minutes');
    const netLoginHalfDayFloor = await resolveHalfDayFloorMinutes('netlogin_half_day_floor_minutes');

    let diallerMinutes: number | null = null;
    let rawMinutes: number;
    let sourceSystem = biometricEvidence.sourceSystem;
    let sourceReference = biometricEvidence.sourceReference;

    // Raw status for each source (for mismatch detection)
    let biometricStatusRaw: AttendanceStatus | null = null;
    let aprStatusRaw: AttendanceStatus | null = null;
    let mismatchFlag = 0;

    // Tracks which classifier the final status is derived from. Starts as the source
    // the employee is configured for, but an APR employee with no APR evidence falls
    // back to biometric below, and must then be classified as biometric too.
    let classifyAsApr = isAprEmployee;

    // Set inside the APR branch below: whether the dialler feed actually carries
    // this employee. Only someone the feed covers is judged on APR alone.
    let aprFeedCoversEmployee = false;

    if (isAprEmployee) {
      // G4: Classify biometric independently for mismatch comparison
      if (biometricMinutes > 0) {
        biometricStatusRaw = classifyCosecMinutes(biometricMinutes, halfDayFloor, cosecFullDayMinutes).status;
      }

      const aprMinutes = forcedAprMinutes ?? await this.getAprNetMinutes(emp.employee_code, date, shiftWindow);
      diallerMinutes = aprMinutes > 0
        ? aprMinutes
        : await this.getDiallerMinutes(employeeId, date, shiftWindow);
      sourceSystem = forcedAprSourceSystem ?? (aprMinutes > 0
        ? (shiftWindow.isNightShift ? 'apr.night_shift_window' : 'apr.ReportDate')
        : (shiftWindow.isNightShift ? 'dialer_session_log.night_shift_window' : 'dialer_session_log.session_date'));
      sourceReference = emp.employee_code;
      rawMinutes = diallerMinutes ?? 0;
      rule = { ...rule, attendance_source: 'dialler', full_day_minutes: 480, half_day_minutes: 240 };

      aprStatusRaw = classifyOperationsNetLogin(rawMinutes, netLoginHalfDayFloor).status;

      // G4: flag mismatch when both sources have data and they disagree
      if (biometricStatusRaw !== null && biometricStatusRaw !== aprStatusRaw) {
        mismatchFlag = 1;
      }

      // Is this employee actually covered by the dialler feed?
      //
      // Ruling of 2026-08-07: an Operations Executive is judged on APR alone —
      // no biometric fallback — because a short or missing dialler login IS the
      // attendance answer for that role.
      //
      // That applies only to people the feed actually carries. In 2026-08 the
      // feed held 203 of 829 active Operations Executives; the other 626 have no
      // agent code in it at all. Judging those on APR would put zero net-login
      // minutes through the operations classifier and dock a full day's pay for
      // a system they are not enrolled in — measured on live data as 1,577.5
      // paid days removed and 461 people taken to zero paid days in six days of
      // one month. So they keep the biometric fallback until their codes are
      // onboarded, at which point this check flips them over on its own.
      aprFeedCoversEmployee = await this.isEnrolledInAprFeed(emp.employee_code, date);

      // Biometric fallback — for the uncovered population only.
      //
      // When APR has nothing for the day but the employee did punch, classify them on
      // that punch instead. The APR reading stays recorded in aprStatusRaw/diallerMinutes,
      // and mismatch_flag above is unaffected, so the fallback is visible rather than
      // silently rewriting which source was used.
      if (rawMinutes === 0 && biometricMinutes > 0 && !aprFeedCoversEmployee) {
        classifyAsApr = false;
        rawMinutes = biometricMinutes;
        sourceSystem = biometricEvidence.sourceSystem;
        sourceReference = biometricEvidence.sourceReference;
        rule = { ...rule, attendance_source: 'biometric', full_day_minutes: cosecFullDayMinutes, half_day_minutes: halfDayFloor };
      }

      // Third logic: APR validated by COSEC.
      //
      // APR still leads. But where plain 'apr' treats a short net login as the final answer,
      // this asks the biometric feed the same question and keeps whichever reading credits
      // the employee more — someone who was in the building nine hours but logged 300
      // dialler minutes is present, not a half day. It can only raise a day's status, never
      // lower one, so a process moved onto this logic cannot cost anyone pay.
      //
      // Skipped when the fallback above already switched to biometric (nothing left to
      // compare) and when there is no biometric reading to compare against.
      if (attendanceLogic === 'apr_validated_by_cosec'
          && classifyAsApr
          && biometricMinutes > 0
          && statusRank(biometricStatusRaw) > statusRank(aprStatusRaw)) {
        classifyAsApr = false;
        const aprMinutesForTrail = rawMinutes;
        rawMinutes = biometricMinutes;
        sourceSystem = biometricEvidence.sourceSystem;
        // The decision is written into source_reference so the tally is auditable on the
        // row itself — attendance_source alone would say 'biometric' with no hint that APR
        // was consulted first and lost.
        sourceReference = `APR tally: apr=${aprMinutesForTrail}min (${aprStatusRaw}), `
          + `biometric=${biometricMinutes}min (${biometricStatusRaw}) — biometric used`;
        rule = { ...rule, attendance_source: 'biometric', full_day_minutes: cosecFullDayMinutes, half_day_minutes: halfDayFloor };
      }
    } else {
      rule = { ...rule, attendance_source: 'biometric', full_day_minutes: cosecFullDayMinutes, half_day_minutes: halfDayFloor };
      rawMinutes = biometricMinutes;
    }

    // G3: Missing punch — no data from any source AND not on leave/holiday/week-off.
    //
    // Previously gated on `!isAprEmployee`, which meant an APR employee with no evidence
    // anywhere became absent with lwp 1.00 while a biometric employee in the identical
    // state became missing_punch with lwp 0.00, pending WFM review. Same absence of
    // evidence, opposite payroll outcome. Both now take the review path: a day nothing
    // reported on is a gap to resolve, not a proven absence, whichever feed is silent.
    // Someone the dialler feed covers is exempt from this review path: for them a
    // working day with no net login is the attendance answer, not a gap to chase.
    // They go to the classifier below and land on 'absent' with lwp 1.00, per the
    // 2026-08-07 ruling. Pay is unchanged either way — payrollCalculate sets
    // lwpDeduction = 0 and lets absent days reduce finalPayableDays, so absent and
    // missing_punch both pay zero for the day; what changes is that the deduction
    // is now stated rather than left as an unresolved queue item.
    // Single-punch exception (migration 1652) — must be asked BEFORE the missing_punch return
    // below, because that is the branch a single punch actually lands in. assessAggregatePunches
    // zeroes the minutes for reason 'single_punch', so rawMinutes is 0 here and the day would
    // otherwise go to the review queue rather than to any classifier.
    //
    // Scoped to the biometric path (!classifyAsApr): the exception is about what COSEC saw, and
    // an employee being judged on dialler net login has no COSEC punch pair to be missing.
    if (bucket?.singlePunchCountsAsPresent
        && rawMinutes === 0
        && !classifyAsApr
        && await this.hasAnyBiometricPunch(employeeId, date)) {
      const lateResult = await this.calculateLateArrival(employeeId, date, rule);
      return {
        employeeId, date, processId, branchId,
        source: 'biometric',
        // Named so the row itself says why it is present on zero minutes. A reader who finds a
        // present day backed by no working time can tell this was a standing Payroll Head
        // exception and not the engine miscounting.
        sourceSystem: 'cosec_single_punch_exception',
        sourceRecordDate: date,
        sourceReference: 'employee_attendance_exception_bucket: single punch counted as present',
        diallerMinutes: null,
        biometricMinutes: null,
        rawMinutes: 0,
        status: 'present',
        lwpValue: 0.0,
        lateMark: lateResult.lateMark,
        lateByMinutes: lateResult.lateByMinutes,
        ruleConfigId: rule.id === 'fallback' ? null : rule.id,
        biometricStatus: null,
        aprStatus: aprStatusRaw,
        mismatchFlag: 0,
      };
    }

    if (rawMinutes === 0 && !(isAprEmployee && aprFeedCoversEmployee)) {
      const lateResult = await this.calculateLateArrival(employeeId, date, rule);
      return {
        employeeId, date, processId, branchId,
        // Record the feed the employee is actually configured for. Hardcoding 'biometric'
        // here would file an Operations Executive whose APR feed reported nothing as a
        // missed biometric punch, hiding the real gap from whoever reviews the queue.
        source: isAprEmployee ? 'dialler' : 'biometric',
        sourceSystem: isAprEmployee ? 'apr_no_activity' : 'cosec_policy_absence',
        sourceRecordDate: date,
        sourceReference: null,
        diallerMinutes: null,
        biometricMinutes: null,
        rawMinutes: 0,
        status: 'missing_punch',
        lwpValue: 0.0,  // LWP NOT applied until WFM resolves — prevents wrongful deduction
        lateMark: lateResult.lateMark,
        lateByMinutes: lateResult.lateByMinutes,
        ruleConfigId: rule.id === 'fallback' ? null : rule.id,
        biometricStatus: null,
        aprStatus: aprStatusRaw,
        mismatchFlag: 0,
      };
    }

    // Classify — classifyAsApr, not isAprEmployee, so an APR employee who fell back to
    // biometric above is judged on the biometric thresholds their minutes were measured
    // against (540/half-day floor), not APR's net-login ones (480/240).
    const classification = classifyAsApr
      ? classifyOperationsNetLogin(rawMinutes, netLoginHalfDayFloor)
      : classifyCosecMinutes(rawMinutes, halfDayFloor, cosecFullDayMinutes);

    // Late arrival
    const lateResult = await this.calculateLateArrival(employeeId, date, rule);

    return {
      employeeId, date, processId, branchId,
      source: rule.attendance_source,
      sourceSystem,
      sourceRecordDate: date,
      sourceReference,
      diallerMinutes,
      biometricMinutes: biometricMinutes > 0 ? biometricMinutes : null,
      rawMinutes,
      status: classification.status,
      lwpValue: classification.lwpValue,
      lateMark: lateResult.lateMark,
      lateByMinutes: lateResult.lateByMinutes,
      ruleConfigId: rule.id === 'fallback' ? null : rule.id,
      biometricStatus: biometricStatusRaw,
      aprStatus: aprStatusRaw,
      mismatchFlag,
    };
  },

  // DB write — is_locked guard enforced at SQL level. Also writes mismatch columns (G4).
  async upsertDailyRecord(
    result: EngineResult,
    createdBy: string
  ): Promise<AttendanceDailyRecord> {
    await db.execute(
       `INSERT INTO attendance_daily_record
         (id, employee_id, record_date, process_id, branch_id, attendance_source,
          source_system, source_record_date, source_reference,
          dialler_minutes, biometric_minutes, raw_minutes, attendance_status,
          biometric_status, apr_status, mismatch_flag,
          lwp_value, late_mark, late_by_minutes, rule_config_id, processed_at, created_by)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE
         attendance_source  = IF(is_locked = 0, VALUES(attendance_source),  attendance_source),
         source_system      = IF(is_locked = 0, VALUES(source_system),      source_system),
         source_record_date = IF(is_locked = 0, VALUES(source_record_date), source_record_date),
         source_reference   = IF(is_locked = 0, VALUES(source_reference),   source_reference),
         dialler_minutes    = IF(is_locked = 0, VALUES(dialler_minutes),    dialler_minutes),
         biometric_minutes  = IF(is_locked = 0, VALUES(biometric_minutes),  biometric_minutes),
         raw_minutes        = IF(is_locked = 0, VALUES(raw_minutes),        raw_minutes),
         attendance_status  = IF(is_locked = 0, VALUES(attendance_status),  attendance_status),
         biometric_status   = IF(is_locked = 0, VALUES(biometric_status),   biometric_status),
         apr_status         = IF(is_locked = 0, VALUES(apr_status),         apr_status),
         mismatch_flag      = IF(is_locked = 0, VALUES(mismatch_flag),      mismatch_flag),
         lwp_value          = IF(is_locked = 0, VALUES(lwp_value),          lwp_value),
         late_mark          = IF(is_locked = 0, VALUES(late_mark),          late_mark),
         late_by_minutes    = IF(is_locked = 0, VALUES(late_by_minutes),    late_by_minutes),
         rule_config_id     = IF(is_locked = 0, VALUES(rule_config_id),     rule_config_id),
         processed_at       = IF(is_locked = 0, NOW(),                      processed_at),
         created_by         = IF(is_locked = 0, VALUES(created_by),         created_by)`,
      [
        result.employeeId, result.date, result.processId, result.branchId,
        result.source, result.sourceSystem, result.sourceRecordDate, result.sourceReference,
        result.diallerMinutes, result.biometricMinutes, result.rawMinutes,
        result.status,
        result.biometricStatus ?? null,
        result.aprStatus ?? null,
        result.mismatchFlag,
        result.lwpValue, result.lateMark, result.lateByMinutes,
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
       WHERE LOWER(employment_status) = 'active' AND active_status = 1
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

    // Per-employee COSEC exceptions for the whole run — one query, not one per employee.
    const bucketMap = await this.getExceptionBucketMap();

    let processed = 0, skipped = 0, failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < (employees as RowDataPacket[]).length; i += batchSize) {
      const chunk = (employees as RowDataPacket[]).slice(i, i + batchSize);
      const results = await Promise.allSettled(
        chunk.map(async (emp: any) => {
          if (lockedSet.has(emp.employee_id)) { skipped++; return; }
          // ?? null, never undefined: undefined would make processEmployee re-query per employee.
          const result = await this.processEmployee(
            emp.employee_id, date, bucketMap.get(emp.employee_id) ?? null
          );
          await this.upsertDailyRecord(result, 'system');
          // Fire notifications non-blocking
          this.checkAndNotifyBiometricMismatch(emp.employee_id, date, result).catch(() => {});
          if (result.status === 'missing_punch') {
            this.notifyMissingPunch(emp.employee_id, date).catch(() => {});
          }
          if (result.status === 'week_off_worked') {
            this.notifyWeekOffWorked(emp.employee_id, date, result).catch(() => {});
          }
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
      `SELECT adr.*,
         DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS record_date,
         DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS date,
         adr.clock_in_time     AS clock_in,
         adr.clock_out_time    AS clock_out,
         ROUND(adr.raw_minutes / 60, 2) AS total_hours,
         adr.attendance_status AS status,
         adr.clock_in_location  AS clock_in_location_name,
         adr.clock_out_location AS clock_out_location_name
       FROM attendance_daily_record adr
       WHERE adr.employee_id = ? AND adr.record_date = ? LIMIT 1`,
      [employeeId, date]
    );
    const rec = rows[0] as any;
    if (rec) {
      rec.clock_in_time  = toIST(rec.clock_in_time);
      rec.clock_out_time = toIST(rec.clock_out_time);
      rec.clock_in       = toIST(rec.clock_in);
      rec.clock_out      = toIST(rec.clock_out);
    }
    return (rec as AttendanceDailyRecord) ?? null;
  },

  async listRecords(filters: {
    employeeId?: string;
    processId?: string;
    branchId?: string;
    fromDate?: string;
    toDate?: string;
    attendanceStatus?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: AttendanceDailyRecord[]; total: number; page: number; limit: number }> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    const offset = (page - 1) * limit;
    // Return aliased fields that match the frontend's AttendanceRecord shape,
    // plus an employee sub-object for name/code display.
    let q = `SELECT
        adr.*,
        DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS record_date,
        DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS date,
        adr.clock_in_time        AS clock_in,
        adr.clock_out_time       AS clock_out,
        ROUND(adr.raw_minutes / 60, 2) AS total_hours,
        adr.attendance_status    AS status,
        adr.clock_in_location    AS clock_in_location_name,
        adr.clock_out_location   AS clock_out_location_name,
        e.first_name, e.last_name, e.employee_code,
        CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
        e.working_hours_start, e.working_hours_end,
        dm.dept_name AS department_name
      FROM attendance_daily_record adr
      LEFT JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN department_master dm ON dm.id = e.department_id
      WHERE 1=1`;
    const p: unknown[] = [];
    if (filters.employeeId) { q += ' AND adr.employee_id = ?'; p.push(filters.employeeId); }
    if (filters.processId)  { q += ' AND adr.process_id = ?';  p.push(filters.processId); }
    if (filters.branchId)   { q += ' AND adr.branch_id = ?';   p.push(filters.branchId); }
    if (filters.fromDate)   { q += ' AND adr.record_date >= ?'; p.push(filters.fromDate); }
    if (filters.toDate)     { q += ' AND adr.record_date <= ?'; p.push(filters.toDate); }
    if (filters.attendanceStatus) { q += ' AND adr.attendance_status = ?'; p.push(filters.attendanceStatus); }
    const cq = `SELECT COUNT(*) AS total FROM attendance_daily_record adr WHERE 1=1` +
      (filters.employeeId    ? ` AND adr.employee_id = ?`       : '') +
      (filters.processId     ? ` AND adr.process_id = ?`        : '') +
      (filters.branchId      ? ` AND adr.branch_id = ?`         : '') +
      (filters.fromDate      ? ` AND adr.record_date >= ?`      : '') +
      (filters.toDate        ? ` AND adr.record_date <= ?`      : '') +
      (filters.attendanceStatus ? ` AND adr.attendance_status = ?` : '');
    const [countRows] = await db.execute<RowDataPacket[]>(cq, p);
    q += ` ORDER BY adr.record_date DESC LIMIT ${limit} OFFSET ${offset}`;
    const [rows] = await db.execute<RowDataPacket[]>(q, p);
    // Nest employee fields into sub-object to match frontend expectations
    const mapped = (rows as any[]).map(r => ({
      ...r,
      clock_in_time:  toIST(r.clock_in_time),
      clock_out_time: toIST(r.clock_out_time),
      clock_in:       toIST(r.clock_in),
      clock_out:      toIST(r.clock_out),
      employee: {
        first_name: r.first_name ?? '',
        last_name:  r.last_name  ?? '',
        employee_code: r.employee_code ?? '',
        working_hours_start: r.working_hours_start ?? null,
        working_hours_end:   r.working_hours_end   ?? null,
      },
    }));
    return { data: mapped as AttendanceDailyRecord[], total: (countRows[0] as any).total, page, limit };
  },

  async getMonthlySummary(employeeId: string, month: string): Promise<MonthlySummary> {
    const monthStart = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(CASE WHEN attendance_status IN ('present', 'late') THEN 1 END) AS present_days,
         COUNT(CASE WHEN attendance_status = 'half_day'       THEN 1 END) AS half_days,
         COUNT(CASE WHEN attendance_status = 'absent'         THEN 1 END) AS absent_days,
         COUNT(CASE WHEN attendance_status = 'leave_approved' THEN 1 END) AS leave_days,
         COUNT(CASE WHEN attendance_status = 'holiday'        THEN 1 END) AS holiday_days,
         COUNT(CASE WHEN attendance_status = 'week_off'       THEN 1 END) AS week_off_days,
         COALESCE(SUM(lwp_value), 0)                                       AS total_lwp,
         COALESCE(SUM(late_mark), 0)                                       AS late_marks,
         ROUND(COALESCE(SUM(COALESCE(raw_minutes, biometric_minutes, dialler_minutes, 0)), 0) / 60, 2) AS total_hours,
         COUNT(CASE WHEN work_mode IN ('wfo', 'office') THEN 1 END)         AS wfo_days,
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
      totalHours:      Number(r.total_hours),
      wfoDays:         Number(r.wfo_days),
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

  // ---- Attendance logic per process (apr_eligibility_config) -----------------------
  //
  // The engine decides dialler vs biometric from apr_eligibility_config, not from
  // attendance_rule_config — processDay() overwrites the latter's attendance_source in both
  // branches. These two methods are the only supported way to change that decision, and
  // they are what the Attendance Rules Master page writes through.

  /** One row per active process, with the logic currently in force and who it affects. */
  async listProcessAttendanceLogic(): Promise<Array<{
    process_id: string; process_name: string; attendance_logic: AttendanceLogic;
    rule_count: number; employee_count: number;
  }>> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT p.id AS process_id, p.process_name,
              COALESCE(MAX(a.attendance_logic), 'cosec') AS attendance_logic,
              COUNT(a.id) AS rule_count,
              (SELECT COUNT(*) FROM employees e
                WHERE e.process_id = p.id AND e.employment_status = 'active') AS employee_count
         FROM process_master p
         LEFT JOIN apr_eligibility_config a
                ON a.process_id = p.id AND a.active_status = 1 AND a.attendance_logic <> 'cosec'
        WHERE p.active_status = 1
        GROUP BY p.id, p.process_name
        ORDER BY p.process_name`);
    return (rows as any[]).map((r) => ({
      process_id: String(r.process_id),
      process_name: String(r.process_name),
      attendance_logic: String(r.attendance_logic) as AttendanceLogic,
      rule_count: Number(r.rule_count ?? 0),
      employee_count: Number(r.employee_count ?? 0),
    }));
  },

  /**
   * Sets the logic for one process.
   *
   * 'cosec' deactivates the process's rows rather than deleting them, so the previous
   * setting stays visible in the table and is reversible by setting APR again.
   *
   * The other two write one row per (designation, department) pair the table already uses
   * for APR — the Operations executive designations. Taking the pair set from existing rows
   * rather than hardcoding it means a designation added to the scheme later is picked up
   * without touching this code. A process configured while no such pair exists is rejected
   * rather than silently writing nothing.
   */
  async setProcessAttendanceLogic(
    processId: string, logic: AttendanceLogic, actor: string,
  ): Promise<{ deactivated: number; written: number }> {
    if (logic === 'cosec') {
      const [res] = await db.execute<ResultSetHeader>(
        `UPDATE apr_eligibility_config
            SET active_status = 0, updated_at = NOW()
          WHERE process_id = ? AND active_status = 1`, [processId]);
      return { deactivated: res.affectedRows ?? 0, written: 0 };
    }

    const [pairRows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT designation_id, department_id
         FROM apr_eligibility_config
        WHERE designation_id IS NOT NULL AND department_id IS NOT NULL`);
    const pairs = pairRows as any[];
    if (!pairs.length) {
      throw new Error(
        'No designation/department scope exists in apr_eligibility_config to apply this logic to.');
    }

    const [procRows] = await db.execute<RowDataPacket[]>(
      `SELECT process_name FROM process_master WHERE id = ? LIMIT 1`, [processId]);
    const processName = String((procRows as any[])[0]?.process_name ?? processId);

    let written = 0;
    for (const pair of pairs) {
      const [desigRows] = await db.execute<RowDataPacket[]>(
        `SELECT designation_name FROM designation_master WHERE id = ? LIMIT 1`, [pair.designation_id]);
      const desigName = String((desigRows as any[])[0]?.designation_name ?? 'EXECUTIVE');

      // No unique key exists on this table, so ON DUPLICATE KEY UPDATE would append rather
      // than update. Look the row up first.
      const [existing] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM apr_eligibility_config
          WHERE process_id = ? AND designation_id = ? AND department_id = ? LIMIT 1`,
        [processId, pair.designation_id, pair.department_id]);
      const row = (existing as any[])[0];
      if (row) {
        await db.execute(
          `UPDATE apr_eligibility_config
              SET active_status = 1, attendance_logic = ?, updated_at = NOW()
            WHERE id = ?`, [logic, row.id]);
      } else {
        await db.execute(
          `INSERT INTO apr_eligibility_config
             (id, rule_name, designation_id, department_id, process_id, active_status,
              attendance_logic, notes, created_by, created_at, updated_at)
           VALUES (UUID(), ?, ?, ?, ?, 1, ?, ?, ?, NOW(), NOW())`,
          [`APR: ${desigName} / ${processName}`, pair.designation_id, pair.department_id,
           processId, logic, `Set via Attendance Rules Master by ${actor}.`, actor]);
      }
      written++;
    }
    return { deactivated: 0, written };
  },

  // G10: Missing punch inbox notification to employee + reporting manager
  async notifyMissingPunch(employeeId: string, date: string): Promise<void> {
    const enabled = await getFeatureFlagBool('missing_punch_notification_enabled', true);
    if (!enabled) return;

    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT user_id, reporting_manager_id, employee_code,
         CONCAT(first_name,' ',COALESCE(last_name,'')) AS full_name
       FROM employees WHERE id = ? LIMIT 1`,
      [employeeId]
    );
    const emp = empRows[0] as any;
    if (!emp) return;

    let managerUserId: string | null = null;
    if (emp.reporting_manager_id) {
      const [mgr] = await db.execute<RowDataPacket[]>(
        `SELECT user_id FROM employees WHERE id = ? LIMIT 1`, [emp.reporting_manager_id]
      );
      managerUserId = (mgr[0] as any)?.user_id ?? null;
    }

    const recipients = Array.from(new Set(
      [emp.user_id, managerUserId].filter((u): u is string => Boolean(u))
    ));
    if (!recipients.length) return;

    try {
      const { inboxService } = await import('../inbox/inbox.service.js');
      const encodedName = encodeURIComponent(emp.full_name?.trim() ?? '');
      const encodedCode = encodeURIComponent(emp.employee_code ?? '');
      const actionUrl = `/attendance-regularization?employeeId=${employeeId}&date=${date}${encodedName ? `&employeeName=${encodedName}` : ''}${encodedCode ? `&employeeCode=${encodedCode}` : ''}`;
      for (const userId of recipients) {
        const [existing] = await db.execute<RowDataPacket[]>(
          `SELECT id FROM work_inbox_item
           WHERE user_id = ? AND type = 'attendance_missing_punch'
             AND entity_id = ? AND action_url = ? LIMIT 1`,
          [userId, employeeId, actionUrl]
        );
        if (existing.length > 0) continue;
        await inboxService.createItem({
          user_id: userId,
          type: 'attendance_missing_punch',
          title: userId === emp.user_id
            ? `No attendance recorded for ${date}`
            : `Missing punch: ${emp.full_name} on ${date}`,
          description: `${emp.employee_code} has no biometric punch recorded for ${date}. `
            + `This may be a COSEC sync issue. Please verify and submit regularisation if correct.`,
          entity_type: 'attendance',
          entity_id: employeeId,
          action_url: actionUrl,
          priority: 'high',
        });
      }
    } catch { /* non-fatal */ }
  },

  // G12: Week-off worked notification to reporting manager for WFM review
  async notifyWeekOffWorked(employeeId: string, date: string, result: EngineResult): Promise<void> {
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT user_id, reporting_manager_id, employee_code,
         CONCAT(first_name,' ',COALESCE(last_name,'')) AS full_name
       FROM employees WHERE id = ? LIMIT 1`,
      [employeeId]
    );
    const emp = empRows[0] as any;
    if (!emp) return;

    let managerUserId: string | null = null;
    if (emp.reporting_manager_id) {
      const [mgr] = await db.execute<RowDataPacket[]>(
        `SELECT user_id FROM employees WHERE id = ? LIMIT 1`, [emp.reporting_manager_id]
      );
      managerUserId = (mgr[0] as any)?.user_id ?? null;
    }
    if (!managerUserId) return;

    try {
      const { inboxService } = await import('../inbox/inbox.service.js');
      const actionUrl = `/wfm/attendance-mismatches?employeeId=${employeeId}&date=${date}`;
      const [existing] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM work_inbox_item
         WHERE user_id = ? AND type = 'attendance_week_off_worked'
           AND entity_id = ? AND action_url = ? LIMIT 1`,
        [managerUserId, employeeId, actionUrl]
      );
      if (existing.length > 0) return;
      await inboxService.createItem({
        user_id: managerUserId,
        type: 'attendance_week_off_worked',
        title: `Week-off worked: ${emp.full_name} on ${date}`,
        description: `${emp.employee_code} has attendance data recorded (${Math.round(result.rawMinutes / 60 * 10) / 10}h) `
          + `on their roster week-off day ${date}. WFM review required before payroll.`,
        entity_type: 'attendance',
        entity_id: employeeId,
        action_url: actionUrl,
        priority: 'high',
      });
    } catch { /* non-fatal */ }
  },
};
