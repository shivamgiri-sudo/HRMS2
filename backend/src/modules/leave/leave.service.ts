import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getEffectiveConfig } from "../customization/customization-engine.js";
import { sendSMS } from "../communication/sms.helper.js";
import { notifyLeaveSubmitted, notifyLeaveDecision, notifyLeavePendingBranchHead } from "./leave.notifications.js";
import { resolveRoleHolderUserIds } from "../../shared/recipient-resolver.js";
import { leavePolicyService } from "./leave-policy.service.js";
import { captureAttendanceSnapshot, readAttendanceSnapshots } from "../../shared/attendanceSnapshot.js";
import { applyRestore, planLeaveRestore, rederiveDates, type DateRestorePlan } from "../../shared/attendanceRestore.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import {
  classifyLeaveDays, getEmployeeLeaveScope, chargeableDates,
} from "../../shared/leaveChargeableDays.js";
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

/** ADR rows for a set of dates, keyed YYYY-MM-DD, on the caller's transaction. */
async function loadAttendanceRowsForRestore(
  conn: any, employeeId: string, dates: string[]
): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  if (dates.length === 0) return out;
  const placeholders = dates.map(() => "?").join(", ");
  const [rows] = await conn.execute(
    `SELECT * FROM attendance_daily_record
      WHERE employee_id = ? AND record_date IN (${placeholders})`,
    [employeeId, ...dates]
  );
  for (const row of rows as RowDataPacket[]) {
    out.set(String((row as any).record_date).slice(0, 10), row);
  }
  return out;
}

