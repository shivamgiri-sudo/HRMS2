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

      // If approved AND requested_status is set, apply it to attendance_daily_record atomically
      if (input.status === 'approved' && reg.requested_status) {
        const lwpMap: Record<string, number> = { present: 0, half_day: 0.5, absent: 1.0 };

        // Capture before-state for audit trail
        const [existingRows] = (await conn.execute(
          `SELECT attendance_status, lwp_value
             FROM attendance_daily_record
            WHERE employee_id = ? AND record_date = ? LIMIT 1`,
          [reg.employee_id, reg.session_date]
        )) as [RowDataPacket[], unknown];
        const existing = (existingRows as RowDataPacket[])[0] as any;

        const [adrResult] = await conn.execute(
          `UPDATE attendance_daily_record
              SET attendance_status = ?, lwp_value = ?,
                  override_by = ?, override_reason = ?,
                  regularization_id = ?, is_locked = 1, processed_at = NOW(),
                  old_attendance_status = ?, old_lwp_value = ?,
                  status_change_reason = ?, status_changed_by = ?, status_changed_at = NOW(),
                  clock_in_time  = IF(? IS NOT NULL, TIMESTAMP(record_date, ?), clock_in_time),
                  clock_out_time = IF(? IS NOT NULL, TIMESTAMP(record_date, ?), clock_out_time)
            WHERE employee_id = ? AND record_date = ?`,
          [reg.requested_status, lwpMap[reg.requested_status] ?? 0,
           reviewerId, `Regularization approved: ${reg.reason_code ?? reg.reason}`,
           id,
           existing?.attendance_status ?? null,
           existing?.lwp_value ?? null,
           `Regularization approved: ${reg.reason_code ?? reg.reason}`,
           reviewerId,
           reg.new_punch_in ?? null, reg.new_punch_in ?? null,
           reg.new_punch_out ?? null, reg.new_punch_out ?? null,
           reg.employee_id, reg.session_date]
        ) as any;

        if ((adrResult as any).affectedRows === 0) {
          // No ADR row exists — rollback so regularization status is NOT changed without attendance correction
          await conn.rollback();
          conn.release();
          throw new Error(
            `No attendance_daily_record found for employee ${reg.employee_id} on ${reg.session_date}. ` +
            `Create the attendance record first before approving this regularization.`
          );
        }
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      conn.release();
      throw err;
    }
    conn.release();

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
         CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
         e.employee_code,
         arm.label AS reason_label
       FROM attendance_regularization ar
       LEFT JOIN employees e ON e.id = ar.employee_id
       LEFT JOIN attendance_reason_master arm ON arm.code = ar.reason_code
       ${where}
       ORDER BY ar.created_at DESC`, params
    );
    return rows as AttendanceRegularization[];
  },
};
