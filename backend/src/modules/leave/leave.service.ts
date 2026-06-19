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
    
    // Handle approval - deduct leave balance, split across calendar years if needed
    if (input.status === 'approved') {
      if (!request.leave_type_id) {
        throw new Error("Leave type is required for approval");
      }

      const employeeId = request.employee_id;
      const leaveTypeId = request.leave_type_id;
      const fromYear = new Date(request.from_date).getFullYear();
      const toYear = new Date(request.to_date).getFullYear();

      // Build per-year deduction map to handle cross-year spans
      const deductionByYear: Record<number, number> = {};
      if (fromYear === toYear) {
        deductionByYear[fromYear] = request.total_days;
      } else {
        // Count days in each calendar year
        const yearEnd = new Date(fromYear, 11, 31);
        const fromDate = new Date(request.from_date);
        const toDate = new Date(request.to_date);
        const daysInFromYear = Math.round((yearEnd.getTime() - fromDate.getTime()) / 86400000) + 1;
        const daysInToYear = request.total_days - daysInFromYear;
        if (daysInFromYear > 0) deductionByYear[fromYear] = daysInFromYear;
        if (daysInToYear > 0) deductionByYear[toYear] = daysInToYear;
      }

      // Total available check across all affected years
      let totalAvailable = 0;
      for (const [yearStr, deduction] of Object.entries(deductionByYear)) {
        const year = Number(yearStr);
        const [balRows] = await db.execute<RowDataPacket[]>(
          `SELECT * FROM leave_balance_ledger WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
          [employeeId, leaveTypeId, year]
        );
        if (balRows.length > 0) {
          const b = balRows[0] as any;
          totalAvailable += (b.allocated_days || 0) + (b.adjusted_days || 0) - (b.used_days || 0);
        }
        void deduction; // used in next loop
      }
      if (totalAvailable < request.total_days) {
        throw new Error(`Insufficient leave balance. Available: ${totalAvailable}, Requested: ${request.total_days}`);
      }

      // Apply deductions per year
      for (const [yearStr, deduction] of Object.entries(deductionByYear)) {
        const year = Number(yearStr);
        const [balRows] = await db.execute<RowDataPacket[]>(
          `SELECT * FROM leave_balance_ledger WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
          [employeeId, leaveTypeId, year]
        );
        if (balRows.length === 0) {
          await db.execute(
            `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
             VALUES (UUID(), ?, ?, ?, 0, ?, 0)`,
            [employeeId, leaveTypeId, year, deduction]
          );
        } else {
          await db.execute(
            `UPDATE leave_balance_ledger SET used_days = used_days + ? WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
            [deduction, employeeId, leaveTypeId, year]
          );
        }
      }
    }

    // Restore leave balance when an approved request is rejected (reverse the deduction)
    if (input.status === 'rejected' && request.status === 'approved') {
      const employeeId = request.employee_id;
      const leaveTypeId = request.leave_type_id;
      if (leaveTypeId && request.total_days > 0) {
        const fromYear = new Date(request.from_date).getFullYear();
        const toYear = new Date(request.to_date).getFullYear();
        const deductionByYear: Record<number, number> = {};
        if (fromYear === toYear) {
          deductionByYear[fromYear] = request.total_days;
        } else {
          const yearEnd = new Date(fromYear, 11, 31);
          const fromDate = new Date(request.from_date);
          const daysInFromYear = Math.round((yearEnd.getTime() - fromDate.getTime()) / 86400000) + 1;
          const daysInToYear = request.total_days - daysInFromYear;
          if (daysInFromYear > 0) deductionByYear[fromYear] = daysInFromYear;
          if (daysInToYear > 0) deductionByYear[toYear] = daysInToYear;
        }
        for (const [yearStr, days] of Object.entries(deductionByYear)) {
          await db.execute(
            `UPDATE leave_balance_ledger SET used_days = GREATEST(0, used_days - ?) WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
            [days, employeeId, leaveTypeId, Number(yearStr)]
          );
        }
      }
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
      `SELECT lbl.*, lt.leave_name, lt.leave_code, lt.paid_leave, lt.carry_forward, lt.max_days_per_year
       FROM leave_balance_ledger lbl
       JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
       WHERE lbl.employee_id = ? AND lbl.balance_year = ?
       ORDER BY lt.leave_name ASC`,
      [employeeId, year]
    );
    return rows as RowDataPacket[];
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