/** Groups ISO date strings (YYYY-MM-DD) by their calendar year. */
function groupDatesByYear(dates: string[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (const d of dates) {
    const year = Number(d.slice(0, 4));
    if (!map.has(year)) map.set(year, []);
    map.get(year)!.push(d);
  }
  return map;
}

// CL and ML pool together per the leave module's own source-of-truth design
// (docs/superpowers/plans/2026-06-17-leave-system-source-of-truth.md:26,
// "Deduction order: CL first, remainder from ML") and leave_policy_config's
// pool_with column (CL -> 'ML,HDCL', ML -> 'CL,HDML' — HDCL/HDML are dangling
// references to a half-day leave type that was never built, so they're
// ignored here; half-day leave is rejected server-side elsewhere in this
// file). EL's pool_with is NULL — explicitly not pooled. Hardcoded rather
// than parsed from pool_with because there are exactly two pooled types in
// this system and parsing would just mean filtering out HDCL/HDML anyway;
// this mirrors how checkMonthlyCapExceeded already hardcodes CL/ML.
// (2026-08-13, leave-module audit — policy sign-off on #7.)
const POOL_PARTNER_CODE: Readonly<Record<string, string>> = { CL: "ML", ML: "CL" };

interface BalanceSnapshot {
  exists: boolean;
  allocatedDays: number;
  adjustedDays: number;
  usedDays: number;
  available: number;
}

async function readBalance(
  conn: any, employeeId: string, leaveTypeId: string, year: number
): Promise<BalanceSnapshot> {
  const [rows] = await conn.execute(
    `SELECT allocated_days, adjusted_days, used_days FROM leave_balance_ledger
      WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
    [employeeId, leaveTypeId, year]
  );
  const row = (rows as RowDataPacket[])[0] as any;
  if (!row) return { exists: false, allocatedDays: 0, adjustedDays: 0, usedDays: 0, available: 0 };
  const allocatedDays = Number(row.allocated_days ?? 0);
  const adjustedDays = Number(row.adjusted_days ?? 0);
  const usedDays = Number(row.used_days ?? 0);
  return { exists: true, allocatedDays, adjustedDays, usedDays, available: Math.max(0, allocatedDays + adjustedDays - usedDays) };
}

async function applyBalanceDeduction(
  conn: any, employeeId: string, leaveTypeId: string, year: number, days: number, balanceExists: boolean
): Promise<void> {
  if (days <= 0) return;
  if (balanceExists) {
    await conn.execute(
      `UPDATE leave_balance_ledger SET used_days = used_days + ?
        WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
      [days, employeeId, leaveTypeId, year]
    );
  } else {
    await conn.execute(
      `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
       VALUES (UUID(), ?, ?, ?, 0, ?, 0)`,
      [employeeId, leaveTypeId, year, days]
    );
  }
}

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

  async submitRequest(input: LeaveRequestInput, actorUserId?: string): Promise<LeaveRequest> {
    const id = randomUUID();

    // Half-day leave is not supported anywhere in this system: no schema field,
    // no UI. leaveRequestSchema's `min(0.5)` technically accepts a fraction, but
    // if one ever reached here it would deduct correctly from the balance while
    // attendance/payroll paid the day in full (no partial-day attendance status
    // exists). Reject non-integer totalDays here as a safety patch until/unless
    // half-day leave is deliberately built end-to-end. (2026-08-13 audit)
    if (!Number.isInteger(input.totalDays)) {
      throw new Error(
        "Half-day leave is not supported. totalDays must be a whole number."
      );
    }

    // ── Resolve leave_code for policy enforcement ─────────────────────────
    const [ltCodeRows] = await db.execute<RowDataPacket[]>(
      `SELECT leave_code FROM leave_type_master WHERE id = ? AND active_status = 1 LIMIT 1`,
      [input.leaveTypeId]
    );
    const leaveCode = (ltCodeRows as Array<{ leave_code: string }>)[0]?.leave_code ?? null;

    // ── Gender eligibility (MTRL = female only; PL/PTRL = male only) ───────
    // Mirrors GET /api/leave/eligibility/:employeeId (leave.routes.ts).
    //
    // CORRECTED (2026-08-13, live-DB verified): 'ML' was renamed from
    // "Maternity Leave" to "Medical Leave" by migration 204 (confirmed
    // applied 2026-06-17 via schema_migrations — NOT by 210, which was never
    // executed despite its comment claiming otherwise) and is meant for ALL
    // employees, per 204/210's own stated intent and the live leave_name.
    // 'MTRL' is the dedicated Maternity Leave type (180 days) that replaced
    // ML's old meaning — that is the one that should be female-restricted.
    // The original fix here (making this a hard server-side check) had
    // inherited the stale ML-as-maternity gate from the display-only
    // eligibility endpoint and would have *actively blocked* male employees
    // from Medical Leave, worse than the previous advisory-only version.
    const GENDER_RESTRICTED_CODES = new Set(["MTRL", "PL", "PTRL"]);
    if (leaveCode && GENDER_RESTRICTED_CODES.has(leaveCode)) {
      const [genderRows] = await db.execute<RowDataPacket[]>(
        `SELECT gender FROM employees WHERE id = ? LIMIT 1`,
        [input.employeeId]
      );
      const gender = String((genderRows as RowDataPacket[])[0]?.gender ?? "").toLowerCase().trim();
      const isFemale = ["female", "f"].includes(gender);
      const isMale = ["male", "m"].includes(gender);
      const isFemaleOnly = leaveCode === "MTRL";
      const isMaleOnly = leaveCode === "PL" || leaveCode === "PTRL";
      if ((isFemaleOnly && !isFemale) || (isMaleOnly && !isMale)) {
        throw new Error(
          `This leave type is not available for your profile. Please contact HR if you believe this is incorrect.`
        );
      }
    }

    // ── Authoritative chargeable-day count (#18) ────────────────────────────
    // "Do not trust a client-calculated leave-day count." The client's
    // totalDays (computed with a hardcoded Sat/Sun assumption, not the
    // employee's actual roster week-off) is no longer used for policy checks
    // or storage — this server-side count, from the same classifyLeaveDays()
    // service reviewRequest's attendance write uses, is authoritative for
    // both. (2026-08-13, leave-module audit — policy sign-off on #18/#19.)
    const submitScope = await getEmployeeLeaveScope(input.employeeId);
    const submitClassification = await classifyLeaveDays(
      input.employeeId, submitScope, input.fromDate, input.toDate
    );
    const chargeableCount = chargeableDates(submitClassification).length;
    if (chargeableCount === 0) {
      throw new Error(
        `Every date in ${input.fromDate} – ${input.toDate} is a Week Off or company holiday for this employee — there are no working days to charge leave against.`
      );
    }

    // ── CL / ML policy enforcement ────────────────────────────────────────
    if (leaveCode === 'CL' || leaveCode === 'ML') {
      // More than 2 continuous days must be applied as EL
      if (chargeableCount > 2) {
        throw new Error(
          `${leaveCode} can only be applied for up to 2 continuous days. For longer leave, please apply for Earned Leave (EL).`
        );
      }

      // Combined CL+ML monthly cap (policy engine: leave → cl_ml_policy → monthly_cap_days, default 2)
      const capCheck = await leavePolicyService.checkMonthlyCapExceeded(
        input.employeeId, input.fromDate, input.toDate, chargeableCount
      );
      if (capCheck.exceeded) {
        throw new Error(
          `Monthly leave limit reached for ${capCheck.monthBreached}. ` +
          `You have already used ${capCheck.usedDays} of ${capCheck.cap} allowed CL/ML days this month.`
        );
      }
    }

    // ── EL policy enforcement ─────────────────────────────────────────────
    let initialStatus = 'pending';
    let elOccurrenceCount: number | null = null;
    if (leaveCode === 'EL') {
      // Single-application cap: max 12 days
      const singleGo = leavePolicyService.checkELSingleGoCap(chargeableCount);
      if (singleGo.exceeded) {
        throw new Error(
          `Earned Leave cannot exceed ${singleGo.cap} days in a single application.`
        );
      }

      // No two EL requests in the same calendar month
      const sameMonth = await leavePolicyService.checkELInSameMonth(
        input.employeeId, input.fromDate, input.toDate
      );
      if (sameMonth.hasConflict) {
        throw new Error(
          `You already have an Earned Leave request in ${sameMonth.conflictMonth}. Only one EL application per calendar month is allowed.`
        );
      }

      // 3rd occurrence in the year → requires Branch Head approval.
      // Counts by which calendar year(s) this request's dates actually fall
      // in, not just from_date's year — a Dec/Jan-spanning EL request is
      // relevant to both years' occurrence counts. (2026-08-13, #14 fix)
      const occurrences = await leavePolicyService.checkELOccurrences(
        input.employeeId, input.fromDate, input.toDate
      );
      if (occurrences.isException) {
        initialStatus = 'pending_branch_head';
        elOccurrenceCount = occurrences.count;
      }
    }

    // Reject if an approved/pending request already covers any of the same dates.
    // Two requests for the same range each pass individual policy checks but would
    // double-deduct the balance on approval without this guard.
    //
    // The check and the insert are wrapped in a MySQL named lock scoped to this
    // employee (advisory lock, held on one dedicated connection) so two
    // near-simultaneous submissions cannot both pass the check before either
    // INSERT commits — the plain SELECT-then-INSERT sequence this replaced had
    // exactly that race window. (2026-08-13 audit)
    const lockName = `leave_submit_${input.employeeId}`;
    const lockConn = await (db as any).getConnection();
    try {
      const [lockRows] = await lockConn.query("SELECT GET_LOCK(?, 10) AS acquired", [lockName]);
      if (Number((lockRows as any)?.[0]?.acquired) !== 1) {
        throw new Error("Another leave submission for this employee is already in progress. Please try again.");
      }
      try {
        const [overlapRows] = await lockConn.execute(
          `SELECT id FROM leave_request
            WHERE employee_id = ?
              AND status IN ('approved', 'pending', 'pending_branch_head')
              AND from_date <= ?
              AND to_date   >= ?
            LIMIT 1`,
          [input.employeeId, input.toDate, input.fromDate]
        );
        if ((overlapRows as RowDataPacket[]).length > 0) {
          throw new Error(
            `A leave request already exists for one or more dates in the range ` +
            `${input.fromDate} – ${input.toDate}. Cancel the existing request before applying again.`
          );
        }

        // total_days stores the authoritative chargeable count (#18), not the
        // client-submitted input.totalDays.
        await lockConn.execute(
          `INSERT INTO leave_request (id, employee_id, leave_type_id, from_date, to_date, total_days, reason, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, input.employeeId, input.leaveTypeId, input.fromDate, input.toDate,
           chargeableCount, input.reason ?? null, initialStatus]
        );
      } finally {
        await lockConn.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => {});
      }
    } finally {
      lockConn.release();
    }

    // Platform-wide audit trail — previously only approve/reject/cancel decisions
    // were logged (to leave_approval_log); the submission itself had no audit
    // event at all, and none of the leave module's actions reached the
    // platform-wide sensitive_action_log other HR modules use. (2026-08-13 audit)
    await logSensitiveAction({
      actor_user_id: actorUserId ?? input.employeeId,
      action_type: "LEAVE_SUBMITTED",
      module_key: "leave",
      entity_type: "leave_request",
      entity_id: id,
      employee_id: input.employeeId,
      new_value_json: {
        status: initialStatus, leave_type_id: input.leaveTypeId, leave_code: leaveCode,
        from_date: input.fromDate, to_date: input.toDate, total_days: chargeableCount,
      },
    }).catch(() => {});

    // Notify the actual authorized approver for this request's status. For an
    // ordinary request that's the reporting manager (Stage 1). For an
    // escalated request (pending_branch_head) the reporting manager is NOT
    // authorized to act on it (see canReviewLeave in leave.secure.routes.ts) —
    // sending them an "[ACTION REQUIRED]" alert they cannot act on is actively
    // misleading, so this notifies the configured exception-approver role
    // instead. Previously every request notified the reporting manager
    // unconditionally regardless of status, so an escalated request generated
    // no alert to anyone who could actually approve it. (2026-08-21 audit)
    try {
      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT e.employee_code,
                CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS full_name,
                e.reporting_manager_id,
                e.manager_id,
                e.branch_id
         FROM employees e WHERE e.id = ? LIMIT 1`,
        [input.employeeId]
      );
      const emp = (empRows[0] as any);
      const [ltRows] = await db.execute<RowDataPacket[]>(
        `SELECT leave_name FROM leave_type_master WHERE id = ? LIMIT 1`,
        [input.leaveTypeId]
      );
      const leaveType = (ltRows[0] as any)?.leave_name ?? 'Leave';
      const { inboxService } = await import('../inbox/inbox.service.js');

      if (initialStatus === 'pending_branch_head') {
        const approverRole = await leavePolicyService.getExceptionApproverRole(input.leaveTypeId);
        const approverUserIds = await resolveRoleHolderUserIds(approverRole, emp?.branch_id ?? null);
        for (const approverUserId of approverUserIds) {
          await inboxService.createItem({
            user_id: approverUserId,
            type: 'leave_request',
            title: `[ACTION REQUIRED] Escalated Leave Request: ${emp?.full_name ?? input.employeeId}`,
            description: `${emp?.employee_code ?? ''} applied for ${leaveType} from ${input.fromDate} to ${input.toDate} (${chargeableCount} day${chargeableCount === 1 ? '' : 's'}) — this is EL occurrence #${(elOccurrenceCount ?? 0)} this year and requires ${approverRole.replace(/_/g, ' ')} approval.${input.reason ? ` Reason: ${input.reason}` : ''}`,
            entity_type: 'leave',
            entity_id: id,
            action_url: `/leave/requests`,
            priority: 'high',
          });
        }
      } else {
        const managerEmpId = emp?.reporting_manager_id ?? emp?.manager_id ?? null;
        if (managerEmpId) {
          const [mgRows] = await db.execute<RowDataPacket[]>(
            `SELECT user_id FROM employees WHERE id = ? AND user_id IS NOT NULL LIMIT 1`,
            [managerEmpId]
          );
          const managerUserId = (mgRows[0] as any)?.user_id ?? null;
          if (managerUserId) {
            await inboxService.createItem({
              user_id: managerUserId,
              type: 'leave_request',
              title: `[ACTION REQUIRED] Leave Request: ${emp?.full_name ?? input.employeeId}`,
              description: `${emp?.employee_code ?? ''} applied for ${leaveType} from ${input.fromDate} to ${input.toDate} (${chargeableCount} day${chargeableCount === 1 ? '' : 's'})${input.reason ? `. Reason: ${input.reason}` : '.'}`,
              // The leave request, not the employee. Keyed on the employee this
              // collapsed every request a person raised onto one alert, so a
              // second application never reached the manager and approving one
              // could not tell the inbox which alert to close.
              entity_type: 'leave',
              entity_id: id,
              action_url: `/leave/requests`,
              priority: 'high',
            });
          }
        }
      }
    } catch {
      // Non-fatal — notification failure should not block submission
    }

    // Email to the approver (fire-and-forget), alongside the inbox item and the SMS
    // below. Ships in shadow until leave_submitted/leave_pending_branch_head is
    // switched live.
    if (initialStatus === 'pending_branch_head') {
      setImmediate(() => { void notifyLeavePendingBranchHead(id, elOccurrenceCount ?? undefined); });
    } else {
      setImmediate(() => { void notifyLeaveSubmitted(id); });
    }

    // SMS — leave request submitted (fire-and-forget)
    try {
      const [empRow] = await db.execute<RowDataPacket[]>(
        `SELECT CONCAT(first_name,' ',COALESCE(last_name,'')) AS name, mobile, personal_phone
         FROM employees WHERE id = ? LIMIT 1`, [input.employeeId]
      );
      const emp = (empRow[0] as any);
      const phone = emp?.mobile ?? emp?.personal_phone ?? null;
      if (phone) {
        sendSMS(phone, 'leave_request_submitted', {
          name: emp.name,
          from_date: input.fromDate,
          to_date: input.toDate,
        }).catch(() => {});
      }
    } catch { /* non-fatal */ }

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

  // Whether this employee still has leave awaiting somebody's decision. Used
  // to decide if a legacy employee-keyed inbox alert can be closed: it stands
  // for "this person has leave to review", so it may only close once nothing
  // of theirs is pending.
  async _hasOpenLeave(employeeId: string): Promise<boolean> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1 FROM leave_request
        WHERE employee_id = ? AND status IN ('pending','pending_branch_head') LIMIT 1`,
      [employeeId]
    );
    return rows.length > 0;
  },

  async reviewRequest(id: string, input: ReviewLeaveInput, reviewerId: string): Promise<LeaveRequest> {
    const request = await this.getRequest(id);

    if (request.status === 'lapsed') {
      throw Object.assign(
        new Error("This leave request was lapsed at payroll cycle close and can no longer be approved or modified."),
        { statusCode: 409 }
      );
    }

    // Days whose attendance the engine must rebuild after commit. Populated only
    // when an approved leave is reverted.
    let revertPlans: DateRestorePlan[] = [];

    const conn = await (db as any).getConnection();
    try {
      await conn.beginTransaction();

      // Lock the row and re-check its status now that we hold the lock. Without
      // this, two concurrent PATCH .../review calls (double-click, a stale UI
      // retry, two managers) that both read 'pending' before either transaction
      // started could both pass every check below and both mutate the balance —
      // a real double-deduction, not just a double-write. A second caller who
      // loses the race gets a clear 409 instead. (2026-08-13 audit)
      const [lockedRows] = await conn.execute(
        `SELECT status FROM leave_request WHERE id = ? FOR UPDATE`,
        [id]
      );
      const lockedStatus = (lockedRows as RowDataPacket[])[0]?.status;
      if (lockedStatus === undefined) {
        throw new Error("Leave request not found");
      }
      if (lockedStatus !== request.status) {
        throw Object.assign(
          new Error(`This leave request was already moved to '${lockedStatus}' by another action. Refresh and try again.`),
          { statusCode: 409 }
        );
      }

      // Handle approval - deduct leave balance.
      // branch_head_approved is the terminal approval status for the two EL
      // exception paths (>12-day EL and 3rd occurrence in year), so it must
      // trigger the same balance deduction and attendance write as 'approved'.
      if (input.status === 'approved' || input.status === 'branch_head_approved') {
        if (!request.leave_type_id) {
          throw new Error("Leave type is required for approval");
        }

        // Nothing checked, at approval time, whether this request's dates
        // overlap an already-approved request for the same employee — only
        // submission time did. Two overlapping requests, however they came to
        // both exist, could previously both be approved independently, each
        // deducting its own balance for the same days. (2026-08-13 audit)
        const [approvalOverlapRows] = await conn.execute(
          `SELECT id FROM leave_request
            WHERE employee_id = ?
              AND id != ?
              AND status IN ('approved', 'branch_head_approved')
              AND from_date <= ?
              AND to_date   >= ?
            LIMIT 1`,
          [request.employee_id, id, request.to_date, request.from_date]
        );
        if ((approvalOverlapRows as RowDataPacket[]).length > 0) {
          throw new Error(
            `Cannot approve — this employee already has an approved leave request overlapping ${request.from_date} – ${request.to_date}.`
          );
        }

        const employeeId = request.employee_id;
        const leaveTypeId = request.leave_type_id;

        const [typeRows] = await conn.execute(
          `SELECT leave_code, paid_leave, max_days_per_year FROM leave_type_master WHERE id = ? LIMIT 1`,
          [leaveTypeId]
        );
        const typeInfo = (typeRows as RowDataPacket[])[0] as any;
        if (!typeInfo) throw new Error("Leave type not found");
        const leaveCode = String(typeInfo.leave_code ?? "");
        const isPaidType = Number(typeInfo.paid_leave) === 1;
        const maxDaysPerYear: number = Number(typeInfo.max_days_per_year ?? 0);

        // Authoritative chargeable-day classification (#18/#19, policy sign-off
        // 2026-08-13): only days that are neither the employee's actual roster
        // Week Off nor a company holiday are charged against the balance or
        // written to attendance as leave. A Week Off/holiday inside the range
        // is left completely untouched here — whether it's PAID is a separate
        // question, governed entirely by payroll's existing Week Off
        // eligibility logic, never by this leave-approval code path.
        const approvalScope = await getEmployeeLeaveScope(employeeId);
        const approvalClassification = await classifyLeaveDays(
          employeeId, approvalScope, String(request.from_date), String(request.to_date)
        );
        const chargeable = chargeableDates(approvalClassification);
        if (chargeable.length === 0) {
          throw new Error(
            "This leave request has no chargeable working days — every date falls on a Week Off or company holiday. Nothing to approve."
          );
        }

        // Year-bucketed balance deduction (#12, policy sign-off 2026-08-13):
        // a request crossing a calendar-year boundary (e.g. 30-Dec to 03-Jan)
        // deducts from EACH year's own leave_balance_ledger row, not the
        // whole duration from from_date's year alone.
        //
        // CL/ML pooling (#7, policy sign-off 2026-08-13): per this module's
        // own source-of-truth design (see POOL_PARTNER_CODE above), a CL (or
        // ML) request draws its own type's balance first; any shortfall is
        // drawn from the pooled partner type's balance for the same year,
        // rather than failing outright the moment the requested type alone
        // is insufficient.
        const partnerCode = POOL_PARTNER_CODE[leaveCode] ?? null;
        let partnerTypeId: string | null = null;
        if (partnerCode) {
          const [partnerTypeRows] = await conn.execute(
            `SELECT id FROM leave_type_master WHERE leave_code = ? AND active_status = 1 LIMIT 1`,
            [partnerCode]
          );
          partnerTypeId = (partnerTypeRows as RowDataPacket[])[0]?.id ?? null;
        }

        const byYear = groupDatesByYear(chargeable);
        const deductionBuckets: Array<{ leaveTypeId: string; year: number; days: number; isPrimary: boolean }> = [];

        for (const [year, datesInYear] of byYear) {
          const daysNeeded = datesInYear.length;

          const primary = await readBalance(conn, employeeId, leaveTypeId, year);
          // No ledger row yet for the DIRECTLY REQUESTED type (e.g. HR hasn't
          // run balance-seeding for this employee/type/year) is treated
          // permissively, same as before this rewrite: the row is created
          // with the requested days as used_days, gated only by
          // maxDaysPerYear below — not as "0 available, insufficient
          // balance". This is an administrative-gap fallback, not a real
          // shortfall, so it does not apply to a POOLED PARTNER type below:
          // pooling should only draw from balance that was actually
          // allocated, never invent credit from an allocation that was
          // never set up for the other type.
          const fromPrimary = primary.exists ? Math.min(daysNeeded, primary.available) : daysNeeded;
          let remainder = daysNeeded - fromPrimary;

          let fromPartner = 0;
          let partner: BalanceSnapshot | null = null;
          if (remainder > 0 && partnerTypeId) {
            partner = await readBalance(conn, employeeId, partnerTypeId, year);
            fromPartner = partner.exists ? Math.min(remainder, partner.available) : 0;
            remainder -= fromPartner;
          }

          if (remainder > 0) {
            const poolNote = partnerTypeId
              ? ` (pooled with ${partnerCode}: ${primary.available} ${leaveCode} + ${partner?.available ?? 0} ${partnerCode})`
              : "";
            throw new Error(
              `Insufficient leave balance for ${year}. Available: ${primary.available + fromPartner}${poolNote}, Requested: ${daysNeeded}.`
            );
          }
          // maxDaysPerYear is enforced on the requested type's own usage —
          // pooling covers a balance shortfall, not the annual cap.
          if (maxDaysPerYear > 0 && (primary.usedDays + fromPrimary) > maxDaysPerYear) {
            throw new Error(
              `Approving this request would exceed the annual limit of ${maxDaysPerYear} day(s) ` +
              `for ${leaveCode} in ${year}. Already used: ${primary.usedDays}.`
            );
          }

          if (fromPrimary > 0) {
            await applyBalanceDeduction(conn, employeeId, leaveTypeId, year, fromPrimary, primary.exists);
            deductionBuckets.push({ leaveTypeId, year, days: fromPrimary, isPrimary: true });
          }
          if (fromPartner > 0 && partnerTypeId) {
            await applyBalanceDeduction(conn, employeeId, partnerTypeId, year, fromPartner, partner!.exists);
            deductionBuckets.push({ leaveTypeId: partnerTypeId, year, days: fromPartner, isPrimary: false });
          }
        }

        // Record exactly what was deducted, per (type, year) bucket — the
        // audit trail for a pooled transaction, and what reject/cancel reads
        // back to reverse precisely instead of re-deriving (see below).
        for (const bucket of deductionBuckets) {
          await conn.execute(
            `INSERT INTO leave_balance_deduction (id, leave_request_id, leave_type_id, balance_year, days_deducted, is_primary_type)
             VALUES (UUID(), ?, ?, ?, ?, ?)`,
            [id, bucket.leaveTypeId, bucket.year, bucket.days, bucket.isPrimary ? 1 : 0]
          );
        }

        // Snapshot only the chargeable days before the upsert below overwrites
        // them — Week Off/holiday days were never touched, so there's nothing
        // to snapshot or later restore for them.
        await captureAttendanceSnapshot(conn, {
          sourceType: "leave",
          sourceId: id,
          employeeId: request.employee_id,
          dates: chargeable,
          capturedBy: reviewerId,
        });

        // Attendance write, chargeable days only (#19). Paid vs unpaid leave
        // type get different treatment (#28/#29): a paid type marks the day
        // 'leave_approved' (lwp_value 0.00) exactly as before; an unpaid type
        // (LWP) marks it 'absent' — the SAME status an unplanned/unauthorized
        // absence gets, so it flows through payroll's existing paid_base
        // calculation identically (that CASE expression only pays 'present',
        // 'late', 'half_day' and 'leave_approved' — 'absent' already
        // contributes zero, no new divisor or formula needed) — with
        // lwp_value 1.00 (existing column, already read into the payslip's
        // reported "LWP days" figure) and status_change_reason = 'Approved
        // LWP' so it stays distinguishable from an ordinary absence for
        // reporting/audit, without inventing a nonexistent 'lwp' ENUM value.
        const attendanceStatus = isPaidType ? "leave_approved" : "absent";
        const lwpValue = isPaidType ? 0 : 1;
        const changeReason = isPaidType ? null : "Approved LWP";
        const valuesSql = chargeable.map(() => "(UUID(), ?, ?, ?, ?, ?, 'leave_service')").join(", ");
        const valuesParams: unknown[] = [];
        for (const d of chargeable) {
          valuesParams.push(request.employee_id, d, attendanceStatus, lwpValue, changeReason);
        }
        await conn.execute(
          `INSERT INTO attendance_daily_record
               (id, employee_id, record_date, attendance_status, lwp_value, status_change_reason, created_by)
           VALUES ${valuesSql}
           ON DUPLICATE KEY UPDATE
             attendance_status    = IF(is_locked = 0, VALUES(attendance_status), attendance_status),
             lwp_value            = IF(is_locked = 0, VALUES(lwp_value), lwp_value),
             status_change_reason = IF(is_locked = 0, VALUES(status_change_reason), status_change_reason)`,
          valuesParams
        );
      }

      // Restore balance when rejecting or cancelling a previously approved leave.
      // branch_head_approved is treated as approved for balance/ADR purposes.
      if ((input.status === 'rejected' || input.status === 'cancelled') &&
          (request.status === 'approved' || request.status === 'branch_head_approved')) {
        const employeeId = request.employee_id;

        // Revert attendance through the shared restore, the same path a discard
        // uses. Recomputed fresh from the current roster/holiday data rather
        // than reusing the approval-time classification — planLeaveRestore
        // itself only reverts a day whose CURRENT status is still
        // 'leave_approved' (mode 'skip_owned' otherwise), so recomputation
        // drift here is self-limiting: it can only ever under-revert a day
        // something else already changed, never touch one it shouldn't.
        const restoreScope = await getEmployeeLeaveScope(employeeId);
        const restoreClassification = await classifyLeaveDays(
          employeeId, restoreScope, String(request.from_date), String(request.to_date)
        );
        const restoreDates = chargeableDates(restoreClassification);
        const adrRows = await loadAttendanceRowsForRestore(conn, employeeId, restoreDates);
        const snapshots = await readAttendanceSnapshots(conn, "leave", id);
        revertPlans = restoreDates.map((d) => planLeaveRestore(d, adrRows.get(d), snapshots.get(d)));

        // Balance restore reads back exactly what approval recorded it
        // deducted (leave_balance_deduction — see the approval branch above),
        // per (leave_type_id, year) bucket, rather than re-deriving it. This
        // is what makes a cross-year (#12) or CL/ML-pooled (#7) approval
        // reversible precisely: the recorded bucket already knows exactly
        // how many days came from which type/year, which a fresh
        // classification pass alone cannot reconstruct.
        //
        // Locked days are excluded from the restore exactly as before — a day
        // applyRestore leaves untouched (mode 'skip_locked', payroll freeze
        // or a later correction) must not also credit its balance back, or
        // an employee gains a free day on top of a period payroll already
        // paid as leave. Locked-day counts are computed per YEAR (from the
        // fresh revertPlans, which reflect real current attendance-row state
        // regardless of any drift) and then applied against the recorded
        // buckets for that year, primary-type first — mirroring the same
        // "primary first, partner second" order approval used, so a partial
        // restore reduces from the same side a partial approval would have
        // drawn from last. (2026-08-13, policy sign-off on #12/#13/#14/#7/#20)
        const lockedDatesInYear = new Map<number, number>();
        for (const plan of revertPlans) {
          if (plan.mode !== "skip_locked") continue;
          const y = Number(plan.date.slice(0, 4));
          lockedDatesInYear.set(y, (lockedDatesInYear.get(y) ?? 0) + 1);
        }
        const totalLockedDays = revertPlans.filter((p) => p.mode === "skip_locked").length;

        const [bucketRows] = await conn.execute(
          `SELECT leave_type_id, balance_year, days_deducted, is_primary_type
             FROM leave_balance_deduction WHERE leave_request_id = ?
             ORDER BY balance_year, is_primary_type DESC`,
          [id]
        );
        const buckets = bucketRows as Array<{ leave_type_id: string; balance_year: number; days_deducted: number; is_primary_type: number }>;

        if (buckets.length === 0) {
          // Pre-fix approval (no leave_balance_deduction rows recorded yet) —
          // fall back to the single-bucket behaviour this replaces, using
          // from_date's year and the full recorded total_days, reduced by
          // the total locked-day count. Only reachable for leave approved
          // before this fix shipped.
          const leaveTypeId = request.leave_type_id;
          const year = new Date(request.from_date).getFullYear();
          const restorable = Math.max(0, Number(request.total_days) - totalLockedDays);
          await conn.execute(
            `UPDATE leave_balance_ledger SET used_days = GREATEST(0, used_days - ?)
              WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
            [restorable, employeeId, leaveTypeId, year]
          );
        } else {
          for (const year of new Set(buckets.map((b) => b.balance_year))) {
            const yearBuckets = buckets.filter((b) => b.balance_year === year);
            let lockedRemaining = lockedDatesInYear.get(year) ?? 0;
            for (const bucket of yearBuckets) {
              const restorable = Math.max(0, Number(bucket.days_deducted) - lockedRemaining);
              lockedRemaining = Math.max(0, lockedRemaining - Number(bucket.days_deducted));
              if (restorable <= 0) continue;
              await conn.execute(
                `UPDATE leave_balance_ledger SET used_days = GREATEST(0, used_days - ?)
                  WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
                [restorable, employeeId, bucket.leave_type_id, year]
              );
            }
          }
        }

        if (totalLockedDays > 0) {
          console.warn(
            `[leave-service] ${input.status} of leave ${id}: ${totalLockedDays} day(s) ` +
            `fall in a payroll-locked attendance period and were not reverted; balance restore reduced accordingly.`
          );
        }

        await applyRestore(
          conn, employeeId, revertPlans, snapshots, reviewerId,
          `Leave ${input.status} — auto-reverted by leave service`
        );
      }

      // A terminal approval must stamp WHO approved and WHEN onto the request itself.
      // This UPDATE previously wrote `status` alone: the actor and timestamp reached
      // leave_approval_log but never leave_request, so approved_by and approved_at were
      // NULL on all 2,642 approved rows (measured live 2026-08-11) and the MIS leave
      // report rendered both columns blank on every line.
      //
      // Only approvals are stamped. `approved_by` means approver — writing a rejecter
      // into it would make that report name the wrong person.
      if (input.status === 'approved' || input.status === 'branch_head_approved') {
        // reviewerId is an auth user id, but leave.executor.ts joins
        // `employees appr ON appr.id = lr.approved_by`, so the column has to hold an
        // EMPLOYEE id or the report shows a raw UUID instead of an employee code.
        // 995 of 1,117 active employees carry user_id, so an approver without one is
        // real; fall back to the user id rather than leaving the audit column blank —
        // that report already COALESCEs to the raw value, and the legacy sync handler
        // writes non-employee strings here too.
        const [approverRows] = await conn.execute(
          `SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`,
          [reviewerId]
        );
        const approvedBy =
          String((approverRows as RowDataPacket[])?.[0]?.id ?? '').trim() || reviewerId;

        // approval_level is NOT NULL DEFAULT 'normal', so it is only written on the
        // branch-head path. Writing 'normal' explicitly would clobber any level set
        // elsewhere for no gain.
        const sets = ['status = ?', 'approved_by = ?', 'approved_at = NOW()'];
        if (input.status === 'branch_head_approved') sets.push(`approval_level = 'branch_head'`);

        // `AND status = ?` + affectedRows check is defense-in-depth alongside the
        // FOR UPDATE lock above (same pattern discardService already uses for its
        // own status transition) — belt and suspenders against a double-approval.
        const [approveResult] = await conn.execute(
          `UPDATE leave_request SET ${sets.join(', ')} WHERE id = ? AND status = ?`,
          [input.status, approvedBy, id, request.status]
        );
        if ((approveResult as any).affectedRows !== 1) {
          throw Object.assign(
            new Error("This leave request was already updated by another action. Refresh and try again."),
            { statusCode: 409 }
          );
        }
      } else {
        const [otherResult] = await conn.execute(
          "UPDATE leave_request SET status = ? WHERE id = ? AND status = ?",
          [input.status, id, request.status]
        );
        if ((otherResult as any).affectedRows !== 1) {
          throw Object.assign(
            new Error("This leave request was already updated by another action. Refresh and try again."),
            { statusCode: 409 }
          );
        }
      }
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

    // Platform-wide audit trail — leave_approval_log already captured action/
    // actor/timestamp/remarks, but nothing in this module reached the platform's
    // sensitive_action_log the way other HR modules do, so there was no
    // before/after balance snapshot for approve/reject/cancel decisions.
    // (2026-08-13 audit)
    await logSensitiveAction({
      actor_user_id: reviewerId,
      action_type: `LEAVE_${input.status.toUpperCase()}`,
      module_key: "leave",
      entity_type: "leave_request",
      entity_id: id,
      employee_id: request.employee_id,
      reason: input.remarks ?? undefined,
      old_value_json: { status: request.status },
      new_value_json: { status: input.status, total_days: request.total_days },
    }).catch(() => {});

    // Rebuild any day the revert neutralised. Must run after commit AND after the
    // status left 'approved', or attendance-engine would resolve these days back
    // to leave_approved and undo the revert.
    if (revertPlans.length > 0) {
      try {
        await rederiveDates(request.employee_id, revertPlans);
      } catch { /* non-fatal: the nightly engine sweep will pick these up */ }
    }

    // The decision is made, so the approver's alert has served its purpose.
    // Closed on both keys because alerts raised before the entity_id fix above
    // carry the employee id rather than the request id, and those approvers
    // are still being reminded about leave they have already dealt with.
    const { inboxService } = await import('../inbox/inbox.service.js');
    await inboxService.resolveItems({
      entity_type: 'leave',
      entity_id: id,
      types: ['leave_request'],
    });
    if (!(await this._hasOpenLeave(request.employee_id))) {
      await inboxService.resolveItems({
        entity_type: 'leave',
        entity_id: request.employee_id,
        types: ['leave_request'],
      });
    }

    // Email notification (fire-and-forget), alongside the SMS below rather than
    // instead of it. Ships in shadow.
    if (['approved', 'branch_head_approved', 'rejected', 'cancelled'].includes(input.status)) {
      const notifyStatus = input.status === 'branch_head_approved' ? 'approved' : input.status as 'approved' | 'rejected' | 'cancelled';
      setImmediate(() => {
        void notifyLeaveDecision(id, notifyStatus, input.remarks);
      });
    }

    // SMS — leave approved or rejected (fire-and-forget)
    try {
      const updated = await this.getRequest(id);
      const [empRow] = await db.execute<RowDataPacket[]>(
        `SELECT CONCAT(first_name,' ',COALESCE(last_name,'')) AS name, mobile, personal_phone
         FROM employees WHERE id = ? LIMIT 1`, [updated.employee_id]
      );
      const emp = (empRow[0] as any);
      const phone = emp?.mobile ?? emp?.personal_phone ?? null;
      const isApproved = input.status === 'approved' || input.status === 'branch_head_approved';
      if (phone && isApproved) {
        sendSMS(phone, 'leave_approved', { name: emp.name, from_date: updated.from_date, to_date: updated.to_date }).catch(() => {});
      } else if (phone && input.status === 'rejected') {
        // Not sent, deliberately: this used to call sendSMS(phone, 'request_rejected', ...), but
        // 'request_rejected' is not a registered SmartPing DLT template key — buildSMS() threw
        // "Unknown SmartPing DLT template key" on every call, caught silently, so every leave
        // rejection SMS has failed since this was written while approvals worked fine. The
        // registry's only approval/rejection-shaped template is request_approved, whose approved
        // text is hardcoded ("your {request_type} request has been approved by {approver_name}")
        // — reusing it here would tell the employee their leave was approved when it was
        // rejected, which is worse than sending nothing. No registered template exists for a
        // rejection, so this is skipped rather than guessed. NOTE: notifyLeaveDecision above
        // does NOT cover this gap either — it goes through notificationGateway.notify(), which
        // is fully dormant today (every event row in notification_event_config is seeded
        // enabled=0/dispatch_mode='shadow', confirmed 2026-08-18) — so a rejected employee
        // currently gets no automated notification via any channel, only what's visible in the
        // HRMS UI itself.
        console.warn(`[leave] rejection SMS not attempted for request ${id} — no registered DLT template for a rejection`);
      }

      // In-app decision notice for the employee themselves. Previously the only
      // recipient of any leave-decision notice was the approver's inbox item
      // (and that's just resolved on decision, not a message to the employee) —
      // combined with SMS being skipped for rejections (above) and email being
      // platform-wide dormant, a rejected employee had literally zero
      // notification of the outcome through any channel, only what they'd see
      // by manually reopening the leave page. portal_notification is a plain
      // read/unread FYI row (unlike work_inbox_item, which stays "pending
      // action" until someone resolves it — wrong shape for a decision notice
      // nobody needs to act on). (2026-08-21 audit)
      const [userRow] = await db.execute<RowDataPacket[]>(
        `SELECT user_id FROM employees WHERE id = ? AND user_id IS NOT NULL LIMIT 1`,
        [updated.employee_id]
      );
      const employeeUserId = (userRow[0] as any)?.user_id ?? null;
      if (employeeUserId) {
        const decisionLabel =
          input.status === 'approved' || input.status === 'branch_head_approved' ? 'approved' :
          input.status === 'rejected' || input.status === 'branch_head_rejected' ? 'rejected' :
          input.status === 'cancelled' ? 'cancelled' : null;
        if (decisionLabel) {
          await db.execute(
            `INSERT INTO portal_notification (
               id, user_id, user_type, title, message, notification_type,
               reference_id, priority, read_status
             ) VALUES (UUID(), ?, 'employee', ?, ?, 'leave_decision', ?, ?, 0)`,
            [
              employeeUserId,
              decisionLabel === 'approved' ? 'Leave Request Approved' : decisionLabel === 'rejected' ? 'Leave Request Rejected' : 'Leave Request Cancelled',
              `Your leave request for ${updated.from_date} to ${updated.to_date} was ${decisionLabel}${input.remarks ? `. Remarks: ${input.remarks}` : '.'}`,
              id,
              decisionLabel === 'rejected' ? 'high' : 'medium',
            ]
          ).catch(() => {});
        }
      }
    } catch { /* non-fatal */ }

    return this.getRequest(id);
  },

  async listRequests(filters: LeaveRequestFilters): Promise<PaginatedResult<LeaveRequest>> {
    const { page, limit, employeeId, leaveTypeId, status, fromDate, toDate, activeOn } = filters;
    const offset = (page - 1) * limit;
    const conds: string[] = [];
    const params: unknown[] = [];
    // Every condition is qualified with lr., because the join below brings in a table that
    // also carries created_at — leaving them bare would make those references ambiguous.
    if (employeeId)  { conds.push("lr.employee_id = ?");    params.push(employeeId); }
    if (leaveTypeId) { conds.push("lr.leave_type_id = ?");  params.push(leaveTypeId); }
    if (status)      { conds.push("lr.status = ?");         params.push(status); }
    if (fromDate)    { conds.push("lr.from_date >= ?");     params.push(fromDate); }
    if (toDate)      { conds.push("lr.to_date <= ?");       params.push(toDate); }
    if (activeOn)    { conds.push("lr.from_date <= ?");     params.push(activeOn);
                       conds.push("lr.to_date >= ?");       params.push(activeOn); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    // leave_request stores only leave_type_id and leave_type_code, so a caller rendering a
    // request had no name to show. The dashboard activity feed fell back to the word "Leave"
    // for every entry, which reads as though the type were unknown. The join adds the name
    // without removing anything: lr.* keeps every field existing callers already read.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT lr.*, lt.leave_name AS leave_type, lt.leave_code
         FROM leave_request lr
         LEFT JOIN leave_type_master lt ON lt.id = lr.leave_type_id
        ${where}
        ORDER BY lr.applied_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM leave_request lr ${where}`, params
    );
    return { data: rows as LeaveRequest[], total: (countRows as any)[0]?.total ?? 0, page, limit };
  },

  async getBalance(employeeId: string, year: number): Promise<any[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT lt.id AS leave_type_id, lt.leave_name, lt.leave_code, lt.paid_leave, lt.carry_forward,
              COALESCE(lbl.id, NULL)                AS id,
              COALESCE(lbl.balance_year, ?)         AS balance_year,
              COALESCE(lbl.allocated_days, 0)       AS allocated_days,
              COALESCE(lbl.used_days, 0)            AS used_days,
              COALESCE(lbl.adjusted_days, 0)        AS adjusted_days,
              lbl.employee_id
         FROM leave_type_master lt
         LEFT JOIN leave_balance_ledger lbl
           ON lbl.leave_type_id = lt.id
          AND lbl.employee_id   = ?
          AND lbl.balance_year  = ?
        WHERE lt.active_status = 1
        ORDER BY lt.leave_name ASC`,
      [year, employeeId, year]
    );

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1; // 1-12

    // Collapse duplicate leave types before returning.
    //
    // 052_legacy_migration_tables.sql seeds legacy twins of types that already
    // exist from 006_leave.sql — 'PTRL' Paternity Leave (Legacy) alongside 'PL'
    // Paternity Leave, and 'MTRL' alongside 'ML'. The dedupe in
    // 184_master_data_integrity.sql matches on the EXACT leave_name, so
    // "Paternity Leave" != "Paternity Leave (Legacy)" and both survive. Because
    // this query returns every active type, the leave balance UI rendered one
    // card per twin — the duplicate rows users were seeing.
    //
    // Merge on a canonical name (legacy suffix stripped), summing the ledger
    // figures so no entitlement is lost, and keep the canonical (non-legacy) row
    // as the display identity. Nothing is deleted — this is display-level only.
    const canonicalKey = (name: string) =>
      String(name ?? "")
        .toLowerCase()
        .replace(/\s*\(legacy\)\s*$/, "")
        .trim();
    const LEGACY_CODES = new Set(["PTRL", "MTRL"]);

    const merged = new Map<string, any>();
    for (const row of rows as any[]) {
      const key = canonicalKey(row.leave_name);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...row });
        continue;
      }
      // Prefer the canonical (non-legacy) row for identity/display.
      const rowIsLegacy = LEGACY_CODES.has(String(row.leave_code ?? "").toUpperCase())
        || /\(legacy\)\s*$/i.test(String(row.leave_name ?? ""));
      const base = rowIsLegacy ? existing : row;
      merged.set(key, {
        ...base,
        allocated_days: Number(existing.allocated_days ?? 0) + Number(row.allocated_days ?? 0),
        used_days:      Number(existing.used_days ?? 0)      + Number(row.used_days ?? 0),
        adjusted_days:  Number(existing.adjusted_days ?? 0)  + Number(row.adjusted_days ?? 0),
      });
    }

    return Array.from(merged.values()).map((row: any) => {
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

    // Fetch pending leave requests still unresolved as THIS month closes, for
    // the run's employees.
    //
    // pending_branch_head requests are also unresolved at payroll close: they
    // reached the branch-head stage but were never actioned, so they must be
    // lapsed alongside ordinary pending requests.
    //
    // CORRECTED (#13, policy sign-off 2026-08-13): the original condition
    // only checked overlap with this month (from_date <= monthEnd AND
    // to_date >= monthStart), which lapsed a cross-month request (e.g. 30-Aug
    // to 03-Sep) IN FULL the moment August closed — including the September
    // portion, whose own payroll month hadn't closed yet and so hadn't had
    // its own chance to be decided. "Do not consume/process the entire
    // request in the first month." The added `to_date <= monthEnd` clause
    // means a request only lapses once the closing month is its OWN LAST
    // month — a request extending beyond the month being closed survives to
    // be decided (or lapsed in turn) at its own later month's close instead.
    const placeholders = employeeIds.map(() => '?').join(', ');
    const [pendingRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_id, leave_type_id, from_date, to_date, total_days
         FROM leave_request
        WHERE status IN ('pending', 'pending_branch_head')
          AND from_date <= ?
          AND to_date >= ?
          AND to_date <= ?
          AND employee_id IN (${placeholders})`,
      [monthEnd, monthStart, monthEnd, ...employeeIds],
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
