import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { queueAutoAwards } from "../engagement/badge.service.js";
import { getEffectiveConfig } from "../customization/customization-engine.js";
import { sendSMS } from "../communication/sms.helper.js";
import type {
  AttendanceRegularization,
  PaginatedResult,
  RegularizationListFilters,
  ShiftListFilters,
  WfmAttendanceSession,
  WfmShift,
} from "./wfm.types.js";
import type {
  AttendanceSessionFilters,
  BreakInput,
  ClockInInput,
  CreateShiftInput,
  RegularizationInput,
  ReviewRegularizationInput,
  UpdateShiftInput,
} from "./wfm.validation.js";

// Default attendance policy
const DEFAULT_ATTENDANCE_POLICY = {
  grace_period_minutes: 0,
  late_deduction_threshold: 0,
  allow_self_regularization: false,
  auto_approve_threshold_minutes: 0,
  overtime_multiplier: 1.5,
};

const APR_REGULARIZATION_REASON_CODES = new Set([
  "DIALLER_NOT_LOGGED",
  "SYSTEM_OUTAGE",
  "BIOMETRIC_MISMATCH",
  "INCORRECT_CAMPAIGN",
  "APPROVED_INTERNAL_WORK",
  "TRAINING_OFFLINE",
  "WFH_NOT_CAPTURED",
]);

export function isAprRegularizationReason(reasonCode?: string | null): boolean {
  return APR_REGULARIZATION_REASON_CODES.has(String(reasonCode ?? "").trim().toUpperCase());
}

export function fallbackMinutesForRegularizedStatus(status?: string | null): number {
  if (status === "present") return 480;
  if (status === "half_day") return 240;
  return 0;
}

