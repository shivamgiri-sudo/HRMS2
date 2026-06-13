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
import { leavePolicyService } from "./leave-policy.service.js";

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
    // --- Step 3: Policy validation ---

    // 1. Look up leave_code for the given leaveTypeId
    const [ltRows] = await db.execute<RowDataPacket[]>(
      "SELECT leave_code FROM leave_type_master WHERE id = ? LIMIT 1",
      [input.leaveTypeId]
    );
    const leaveCode: string | undefined = (ltRows as RowDataPacket[])[0]?.leave_code;

    if (!leaveCode) {
      throw new Error(`Leave type not found: ${input.leaveTypeId}`);
    }

    let initialStatus = "pending";

    if (leaveCode === "CL" || leaveCode === "ML") {
      // a. Check for EL in the same month
      const elConflict = await leavePolicyService.checkELInSameMonth(
        input.employeeId,
        input.fromDate,
        input.toDate
      );
      if (elConflict.hasConflict) {
        throw new Error(
          `CL/ML cannot be taken in a month where EL is already applied. Conflict in month: ${elConflict.conflictMonth}`
        );
      }

      // b. Check monthly cap (2 days for CL/ML)
      const capResult = await leavePolicyService.checkMonthlyCapExceeded(
        input.employeeId,
        input.fromDate,
        input.toDate,
        input.totalDays
      );
      if (capResult.exceeded) {
        throw new Error(
          `Monthly leave cap of 2 days reached for ${capResult.monthBreached}. Please apply excess days as Earned Leave.`
        );
      }
    } else if (leaveCode === "EL") {
      // a. EL must be at least 1 day
      if (input.totalDays < 1) {
        throw new Error("EL must be at least 1 day");
      }

      // b. Check for CL/ML in the same month
      const clmlConflict = await leavePolicyService.checkCLMLInSameMonth(
        input.employeeId,
        input.fromDate,
        input.toDate
      );
      if (clmlConflict.hasConflict) {
        throw new Error(
          `CL/ML and EL cannot be taken in the same calendar month. Conflict in month: ${clmlConflict.conflictMonth}`
        );
      }

      // c & d. Determine year and check if branch head approval is required
      const year = new Date(input.fromDate).getFullYear();
      const needsBranchHead = await leavePolicyService.requiresBranchHeadApproval(
        input.employeeId,
        input.totalDays,
        year
      );
      if (needsBranchHead) {
        initialStatus = "pending_branch_head";
      }
    }
    // All other leave types: initialStatus remains 'pending'

    const id = randomUUID();
    await db.execute(
      `INSERT INTO leave_request (id, employee_id, leave_type_id, from_date, to_date, total_days, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.employeeId, input.leaveTypeId, input.fromDate, input.toDate,
       input.totalDays, input.reason ?? null, initialStatus]
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

    // --- Step 4: Branch head approval path ---

    // Helper: deduct leave balance within a connection (for transaction safety)
    const deductLeaveBalance = async (conn: any) => {
      if (!request.leave_type_id) {
        throw new Error("Leave type is required for approval");
      }
      const duration = request.total_days;
      const employeeId = request.employee_id;
      const leaveTypeId = request.leave_type_id;
      const year = new Date(request.from_date).getFullYear();

      const [balanceRows] = await conn.execute(
        `SELECT * FROM leave_balance_ledger
         WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
        [employeeId, leaveTypeId, year]
      );

      if (balanceRows.length === 0) {
        await conn.execute(
          `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
           VALUES (UUID(), ?, ?, ?, 0, ?, 0)`,
          [employeeId, leaveTypeId, year, duration]
        );
      } else {
        const balance = balanceRows[0];
        const availableBalance =
          (balance.allocated_days || 0) + (balance.adjusted_days || 0) - (balance.used_days || 0);
        if (duration > availableBalance) {
          throw new Error(
            `Insufficient leave balance. Available: ${availableBalance}, Requested: ${duration}`
          );
        }
        await conn.execute(
          `UPDATE leave_balance_ledger
           SET used_days = used_days + ?
           WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
          [duration, employeeId, leaveTypeId, year]
        );
      }
    };

    if (input.status === "branch_head_approved") {
      if (request.status !== "pending_branch_head") {
        throw new Error("Only pending_branch_head requests can be branch-head approved");
      }
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        await deductLeaveBalance(conn);
        await conn.execute(
          "UPDATE leave_request SET status = ? WHERE id = ?",
          ["approved", id]
        );
        await conn.execute(
          `INSERT INTO leave_approval_log (id, leave_request_id, action, action_by, remarks)
           VALUES (UUID(), ?, ?, ?, ?)`,
          [id, "branch_head_approved", reviewerId, input.remarks ?? null]
        );
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
      return this.getRequest(id);
    }

    if (input.status === "branch_head_rejected") {
      if (request.status !== "pending_branch_head") {
        throw new Error("Only pending_branch_head requests can be branch-head rejected");
      }
      await db.execute(
        "UPDATE leave_request SET status = ? WHERE id = ?",
        ["rejected", id]
      );
      await db.execute(
        `INSERT INTO leave_approval_log (id, leave_request_id, action, action_by, remarks)
         VALUES (UUID(), ?, ?, ?, ?)`,
        [id, "branch_head_rejected", reviewerId, input.remarks ?? null]
      );
      return this.getRequest(id);
    }

    // Guard: standard 'approved' action cannot be used on pending_branch_head requests
    if (input.status === "approved" && request.status === "pending_branch_head") {
      throw new Error(
        "This leave requires branch head approval before it can be approved"
      );
    }

    // Handle approval - deduct leave balance inside a transaction
    if (input.status === 'approved') {
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        await deductLeaveBalance(conn);
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
    }

    // Restore leave balance when an approved request is rejected — also transactional
    if (input.status === 'rejected' && request.status === 'approved') {
      const duration = request.total_days;
      const employeeId = request.employee_id;
      const leaveTypeId = request.leave_type_id;
      if (leaveTypeId && duration > 0) {
        const year = new Date(request.from_date).getFullYear();
        const conn = await db.getConnection();
        try {
          await conn.beginTransaction();
          await conn.execute(
            `UPDATE leave_balance_ledger
             SET used_days = GREATEST(0, used_days - ?)
             WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
            [duration, employeeId, leaveTypeId, year]
          );
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
