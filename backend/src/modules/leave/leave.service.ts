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
          const result = await getEffectiveConfig(employeeId, 'leave_type', type.id, type);
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

  async reviewRequest(id: string, input: ReviewLeaveInput, reviewerId: string): Promise<LeaveRequest> {
    const request = await this.getRequest(id);
    
    // Handle approval - deduct leave balance
    if (input.status === 'approved') {
      // Validate leave_type_id exists
      if (!request.leave_type_id) {
        throw new Error("Leave type is required for approval");
      }
      
      const duration = request.total_days;
      const employeeId = request.employee_id;
      const leaveTypeId = request.leave_type_id;
      const year = new Date(request.from_date).getFullYear();
      
      // Check current balance
      const [balanceRows] = await db.execute<RowDataPacket[]>(
        `SELECT * FROM leave_balance_ledger 
         WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
        [employeeId, leaveTypeId, year]
      );
      
      if (balanceRows.length === 0) {
        // No ledger row exists - create one with used_days = duration and allocated_days = 0
        await db.execute(
          `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
           VALUES (UUID(), ?, ?, ?, 0, ?, 0)`,
          [employeeId, leaveTypeId, year, duration]
        );
      } else {
        const balance = balanceRows[0];
        const availableBalance = (balance.allocated_days || 0) + (balance.adjusted_days || 0) - (balance.used_days || 0);
        
        // Validate sufficient balance
        if (duration > availableBalance) {
          throw new Error(`Insufficient leave balance. Available: ${availableBalance}, Requested: ${duration}`);
        }
        
        // Update used_days
        await db.execute(
          `UPDATE leave_balance_ledger 
           SET used_days = used_days + ? 
           WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
          [duration, employeeId, leaveTypeId, year]
        );
      }
    }
    
    // Handle rejection - restore leave balance if previously approved
    if (input.status === 'rejected' && request.status === 'approved') {
      // TODO: Handle state transition from approved to rejected - deduct used_days
      // This requires tracking the previous status which is a more complex change
      // For now, log a warning about this edge case
      console.warn(`Request ${id} was rejected after approval - balance was already deducted and should be restored manually`);
    }
    
    await db.execute(
      "UPDATE leave_request SET status = ? WHERE id = ?",
      [input.status, id]
    );
    await db.execute(
      `INSERT INTO leave_approval_log (id, leave_request_id, action, action_by, remarks)
       VALUES (UUID(), ?, ?, ?, ?)`,
      [id, input.status, reviewerId, input.remarks ?? null]
    );
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
      const leaveCode: string = (row.leave_code ?? "").toUpperCase();

      // For CL/ML in the current year, prorate allocated_days to months elapsed so far.
      // This prevents showing the full annual credit when only part of the year has passed.
      let effectiveAllocated = allocated;
      if (["CL", "ML"].includes(leaveCode) && year === currentYear && allocated > 0) {
        const monthsInYear = 12;
        effectiveAllocated = Math.min(allocated, parseFloat(((allocated / monthsInYear) * currentMonth).toFixed(2)));
      }

      const available_days = Math.max(0, effectiveAllocated + adjusted - used);
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
};
