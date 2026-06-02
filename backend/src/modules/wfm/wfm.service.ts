import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { queueAutoAwards } from "../engagement/badge.service.js";
import { getEffectiveConfig } from "../customization/customization-engine.js";
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
          const result = await getEffectiveConfig(employeeId, 'shift', shift.id, shift);
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

  async clockIn(input: ClockInInput, _userId: string): Promise<WfmAttendanceSession> {
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

  // ─── Regularization ───────────────────────────────────────────────────────

  async submitRegularization(
    input: RegularizationInput,
    _userId: string
  ): Promise<AttendanceRegularization> {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO attendance_regularization (id, employee_id, session_date, reason, supporting_note)
       VALUES (?, ?, ?, ?, ?)`,
      [id, input.employeeId, input.sessionDate, input.reason, input.supportingNote ?? null]
    );
    return this.getRegularization(id);
  },

  async getRegularization(id: string): Promise<AttendanceRegularization> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM attendance_regularization WHERE id = ? LIMIT 1", [id]
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
    await this.getRegularization(id);
    await db.execute(
      `UPDATE attendance_regularization
          SET status = ?, reviewed_by = ?, reviewed_at = NOW(), reviewer_note = ?
        WHERE id = ?`,
      [input.status, reviewerId, input.reviewerNote ?? null, id]
    );
    return this.getRegularization(id);
  },

  async listRegularizations(filters: RegularizationListFilters): Promise<AttendanceRegularization[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.employeeId) { conds.push("employee_id = ?"); params.push(filters.employeeId); }
    if (filters.status)     { conds.push("status = ?");      params.push(filters.status); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM attendance_regularization ${where} ORDER BY created_at DESC`, params
    );
    return rows as AttendanceRegularization[];
  },
};
