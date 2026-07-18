import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getEffectiveConfig } from "../customization/customization-engine.js";
import type {
  LeaveBalanceLedger,
  LeaveHoliday,
  LeaveRequest,
  LeaveType,
  PaginatedResult,
} from "./leave.types.js";
import type {
  CreateHolidayInput,
  CreateLeaveTypeInput,
  LeaveRequestFilters,
  LeaveRequestInput,
  ReviewLeaveInput,
} from "./leave.validation.js";

export const leaveService = {
  async listLeaveTypes(employeeId?: string): Promise<LeaveType[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM leave_type_master WHERE active_status = 1 ORDER BY leave_name ASC"
    );
    const types = rows as LeaveType[];

    // Apply customizations if employeeId provided
    if (employeeId) {
      for (const type of types) {
        try {
          const result = await getEffectiveConfig(employeeId, 'leave_type', type.id, type as unknown as Record<string, unknown>);
          Object.assign(type, result.config);
        } catch (err) {
          // Skip customization on error
          console.warn(`Customization error for leave type ${type.id}:`, err);
        }
      }
    }

    return types;
  },

  async createLeaveType(input: CreateLeaveTypeInput): Promise<LeaveType> {
    const [dup] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM leave_type_master WHERE leave_code = ? LIMIT 1", [input.leaveCode]
    );
    if ((dup as RowDataPacket[]).length > 0) throw new Error("Leave code already exists");

    const id = randomUUID();
    await db.execute(
      `INSERT INTO leave_type_master (id, leave_code, leave_name, max_days_per_year, carry_forward, requires_approval, paid_leave)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.leaveCode, input.leaveName, input.maxDaysPerYear,
       input.carryForward ? 1 : 0, input.requiresApproval ? 1 : 0, input.paidLeave ? 1 : 0]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM leave_type_master WHERE id = ? LIMIT 1", [id]
    );
    return (rows as LeaveType[])[0];
  },

  async submitRequest(input: LeaveRequestInput): Promise<LeaveRequest> {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO leave_request (id, employee_id, leave_type_id, from_date, to_date, total_days, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.employeeId, input.leaveTypeId, input.fromDate, input.toDate,
       input.totalDays, input.reason ?? null]
    );

    // Notify reporting manager — they are Stage 1 approver
    try {
      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT e.employee_code,
                CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS full_name,
                e.reporting_manager_id,
                e.manager_id
         FROM employees e WHERE e.id = ? LIMIT 1`,
        [input.employeeId]
      );
      const emp = (empRows[0] as any);
      const managerEmpId = emp?.reporting_manager_id ?? emp?.manager_id ?? null;

      if (managerEmpId) {
        const [mgRows] = await db.execute<RowDataPacket[]>(
          `SELECT user_id FROM employees WHERE id = ? AND user_id IS NOT NULL LIMIT 1`,
          [managerEmpId]
        );
        const managerUserId = (mgRows[0] as any)?.user_id ?? null;
        if (managerUserId) {
          const [ltRows] = await db.execute<RowDataPacket[]>(
            `SELECT leave_name FROM leave_type_master WHERE id = ? LIMIT 1`,
            [input.leaveTypeId]
          );
          const leaveType = (ltRows[0] as any)?.leave_name ?? 'Leave';
          const { inboxService } = await import('../inbox/inbox.service.js');
          await inboxService.createItem({
            user_id: managerUserId,
            type: 'leave_request',
            title: `[ACTION REQUIRED] Leave Request: ${emp?.full_name ?? input.employeeId}`,
            description: `${emp?.employee_code ?? ''} applied for ${leaveType} from ${input.fromDate} to ${input.toDate} (${input.totalDays} day${input.totalDays === 1 ? '' : 's'})${input.reason ? `. Reason: ${input.reason}` : '.'}`,
            entity_type: 'leave',
            entity_id: input.employeeId,
            action_url: `/leave/requests`,
            priority: 'high',
          });
        }
      }
    } catch {
      // Non-fatal — notification failure should not block submission
    }

    return this.getRequest(id);
  },

  async getRequest(id: string): Promise<LeaveRequest> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM leave_request WHERE id = ? LIMIT 1", [id]
    );
    const rec = (rows as LeaveRequest[])[0];
    if (!rec) throw new Error("Leave request not found");
    return rec;
  },

  // Returns ISO date strings (YYYY-MM-DD) for every calendar day in [fromDate, toDate] inclusive.
  _dateRange(fromDate: string, toDate: string): string[] {
    const dates: string[] = [];
    const cur = new Date(fromDate + 'T00:00:00Z');
    const end = new Date(toDate + 'T00:00:00Z');
    while (cur <= end) {
      dates.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return dates;
  },

  async reviewRequest(id: string, input: ReviewLeaveInput, reviewerId: string): Promise<LeaveRequest> {
    const request = await this.getRequest(id);

    if (request.status === 'lapsed') {
      throw Object.assign(
        new Error("This leave request was lapsed at payroll cycle close and can no longer be approved or modified."),
        { statusCode: 409 }
      );
    }

    const conn = await (db as any).getConnection();
    try {
      await conn.beginTransaction();

      // Handle approval - deduct leave balance
      if (input.status === 'approved') {
        if (!request.leave_type_id) {
          throw new Error("Leave type is required for approval");
        }

        const duration = request.total_days;
        const employeeId = request.employee_id;
        const leaveTypeId = request.leave_type_id;
        const year = new Date(request.from_date).getFullYear();

        const [typeRows] = await conn.execute(
          `SELECT max_days_per_year FROM leave_type_master WHERE id = ? LIMIT 1`,
          [leaveTypeId]
        );
        const maxDaysPerYear: number = Number((typeRows as RowDataPacket[])[0]?.max_days_per_year ?? 0);

        const [balanceRows] = await conn.execute(
          `SELECT * FROM leave_balance_ledger
           WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
          [employeeId, leaveTypeId, year]
        );

        if ((balanceRows as RowDataPacket[]).length === 0) {
          if (maxDaysPerYear > 0 && duration > maxDaysPerYear) {
            throw new Error(
              `No leave allocation found for this employee. ` +
              `Requested ${duration} day(s) exceeds the annual maximum of ${maxDaysPerYear} for this leave type.`
            );
          }
          await conn.execute(
            `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
             VALUES (UUID(), ?, ?, ?, 0, ?, 0)`,
            [employeeId, leaveTypeId, year, duration]
          );
        } else {
          const balance = (balanceRows as RowDataPacket[])[0];
          const allocatedDays = Number(balance.allocated_days ?? 0);
          const adjustedDays  = Number(balance.adjusted_days ?? 0);
          const usedDays      = Number(balance.used_days ?? 0);
          const availableBalance = allocatedDays + adjustedDays - usedDays;

          if (duration > availableBalance) {
            throw new Error(`Insufficient leave balance. Available: ${availableBalance}, Requested: ${duration}`);
          }
          if (maxDaysPerYear > 0 && (usedDays + duration) > maxDaysPerYear) {
            throw new Error(
              `Approving this request would exceed the annual limit of ${maxDaysPerYear} day(s) ` +
              `for this leave type. Already used: ${usedDays}.`
            );
          }

          await conn.execute(
            `UPDATE leave_balance_ledger
             SET used_days = used_days + ?
             WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
            [duration, employeeId, leaveTypeId, year]
          );
        }

        // Sync attendance records for the approved date range in a single query
        await conn.execute(
          `INSERT INTO attendance_daily_record
               (id, employee_id, record_date, attendance_status, lwp_value, created_by)
           SELECT UUID(), ?, cal_date, 'leave_approved', 0.00, 'leave_service'
           FROM (
             WITH RECURSIVE cal AS (
               SELECT ? AS cal_date
               UNION ALL
               SELECT DATE_ADD(cal_date, INTERVAL 1 DAY) FROM cal WHERE cal_date < ?
             ) SELECT cal_date FROM cal
           ) AS dates
           ON DUPLICATE KEY UPDATE
             attendance_status = IF(is_locked = 0, 'leave_approved', attendance_status),
             lwp_value         = IF(is_locked = 0, 0.00, lwp_value)`,
          [request.employee_id, request.from_date, request.to_date]
        );
      }

      // Restore balance when rejecting or cancelling a previously approved leave
      if ((input.status === 'rejected' || input.status === 'cancelled') && request.status === 'approved') {
        const duration = request.total_days;
        const employeeId = request.employee_id;
        const leaveTypeId = request.leave_type_id;
        const year = new Date(request.from_date).getFullYear();

        await conn.execute(
          `UPDATE leave_balance_ledger
              SET used_days = GREATEST(0, used_days - ?)
            WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
          [duration, employeeId, leaveTypeId, year]
        );

        // Revert attendance records in a single BETWEEN query
        await conn.execute(
          `UPDATE attendance_daily_record
              SET attendance_status = 'absent', lwp_value = 1.00, override_reason = ?
            WHERE employee_id = ?
              AND record_date BETWEEN ? AND ?
              AND attendance_status = 'leave_approved'
              AND is_locked = 0`,
          [`Leave ${input.status} — auto-reverted by leave service`, employeeId, request.from_date, request.to_date]
        );
      }

      await conn.execute(
        "UPDATE leave_request SET status = ? WHERE id = ?",
        [input.status, id]
      );
      await conn.execute(
        `INSERT INTO leave_approval_log (id, leave_request_id, action, action_by, remarks)
         VALUES (UUID(), ?, ?, ?, ?)`,
        [id, input.status, reviewerId, input.remarks ?? null]
      );

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    return this.getRequest(id);
  },

  async listRequests(filters: LeaveRequestFilters): Promise<PaginatedResult<LeaveRequest>> {
    const { page, limit, employeeId, leaveTypeId, status, fromDate, toDate, activeOn } = filters;
    const offset = (page - 1) * limit;
    const conds: string[] = [];
    const params: unknown[] = [];
    if (employeeId)  { conds.push("employee_id = ?");    params.push(employeeId); }
    if (leaveTypeId) { conds.push("leave_type_id = ?");  params.push(leaveTypeId); }
    if (status)      { conds.push("status = ?");         params.push(status); }
    if (fromDate)    { conds.push("from_date >= ?");     params.push(fromDate); }
    if (toDate)      { conds.push("to_date <= ?");       params.push(toDate); }
    if (activeOn)    { conds.push("from_date <= ?");     params.push(activeOn);
                       conds.push("to_date >= ?");       params.push(activeOn); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM leave_request ${where} ORDER BY applied_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM leave_request ${where}`, params
    );
    return { data: rows as LeaveRequest[], total: (countRows as any)[0]?.total ?? 0, page, limit };
  },

  async getBalance(employeeId: string, year: number): Promise<any[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT lbl.*, lt.leave_name, lt.leave_code, lt.paid_leave, lt.carry_forward
       FROM leave_balance_ledger lbl
       JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
       WHERE lbl.employee_id = ? AND lbl.balance_year = ?
       ORDER BY lt.leave_name ASC`,
      [employeeId, year]
    );

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1; // 1-12

    return (rows as RowDataPacket[]).map((row: any) => {
      const allocated = Number(row.allocated_days ?? 0);
      const used = Number(row.used_days ?? 0);
      const adjusted = Number(row.adjusted_days ?? 0);

      // available = allocated + adjustments - used (no automatic proration — HR sets the correct allocation)
      const available_days = Math.max(0, allocated + adjusted - used);
      return { ...row, available_days };
    });
  },

  async listHolidays(year?: number): Promise<LeaveHoliday[]> {
    let sql = "SELECT * FROM leave_holiday_master WHERE active_status = 1";
    const params: unknown[] = [];
    if (year) { sql += " AND YEAR(holiday_date) = ?"; params.push(year); }
    sql += " ORDER BY holiday_date ASC";
    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    return rows as LeaveHoliday[];
  },

  async createHoliday(input: CreateHolidayInput): Promise<LeaveHoliday> {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO leave_holiday_master (id, holiday_name, holiday_date, holiday_type, branch_id)
       VALUES (?, ?, ?, ?, ?)`,
      [id, input.holidayName, input.holidayDate, input.holidayType, input.branchId ?? null]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM leave_holiday_master WHERE id = ? LIMIT 1", [id]
    );
    return (rows as LeaveHoliday[])[0];
  },

  // Called by payroll at cycle lock time. Marks all still-pending leave requests
  // that overlap the given month as 'lapsed'. The LWP deduction already stands in
  // attendance_daily_record (absent rows) — no salary recalculation needed.
  async lapseUnresolvedLeaves(runId: string, runMonth: string, employeeIds: string[]): Promise<{ lapsed: number }> {
    if (!employeeIds.length) return { lapsed: 0 };

    const [year, mon] = runMonth.split('-').map(Number);
    const monthStart = `${runMonth}-01`;
    const lastDay = new Date(year, mon, 0).getDate();
    const monthEnd = `${runMonth}-${String(lastDay).padStart(2, '0')}`;
    const reason = `Payroll cycle ${runMonth} locked — leave not approved before cycle close`;

    // Fetch pending leave requests that overlap this month for the run's employees
    const placeholders = employeeIds.map(() => '?').join(', ');
    const [pendingRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_id, leave_type_id, from_date, to_date, total_days
         FROM leave_request
        WHERE status = 'pending'
          AND from_date <= ?
          AND to_date >= ?
          AND employee_id IN (${placeholders})`,
      [monthEnd, monthStart, ...employeeIds],
    );

    if (!(pendingRows as any[]).length) return { lapsed: 0 };

    const ids = (pendingRows as any[]).map((r: any) => r.id);
    const idPlaceholders = ids.map(() => '?').join(', ');

    await db.execute(
      `UPDATE leave_request
          SET status = 'lapsed',
              lapsed_at = NOW(),
              lapsed_reason = ?,
              lapsed_run_id = ?
        WHERE id IN (${idPlaceholders})`,
      [reason, runId, ...ids],
    );

    // Audit log — one row per lapsed request
    for (const req of pendingRows as any[]) {
      await db.execute(
        `INSERT INTO leave_approval_log (id, leave_request_id, action, action_by, remarks)
         VALUES (UUID(), ?, 'lapsed_by_payroll_close', 'system', ?)`,
        [req.id, reason],
      ).catch((e: unknown) => console.error('[leave-service] lapse audit log error:', e));
    }

    console.log(`[leave-service] Lapsed ${ids.length} pending leave request(s) for payroll run ${runId} (${runMonth})`);
    return { lapsed: ids.length };
  },
};
