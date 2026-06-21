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
    const employeeId = input.employeeId;
    const leaveTypeId = input.leaveTypeId;
    const totalDays = input.totalDays;
    const fromDate = new Date(input.fromDate);
    const toDate = new Date(input.toDate);
    const year = fromDate.getFullYear();
    const month = fromDate.getMonth() + 1;

    // Get leave type details
    const [ltRows]: any = await db.execute(
      `SELECT lt.leave_code FROM leave_type_master lt WHERE lt.id = ?`,
      [leaveTypeId]
    );
    const leaveCode = ltRows[0]?.leave_code;

    // ===== VALIDATION RULES =====

    // RULE 1: CL/ML max 2 days per request
    if (['CL', 'ML', 'HDCL', 'HDML'].includes(leaveCode) && totalDays > 2) {
      throw new Error(
        `${leaveCode} allows max 2 continuous days per request. ` +
        `Requests over 2 days must be applied as Earned Leave (EL). ` +
        `Resubmit as EL request.`
      );
    }

    // RULE 2: Backdated cutoff — only allow if from_date <= 5th of current month
    const todayDate = new Date();
    const todayMonth = todayDate.getMonth() + 1;
    const todayYear = todayDate.getFullYear();
    if (year === todayYear && month === todayMonth && fromDate.getDate() < todayDate.getDate()) {
      if (todayDate.getDate() > 5) {
        throw new Error(
          `Backdated requests allowed only up to the 5th of the month. ` +
          `Cannot apply for dates before the 5th retroactively.`
        );
      }
    }

    // RULE 3: Payroll closure cutoff — block if month payroll closed
    const [payrollRows]: any = await db.execute(
      `SELECT status FROM salary_prep_run WHERE run_month = ? AND run_year = ? LIMIT 1`,
      [month, year]
    );
    if (payrollRows.length > 0 && ['closed', 'finalized'].includes(payrollRows[0].status)) {
      throw new Error(
        `Payroll for this month (${month}/${year}) is already closed. ` +
        `Cannot apply leaves retroactively after payroll closure.`
      );
    }

    // RULE 4: Check balance (CL+ML pooled)
    if (['CL', 'ML', 'HDCL', 'HDML'].includes(leaveCode)) {
      // Get primary and pool leave type IDs
      const [allLtRows]: any = await db.execute(
        `SELECT id, leave_code FROM leave_type_master WHERE leave_code IN ('CL', 'ML', 'HDCL', 'HDML') AND active_status = 1`
      );
      const ltMap: Record<string, string> = {};
      for (const lt of allLtRows) ltMap[lt.leave_code] = lt.id;

      // Sum CL+HDCL and ML+HDML balances
      const clHdclIds = [ltMap['CL'], ltMap['HDCL']].filter(Boolean);
      const mlHdmlIds = [ltMap['ML'], ltMap['HDML']].filter(Boolean);

      let clBalance = 0, mlBalance = 0;

      if (clHdclIds.length > 0) {
        const [clRows]: any = await db.execute(
          `SELECT SUM(allocated_days + adjusted_days - used_days) as avail FROM leave_balance_ledger
           WHERE employee_id = ? AND balance_year = ? AND leave_type_id IN (${clHdclIds.map(() => '?').join(',')})`,
          [employeeId, year, ...clHdclIds]
        );
        clBalance = clRows[0]?.avail ?? 0;
      }

      if (mlHdmlIds.length > 0) {
        const [mlRows]: any = await db.execute(
          `SELECT SUM(allocated_days + adjusted_days - used_days) as avail FROM leave_balance_ledger
           WHERE employee_id = ? AND balance_year = ? AND leave_type_id IN (${mlHdmlIds.map(() => '?').join(',')})`,
          [employeeId, year, ...mlHdmlIds]
        );
        mlBalance = mlRows[0]?.avail ?? 0;
      }

      const totalBalance = clBalance + mlBalance;
      if (totalBalance < totalDays) {
        throw new Error(
          `Insufficient leave balance. ` +
          `Need: ${totalDays} days, Available: ${totalBalance} days (CL: ${clBalance}, ML: ${mlBalance}).`
        );
      }

      // Show cross-type warning if needed
      if (leaveCode === 'CL' && clBalance < totalDays && mlBalance > 0) {
        throw new Error(
          `Only ${clBalance} CL available. ` +
          `${totalDays - clBalance} day(s) will be deducted from ML pool. ` +
          `Confirm and resubmit with ?confirm=true`
        );
      }
      if (leaveCode === 'ML' && mlBalance < totalDays && clBalance > 0) {
        throw new Error(
          `Only ${mlBalance} ML available. ` +
          `${totalDays - mlBalance} day(s) will be deducted from CL pool. ` +
          `Confirm and resubmit with ?confirm=true`
        );
      }
    }

    // RULE 5: EL must be continuous (no fragmentation)
    if (leaveCode === 'EL') {
      const fromDay = fromDate.getDate();
      const toDay = toDate.getDate();
      const fromMonth = fromDate.getMonth() + 1;
      const toMonth = toDate.getMonth() + 1;
      if (fromMonth !== toMonth) {
        throw new Error(
          `EL must be applied as a single continuous block within one month. ` +
          `Cannot split across months. Resubmit as continuous days.`
        );
      }
    }

    // RULE 6: EL max 2 occurrences/year, max 12 days/occurrence
    if (leaveCode === 'EL') {
      const [countRows]: any = await db.execute(
        `SELECT COUNT(*) as count FROM leave_request
         WHERE employee_id = ? AND leave_type_id = ? AND YEAR(from_date) = ? AND status != 'rejected'`,
        [employeeId, leaveTypeId, year]
      );
      const elOccurrences = countRows[0]?.count ?? 0;

      let requiresBranchHeadApproval = false;
      let approvalReason = '';

      if (totalDays > 12) {
        requiresBranchHeadApproval = true;
        approvalReason = `Request exceeds 12-day EL limit (${totalDays} days). Requires Branch Head approval.`;
      }

      if (elOccurrences >= 2) {
        requiresBranchHeadApproval = true;
        approvalReason = `You have already applied EL ${elOccurrences} time(s) this year. Max 2 applications. Requires Branch Head approval.`;
      }

      if (requiresBranchHeadApproval) {
        throw new Error(approvalReason);
      }
    }

    // ===== INSERT REQUEST =====
    const id = randomUUID();
    const requiresBranchHeadApproval = leaveCode === 'EL' && (totalDays > 12 ||
      ((await db.execute(
        `SELECT COUNT(*) as count FROM leave_request
         WHERE employee_id = ? AND leave_type_id = ? AND YEAR(from_date) = ? AND status != 'rejected'`,
        [employeeId, leaveTypeId, year]
      ))[0][0]?.count ?? 0) >= 2);

    await db.execute(
      `INSERT INTO leave_request
       (id, employee_id, leave_type_id, from_date, to_date, total_days, reason, requires_branch_head_approval, backdated_applied, payroll_closed_flag)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, employeeId, leaveTypeId, input.fromDate, input.toDate, totalDays, input.reason ?? null,
       requiresBranchHeadApproval ? 1 : 0,
       (year === todayYear && month === todayMonth && fromDate.getDate() < todayDate.getDate()) ? 1 : 0,
       payrollRows.length > 0 ? 1 : 0]
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

      // Get leave code for cross-type pooling
      const [ltRows] = await db.execute<RowDataPacket[]>(
        `SELECT leave_code FROM leave_type_master WHERE id = ?`,
        [leaveTypeId]
      );
      const leaveCode = (ltRows[0] as any)?.leave_code;

      // Apply deductions per year with cross-type pool support for CL/ML
      const crossTypeDeduction: Record<string, number> = {};

      for (const [yearStr, deduction] of Object.entries(deductionByYear)) {
        const year = Number(yearStr);
        const [balRows] = await db.execute<RowDataPacket[]>(
          `SELECT * FROM leave_balance_ledger WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
          [employeeId, leaveTypeId, year]
        );

        let fromPrimary = 0, fromSecondary = 0;

        if (balRows.length === 0) {
          fromPrimary = Math.min(deduction, 0);
          fromSecondary = deduction - fromPrimary;
        } else {
          const b = balRows[0] as any;
          const available = (b.allocated_days || 0) + (b.adjusted_days || 0) - (b.used_days || 0);
          fromPrimary = Math.min(deduction, available);
          fromSecondary = deduction - fromPrimary;
        }

        // Deduct from primary type
        await db.execute(
          `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
           VALUES (UUID(), ?, ?, ?, 0, ?, 0)
           ON DUPLICATE KEY UPDATE used_days = used_days + ?`,
          [employeeId, leaveTypeId, year, fromPrimary, fromPrimary]
        );
        crossTypeDeduction[leaveCode] = (crossTypeDeduction[leaveCode] || 0) + fromPrimary;

        // Deduct from secondary pool if needed (CL/ML cross-pool)
        if (fromSecondary > 0 && ['CL', 'ML', 'HDCL', 'HDML'].includes(leaveCode || '')) {
          const secondaryCode = leaveCode === 'CL' ? 'ML' : leaveCode === 'ML' ? 'CL'
                              : leaveCode === 'HDCL' ? 'HDML' : 'HDCL';
          const [secondaryLtRows] = await db.execute<RowDataPacket[]>(
            `SELECT id FROM leave_type_master WHERE leave_code = ?`,
            [secondaryCode]
          );
          if (secondaryLtRows.length > 0) {
            const secondaryLeaveTypeId = (secondaryLtRows[0] as any).id;
            await db.execute(
              `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
               VALUES (UUID(), ?, ?, ?, 0, ?, 0)
               ON DUPLICATE KEY UPDATE used_days = used_days + ?`,
              [employeeId, secondaryLeaveTypeId, year, fromSecondary, fromSecondary]
            );
            crossTypeDeduction[secondaryCode] = (crossTypeDeduction[secondaryCode] || 0) + fromSecondary;
          }
        }
      }

      // Store cross-type deduction breakdown for audit
      if (Object.keys(crossTypeDeduction).length > 0) {
        await db.execute(
          `UPDATE leave_request SET cross_type_deduction = ? WHERE id = ?`,
          [JSON.stringify(crossTypeDeduction), id]
        );
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

  async listRequests(
    filters: LeaveRequestFilters,
    scopeFilter?: { sql: string; params: unknown[] }
  ): Promise<PaginatedResult<LeaveRequest>> {
    const { page, limit, employeeId, leaveTypeId, status, fromDate, toDate, activeOn } = filters;
    const offset = (page - 1) * limit;
    const conds: string[] = [];
    const params: unknown[] = [];
    if (employeeId)  { conds.push("lr.employee_id = ?");    params.push(employeeId); }
    if (leaveTypeId) { conds.push("lr.leave_type_id = ?");  params.push(leaveTypeId); }
    if (status)      { conds.push("lr.status = ?");         params.push(status); }
    if (fromDate)    { conds.push("lr.from_date >= ?");     params.push(fromDate); }
    if (toDate)      { conds.push("lr.to_date <= ?");       params.push(toDate); }
    if (activeOn)    { conds.push("lr.from_date <= ?");     params.push(activeOn);
                       conds.push("lr.to_date >= ?");       params.push(activeOn); }

    // Branch scope: filter via employee join when scopeFilter is provided
    let joinClause = "";
    if (scopeFilter && scopeFilter.sql !== "1=1") {
      joinClause = "JOIN employees e ON e.id = lr.employee_id";
      conds.push(`(${scopeFilter.sql})`);
      params.push(...scopeFilter.params);
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT lr.* FROM leave_request lr ${joinClause} ${where} ORDER BY lr.applied_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM leave_request lr ${joinClause} ${where}`, params
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