export const wfmService = {
  // ─── Attendance Policy ─────────────────────────────────────────────────────

  async getAttendancePolicy(employeeId: string): Promise<typeof DEFAULT_ATTENDANCE_POLICY> {
    try {
      const result = await getEffectiveConfig(employeeId, 'attendance_policy', null, DEFAULT_ATTENDANCE_POLICY);
      return result.config as typeof DEFAULT_ATTENDANCE_POLICY;
    } catch (err) {
      console.warn('Customization error for attendance policy:', err);
      return DEFAULT_ATTENDANCE_POLICY;
    }
  },

  // ─── Shifts ────────────────────────────────────────────────────────────────

  async listShifts(filters?: ShiftListFilters, employeeId?: string): Promise<WfmShift[]> {
    let sql = "SELECT * FROM wfm_shift_master";
    if (filters?.activeStatus === "active")   sql += " WHERE active_status = 1";
    if (filters?.activeStatus === "inactive") sql += " WHERE active_status = 0";
    sql += " ORDER BY shift_name ASC";
    const [rows] = await db.execute<RowDataPacket[]>(sql);
    let shifts = rows as WfmShift[];

    // Apply customization if employeeId provided
    if (employeeId) {
      for (const shift of shifts) {
        try {
          const result = await getEffectiveConfig(employeeId, 'shift', shift.id, shift as unknown as Record<string, unknown>);
          Object.assign(shift, result.config);
        } catch (err) {
          console.warn(`Customization error for shift ${shift.id}:`, err);
        }
      }
    }

    return shifts;
  },

  async getShift(id: string): Promise<WfmShift> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM wfm_shift_master WHERE id = ? LIMIT 1", [id]
    );
    const rec = (rows as WfmShift[])[0];
    if (!rec) throw new Error("Shift not found");
    return rec;
  },

  async createShift(input: CreateShiftInput, _userId: string): Promise<WfmShift> {
    const [dup] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM wfm_shift_master WHERE shift_code = ? LIMIT 1", [input.shiftCode]
    );
    if ((dup as RowDataPacket[]).length > 0) throw new Error("Shift code already exists");

    const id = randomUUID();
    await db.execute(
      `INSERT INTO wfm_shift_master (id, shift_code, shift_name, start_time, end_time, required_minutes, branch_name, process_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.shiftCode, input.shiftName, input.startTime, input.endTime,
       input.requiredMinutes, input.branchName ?? null, input.processName ?? null]
    );
    return this.getShift(id);
  },

  async updateShift(id: string, input: UpdateShiftInput, _userId: string): Promise<WfmShift> {
    await this.getShift(id);
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.shiftName       !== undefined) { sets.push("shift_name = ?");        params.push(input.shiftName); }
    if (input.startTime       !== undefined) { sets.push("start_time = ?");        params.push(input.startTime); }
    if (input.endTime         !== undefined) { sets.push("end_time = ?");          params.push(input.endTime); }
    if (input.requiredMinutes !== undefined) { sets.push("required_minutes = ?");  params.push(input.requiredMinutes); }
    if (input.branchName      !== undefined) { sets.push("branch_name = ?");       params.push(input.branchName ?? null); }
    if (input.processName     !== undefined) { sets.push("process_name = ?");      params.push(input.processName ?? null); }
    if (input.activeStatus    !== undefined) { sets.push("active_status = ?");     params.push(input.activeStatus ? 1 : 0); }
    if (sets.length > 0) {
      params.push(id);
      await db.execute(`UPDATE wfm_shift_master SET ${sets.join(", ")} WHERE id = ?`, params);
    }
    return this.getShift(id);
  },

  // ─── Attendance Sessions ───────────────────────────────────────────────────

  async clockIn(input: ClockInInput & { employeeId: string }, _userId: string): Promise<WfmAttendanceSession> {
    const [existing] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM wfm_attendance_session WHERE employee_id = ? AND session_date = ? LIMIT 1",
      [input.employeeId, input.sessionDate]
    );
    if ((existing as RowDataPacket[]).length > 0) throw new Error("Session already exists for this date");

    const id = randomUUID();
    await db.execute(
      `INSERT INTO wfm_attendance_session
         (id, employee_id, session_date, login_time, current_status, punch_source, branch_name, process_name)
       VALUES (?, ?, ?, NOW(), 'Logged In', ?, ?, ?)`,
      [id, input.employeeId, input.sessionDate, input.punchSource,
       input.branchName ?? null, input.processName ?? null]
    );
    return this.getSession(id);
  },

  async clockOut(sessionId: string, _userId: string): Promise<WfmAttendanceSession> {
    const session = await this.getSession(sessionId);
    const loginTime = new Date(session.login_time!);
    const now = new Date();
    const minutes = Math.round((now.getTime() - loginTime.getTime()) / 60000);
    await db.execute(
      `UPDATE wfm_attendance_session
          SET logout_time = NOW(), total_login_minutes = ?, current_status = 'Logged Out'
        WHERE id = ?`,
      [minutes, sessionId]
    );
    const updatedSession = await this.getSession(sessionId);
    queueAutoAwards(session.employee_id, "attendance");
    return updatedSession;
  },

  async getSession(id: string): Promise<WfmAttendanceSession> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM wfm_attendance_session WHERE id = ? LIMIT 1", [id]
    );
    const rec = (rows as WfmAttendanceSession[])[0];
    if (!rec) throw new Error("Session not found");
    return rec;
  },

  async listSessions(filters: AttendanceSessionFilters): Promise<PaginatedResult<WfmAttendanceSession>> {
    const { page, limit, employeeId, fromDate, toDate, status, processName } = filters;
    const offset = (page - 1) * limit;
    const conds: string[] = [];
    const params: unknown[] = [];
    if (employeeId)  { conds.push("employee_id = ?");   params.push(employeeId); }
    if (fromDate)    { conds.push("session_date >= ?");  params.push(fromDate); }
    if (toDate)      { conds.push("session_date <= ?");  params.push(toDate); }
    if (status)      { conds.push("current_status = ?"); params.push(status); }
    if (processName) { conds.push("process_name = ?");   params.push(processName); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM wfm_attendance_session ${where} ORDER BY session_date DESC LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM wfm_attendance_session ${where}`, params
    );
    return { data: rows as WfmAttendanceSession[], total: (countRows as any)[0]?.total ?? 0, page, limit };
  },

  async logBreak(input: BreakInput, employeeId: string): Promise<void> {
    await db.execute(
      `INSERT INTO wfm_break_log (id, session_id, employee_id, break_start, break_type)
       VALUES (UUID(), ?, ?, NOW(), ?)`,
      [input.sessionId, employeeId, input.breakType]
    );
  },

  async getBreaksForSession(sessionId: string): Promise<any[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, session_id, employee_id, break_start, break_end, duration_minutes, break_type, created_at
       FROM wfm_break_log WHERE session_id = ? ORDER BY break_start DESC`,
      [sessionId]
    );
    return rows as any[];
  },

  async endBreak(breakId: string, employeeId: string): Promise<void> {
    await db.execute(
      `UPDATE wfm_break_log
       SET break_end = NOW(), duration_minutes = TIMESTAMPDIFF(MINUTE, break_start, NOW())
       WHERE id = ? AND employee_id = ? AND break_end IS NULL`,
      [breakId, employeeId]
    );
  },

  // ─── Regularization ───────────────────────────────────────────────────────

  async listReasons(allowedFor?: 'employee' | 'manager'): Promise<{ code: string; label: string; allowed_for: string }[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      allowedFor
        ? `SELECT code, label, allowed_for FROM attendance_reason_master WHERE active = 1 AND (allowed_for = ? OR allowed_for = 'both') ORDER BY label`
        : `SELECT code, label, allowed_for FROM attendance_reason_master WHERE active = 1 ORDER BY label`,
      allowedFor ? [allowedFor] : []
    );
    return rows as any[];
  },

  async submitRegularization(
    input: RegularizationInput & { employeeId: string; requestedByType?: 'employee' | 'manager' },
    _userId: string
  ): Promise<AttendanceRegularization> {
    // Duplicate check — block if any active (non-terminal) regularization exists for this date
    const [dupRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, status FROM attendance_regularization
        WHERE employee_id = ? AND session_date = ?
          AND status NOT IN ('rejected', 'cancelled')
        LIMIT 1`,
      [input.employeeId, input.sessionDate]
    );
    if ((dupRows as RowDataPacket[]).length > 0) {
      const existingStatus = (dupRows[0] as any).status;
      throw new Error(
        `A regularization request for this date already exists with status: ${existingStatus}. ` +
        `It must be rejected or cancelled before a new request can be submitted.`
      );
    }

    // Validate reason_code if provided
    if (input.reasonCode) {
      const [rr] = await db.execute<RowDataPacket[]>(
        `SELECT allowed_for FROM attendance_reason_master WHERE code = ? AND active = 1`,
        [input.reasonCode]
      );
      if (!(rr as RowDataPacket[]).length) throw new Error('Invalid reason code');
      const af = (rr[0] as any).allowed_for;
      const byType = input.requestedByType ?? 'employee';
      if (af !== 'both' && af !== byType) {
        throw new Error(`Reason '${input.reasonCode}' is not allowed for ${byType}`);
      }
    }

    // Get branch_id and reporting manager for routing
    const [empRow] = await db.execute<RowDataPacket[]>(
      `SELECT branch_id, reporting_manager_id, manager_id FROM employees WHERE id = ? LIMIT 1`, [input.employeeId]
    );
    const branchId = (empRow[0] as any)?.branch_id ?? null;
    const managerEmpId = (empRow[0] as any)?.reporting_manager_id ?? (empRow[0] as any)?.manager_id ?? null;

    const id = randomUUID();
    const inp = input as any;
    await db.execute(
      `INSERT INTO attendance_regularization
         (id, employee_id, session_date, requested_status, reason, reason_code,
          requested_by_type, branch_id, supporting_note,
          dispute_type, old_status, new_status,
          old_punch_in, old_punch_out, new_punch_in, new_punch_out,
          supporting_doc_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.employeeId, input.sessionDate,
       inp.requestedStatus ?? null,
       input.reason,
       input.reasonCode ?? null,
       input.requestedByType ?? 'employee',
       branchId,
       input.supportingNote ?? null,
       inp.disputeType ?? null,
       inp.oldStatus ?? null,
       inp.newStatus ?? inp.requestedStatus ?? null,
       inp.oldPunchIn ?? null,
       inp.oldPunchOut ?? null,
       inp.newPunchIn ?? null,
       inp.newPunchOut ?? null,
       inp.supportingDocId ?? null]
    );

    // Notify reporting manager and WFM lead(s) via work inbox
    try {
      const [empInfo] = await db.execute<RowDataPacket[]>(
        `SELECT employee_code, CONCAT(first_name,' ',COALESCE(last_name,'')) AS full_name
         FROM employees WHERE id = ? LIMIT 1`, [input.employeeId]
      );
      const emp = (empInfo[0] as any);
      const { inboxService } = await import('../inbox/inbox.service.js');
      const title = `Attendance Regularization: ${emp?.full_name ?? input.employeeId}`;
      const description = `${emp?.employee_code ?? ''} requested ${(input as any).requestedStatus ?? 'correction'} on ${input.sessionDate}. Reason: ${input.reason}`;

      // Step 1: Notify reporting manager — this is Stage 1 of the approval flow
      if (managerEmpId) {
        const [mgRows] = await db.execute<RowDataPacket[]>(
          `SELECT user_id FROM employees WHERE id = ? AND user_id IS NOT NULL LIMIT 1`,
          [managerEmpId]
        );
        const managerUserId = (mgRows[0] as any)?.user_id ?? null;
        if (managerUserId) {
          await inboxService.createItem({
            user_id: managerUserId,
            type: 'attendance_regularization',
            title,
            description: `[ACTION REQUIRED - Stage 1] ${description}`,
            entity_type: 'attendance',
            entity_id: input.employeeId,
            action_url: `/attendance/regularizations`,
            priority: 'high',
          });
        }
      }

      // Step 2: Also notify WFM leads for visibility (they act in Stage 2)
      if (branchId) {
        const [wfmRows] = await db.execute<RowDataPacket[]>(
          `SELECT e.user_id FROM user_assignment_scope uas
           JOIN employees e ON e.id = uas.manager_employee_id
           WHERE uas.role_key = 'wfm' AND uas.branch_id = ? AND e.user_id IS NOT NULL`,
          [branchId]
        );
        for (const wfm of wfmRows as any[]) {
          if (!wfm.user_id) continue;
          await inboxService.createItem({
            user_id: wfm.user_id,
            type: 'attendance_regularization',
            title,
            description: `[WFM - Pending manager approval] ${description}`,
            entity_type: 'attendance',
            entity_id: input.employeeId,
            action_url: `/attendance/regularizations`,
            priority: 'normal',
          });
        }
      }
    } catch {
      // Non-fatal — notification failure should not block submission
    }

    // SMS — regularization submitted (fire-and-forget)
    try {
      const [empRow] = await db.execute<RowDataPacket[]>(
        `SELECT CONCAT(first_name,' ',COALESCE(last_name,'')) AS name, mobile, personal_phone
         FROM employees WHERE id = ? LIMIT 1`, [input.employeeId]
      );
      const emp = (empRow[0] as any);
      const phone = emp?.mobile ?? emp?.personal_phone ?? null;
      if (phone) {
        sendSMS(phone, 'attendance_regularization_submitted', {
          name: emp.name,
          date: input.sessionDate,
        }).catch(() => {});
      }
    } catch { /* non-fatal */ }

    return this.getRegularization(id);
  },

  async getRegularization(id: string): Promise<AttendanceRegularization> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ar.*,
         CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
         e.employee_code,
         arm.label AS reason_label
       FROM attendance_regularization ar
       LEFT JOIN employees e ON e.id = ar.employee_id
       LEFT JOIN attendance_reason_master arm ON arm.code = ar.reason_code
       WHERE ar.id = ? LIMIT 1`, [id]
    );
    const rec = (rows as AttendanceRegularization[])[0];
    if (!rec) throw new Error("Regularization not found");
    return rec;
  },

  async reviewRegularization(
    id: string,
    input: ReviewRegularizationInput,
    reviewerId: string
  ): Promise<AttendanceRegularization> {
    const reg = await this.getRegularization(id);
    const conn = await db.getConnection();
    await conn.beginTransaction();
    try {
      await conn.execute(
        `UPDATE attendance_regularization
            SET status = ?, reviewed_by = ?, reviewed_at = NOW(), reviewer_note = ?
          WHERE id = ?`,
        [input.status, reviewerId, input.reviewerNote ?? null, id]
      );

      // If approved, apply correction to attendance_daily_record atomically.
      // Exception-type regularizations (work_from_home, week_off_worked, holiday_worked) have
      // requested_status=NULL — they always resolve to 'present' with lwp_value=0.
      const EXCEPTION_DISPUTE_TYPES = ['work_from_home', 'week_off_worked', 'holiday_worked'];
      const effectiveRequestedStatus = reg.requested_status ||
        (EXCEPTION_DISPUTE_TYPES.includes(reg.dispute_type as string) ? 'present' : null);

      if (input.status === 'approved' && effectiveRequestedStatus) {
        const lwpMap: Record<string, number> = { present: 0, half_day: 0.5, absent: 1.0 };

        // Capture before-state for audit trail
        const [existingRows] = (await conn.execute(
          `SELECT attendance_status, lwp_value, raw_minutes, dialler_minutes,
                  is_locked, regularization_id, override_by
             FROM attendance_daily_record
            WHERE employee_id = ? AND record_date = ? LIMIT 1`,
          [reg.employee_id, reg.session_date]
        )) as [RowDataPacket[], unknown];
        const existing = (existingRows as RowDataPacket[])[0] as any;

        if (
          existing &&
          Number(existing.is_locked ?? 0) === 1 &&
          (
            (existing.regularization_id && existing.regularization_id !== id) ||
            (existing.override_by && existing.override_by !== reviewerId)
          )
        ) {
          throw new Error(
            `Attendance record is already locked by another correction for employee ${reg.employee_id} on ${reg.session_date}.`
          );
        }

        const [aprRows] = (await conn.execute(
          `SELECT ROUND(COALESCE(SUM(TIME_TO_SEC(Net_Login)), 0) / 60) AS apr_minutes
             FROM apr
            WHERE UserID = (SELECT employee_code FROM employees WHERE id = ? LIMIT 1)
              AND ReportDate = ?`,
          [reg.employee_id, reg.session_date]
        )) as [RowDataPacket[], unknown];
        const aprMinutes = Number((aprRows[0] as any)?.apr_minutes ?? 0);
        const regularizedMinutes = Number(existing?.raw_minutes ?? existing?.dialler_minutes ?? 0)
          || aprMinutes
          || fallbackMinutesForRegularizedStatus(effectiveRequestedStatus);
        const sourceSystem = isAprRegularizationReason(reg.reason_code) ? "apr_regularization" : "regularization";

        const [adrResult] = await conn.execute(
          `INSERT INTO attendance_daily_record
             (id, employee_id, record_date, attendance_source, source_system, source_record_date,
              source_reference, dialler_minutes, raw_minutes, attendance_status, lwp_value,
              late_mark, late_by_minutes, regularization_id, override_by, override_reason,
              is_locked, processed_at, created_by, old_attendance_status, old_lwp_value,
              status_change_reason, status_changed_by, status_changed_at, clock_in_time, clock_out_time)
           VALUES
             (UUID(), ?, ?, 'dialler', ?, ?, ?, ?, ?, ?, ?,
              0, 0, ?, ?, ?, 1, NOW(), ?,
              ?, ?, ?, ?, NOW(),
              IF(? IS NOT NULL, TIMESTAMP(?, ?), NULL),
              IF(? IS NOT NULL, TIMESTAMP(?, ?), NULL))
           ON DUPLICATE KEY UPDATE
              attendance_source = IF(is_locked = 0 OR regularization_id = VALUES(regularization_id), 'dialler', attendance_source),
              source_system = IF(is_locked = 0 OR regularization_id = VALUES(regularization_id), VALUES(source_system), source_system),
              source_record_date = IF(is_locked = 0 OR regularization_id = VALUES(regularization_id), VALUES(source_record_date), source_record_date),
              source_reference = IF(is_locked = 0 OR regularization_id = VALUES(regularization_id), VALUES(source_reference), source_reference),
              dialler_minutes = IF(is_locked = 0 OR regularization_id = VALUES(regularization_id), VALUES(dialler_minutes), dialler_minutes),
              raw_minutes = IF(is_locked = 0 OR regularization_id = VALUES(regularization_id), VALUES(raw_minutes), raw_minutes),
              attendance_status = IF(is_locked = 0 OR regularization_id = VALUES(regularization_id), VALUES(attendance_status), attendance_status),
              lwp_value = IF(is_locked = 0 OR regularization_id = VALUES(regularization_id), VALUES(lwp_value), lwp_value),
              override_by = IF(is_locked = 0 OR regularization_id = VALUES(regularization_id), VALUES(override_by), override_by),
              override_reason = IF(is_locked = 0 OR regularization_id = VALUES(regularization_id), VALUES(override_reason), override_reason),
              regularization_id = IF(is_locked = 0 OR regularization_id = VALUES(regularization_id), VALUES(regularization_id), regularization_id),
              is_locked = IF(is_locked = 0 OR regularization_id = VALUES(regularization_id), 1, is_locked),
              processed_at = IF(is_locked = 0 OR regularization_id = VALUES(regularization_id), NOW(), processed_at),
              old_attendance_status = IF(is_locked = 0 OR regularization_id = VALUES(regularization_id), VALUES(old_attendance_status), old_attendance_status),
              old_lwp_value = IF(is_locked = 0 OR regularization_id = VALUES(regularization_id), VALUES(old_lwp_value), old_lwp_value),
              status_change_reason = IF(is_locked = 0 OR regularization_id = VALUES(regularization_id), VALUES(status_change_reason), status_change_reason),
              status_changed_by = IF(is_locked = 0 OR regularization_id = VALUES(regularization_id), VALUES(status_changed_by), status_changed_by),
              status_changed_at = IF(is_locked = 0 OR regularization_id = VALUES(regularization_id), NOW(), status_changed_at),
              clock_in_time = IF((is_locked = 0 OR regularization_id = VALUES(regularization_id)) AND VALUES(clock_in_time) IS NOT NULL, VALUES(clock_in_time), clock_in_time),
              clock_out_time = IF((is_locked = 0 OR regularization_id = VALUES(regularization_id)) AND VALUES(clock_out_time) IS NOT NULL, VALUES(clock_out_time), clock_out_time)`,
          [
           reg.employee_id, reg.session_date,
           sourceSystem, reg.session_date, reg.reason_code ?? id,
           regularizedMinutes, regularizedMinutes,
           effectiveRequestedStatus, lwpMap[effectiveRequestedStatus] ?? 0,
           id, reviewerId, `Regularization approved: ${reg.reason_code ?? reg.reason}`,
           reviewerId,
           existing?.attendance_status ?? null,
           existing?.lwp_value ?? null,
           `Regularization approved: ${reg.reason_code ?? reg.reason}`,
           reviewerId,
           reg.new_punch_in ?? null, reg.session_date, reg.new_punch_in ?? null,
           reg.new_punch_out ?? null, reg.session_date, reg.new_punch_out ?? null]
        ) as any;

        if ((adrResult as any).affectedRows === 0) {
          throw new Error(`Attendance record could not be corrected for employee ${reg.employee_id} on ${reg.session_date}.`);
        }
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      conn.release();
      throw err;
    }
    conn.release();

    // A reviewed regularization is no longer anybody's pending work, so close
    // the alerts that were chasing it. Stage-1 approval is deliberately not
    // treated as done — it moves to WFM, and the block below raises their
    // alert. Both keys are closed because alerts carry the employee id, and
    // the request id is accepted too so the fix survives that being corrected.
    if ((input.status as string) !== 'manager_approved') {
      // One statement rather than four: every alert this decision settles is
      // closed atomically, and the review path keeps a single extra round trip.
      //   1. the alert for this specific request;
      //   2. the legacy employee-keyed alert, but only once nothing else of
      //      theirs is still in flight — it stands for "this person has a
      //      regularization to review", so it must outlive a partial clear-out;
      //   3. the missing-punch and validation alerts for that same date, which
      //      this regularization is the answer to. Those carry the date in
      //      action_url rather than a column, so they match on the URL suffix.
      // The pool runs dateStrings, so session_date is already YYYY-MM-DD;
      // sliced regardless so an ISO timestamp could never break the match.
      const sessionDate = String(reg.session_date).slice(0, 10);
      await db.execute(
        `UPDATE work_inbox_item
            SET is_actioned = 1, is_read = 1
          WHERE is_actioned = 0
            AND entity_type = 'attendance'
            AND (
                  (type = 'attendance_regularization' AND entity_id = ?)
               OR (type = 'attendance_regularization' AND entity_id = ?
                   AND NOT EXISTS (
                     SELECT 1 FROM attendance_regularization ar
                      WHERE ar.employee_id = ?
                        AND ar.status NOT IN ('approved','rejected','cancelled') ))
               OR (type IN ('attendance_missing_punch','attendance_validation')
                   AND entity_id = ? AND action_url LIKE CONCAT('%date=', ?))
            )`,
        [id, reg.employee_id, reg.employee_id, reg.employee_id, sessionDate]
      ).catch(() => { /* non-fatal: the reconciliation sweep will catch it */ });
    }

    // When manager approves (stage 1 → manager_approved), escalate to WFM for final action
    if ((input.status as string) === 'manager_approved') {
      try {
        const [empInfo] = await db.execute<RowDataPacket[]>(
          `SELECT e.employee_code,
                  CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS full_name,
                  e.branch_id
           FROM employees e WHERE e.id = ? LIMIT 1`, [reg.employee_id]
        );
        const emp = (empInfo[0] as any);
        if (emp?.branch_id) {
          const [wfmRows] = await db.execute<RowDataPacket[]>(
            `SELECT e2.user_id FROM user_assignment_scope uas
             JOIN employees e2 ON e2.id = uas.manager_employee_id
             WHERE uas.role_key = 'wfm' AND uas.branch_id = ? AND e2.user_id IS NOT NULL`,
            [emp.branch_id]
          );
          const { inboxService } = await import('../inbox/inbox.service.js');
          for (const wfm of wfmRows as any[]) {
            if (!wfm.user_id) continue;
            await inboxService.createItem({
              user_id: wfm.user_id,
              type: 'attendance_regularization',
              title: `[ACTION REQUIRED] Manager Approved: ${emp?.full_name ?? reg.employee_id}`,
              description: `${emp?.employee_code ?? ''} regularization for ${reg.session_date} is awaiting WFM final approval.`,
              entity_type: 'attendance',
              entity_id: reg.employee_id,
              action_url: `/attendance/regularizations`,
              priority: 'high',
            });
          }
        }
      } catch {
        // Non-fatal
      }
    }

    // SMS — regularization approved or rejected (fire-and-forget)
    try {
      const [empRow] = await db.execute<RowDataPacket[]>(
        `SELECT CONCAT(first_name,' ',COALESCE(last_name,'')) AS name, mobile, personal_phone
         FROM employees WHERE id = ? LIMIT 1`, [reg.employee_id]
      );
      const emp = (empRow[0] as any);
      const phone = emp?.mobile ?? emp?.personal_phone ?? null;
      if (phone) {
        const key = input.status === 'approved'
          ? 'attendance_regularization_approved'
          : 'attendance_regularization_rejected';
        const vars: Record<string, string> = { name: emp.name, date: reg.session_date };
        if (input.status !== 'approved') vars.reason = input.reviewerNote ?? 'Not specified';
        sendSMS(phone, key, vars).catch(() => {});
      }
    } catch { /* non-fatal */ }

    if (input.status === 'approved') {
      try {
        const { recalculateOpenPayrollForEmployee } = await import('../payroll/payroll-targeted-recalculation.service.js');
        await recalculateOpenPayrollForEmployee({
          employeeId: reg.employee_id,
          payrollMonth: String(reg.session_date).slice(0, 7),
          sourceEventType: 'attendance_regularization',
          sourceEventId: id,
          reason: `Approved attendance regularization ${id}`,
          actorUserId: reviewerId,
        });
      } catch (err: any) {
        try {
          const { queuePayrollRecalculation } = await import('../payroll/payroll-targeted-recalculation.service.js');
          await queuePayrollRecalculation({
            employeeId: reg.employee_id,
            payrollMonth: String(reg.session_date).slice(0, 7),
            sourceEventType: 'attendance_regularization',
            sourceEventId: id,
            reason: `Approved regularization payroll recalculation failed: ${err?.message ?? String(err)}`,
            requestedBy: reviewerId,
          });
        } catch {
          // Non-fatal: attendance approval is committed; payroll readiness will surface stale lines.
        }
      }
    }

    return this.getRegularization(id);
  },

  async listRegularizations(filters: RegularizationListFilters): Promise<AttendanceRegularization[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.employeeId) { conds.push("ar.employee_id = ?"); params.push(filters.employeeId); }
    if (filters.status)     { conds.push("ar.status = ?");      params.push(filters.status); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ar.*,
         COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
         e.employee_code,
         b.branch_name,
         p.process_name,
         arm.label AS reason_label,
         adr.attendance_status AS current_attendance_status,
         adr.clock_in_time AS first_punch,
         adr.clock_out_time AS last_punch,
         adr.biometric_minutes
       FROM attendance_regularization ar
       LEFT JOIN employees e ON e.id = ar.employee_id
       LEFT JOIN branch_master b ON b.id = COALESCE(ar.branch_id, e.branch_id)
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN attendance_reason_master arm ON arm.code = ar.reason_code
       LEFT JOIN attendance_daily_record adr ON adr.employee_id = ar.employee_id AND adr.record_date = ar.session_date
       ${where}
       ORDER BY ar.created_at DESC`, params
    );
    return rows as AttendanceRegularization[];
  },
};
