import { randomUUID } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { hasScopedAccess } from "../../shared/scopeAccess.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import {
  enumerateDates,
  readAttendanceSnapshots,
  type SnapshotSourceType,
} from "../../shared/attendanceSnapshot.js";
import {
  applyRestore,
  planLeaveRestore,
  planRegularizationRestore,
  rederiveDates,
  summariseModes,
  UNRECOVERABLE_WITHOUT_SNAPSHOT,
  type DateRestorePlan,
  type RestoreMode,
} from "../../shared/attendanceRestore.js";

// Re-exported so callers (and tests) have one import site for the discard API.
export {
  planLeaveRestore,
  planRegularizationRestore,
  type DateRestorePlan,
  type RestoreMode,
};

/**
 * Discard of an APPROVED leave, attendance regularization or attendance dispute.
 *
 * Approval is otherwise a one-way door: `leave.service.reviewRequest` deducts
 * `leave_balance_ledger.used_days` and `wfm.service.reviewRegularization`
 * overwrites `attendance_daily_record`. This module is the only supported way
 * back, and it is deliberately the only place that writes the status
 * `'discarded'`.
 *
 * Two rules shape everything here:
 *
 *  1. The entity status must leave `'approved'` BEFORE any attendance write.
 *     `attendance-engine.service.ts` re-derives `leave_approved` from
 *     `leave_request.status = 'approved'`, and
 *     `payroll-attendance-control.service.ts` flags an approved regularization
 *     whose attendance row no longer matches. Reverting attendance while the
 *     status still says approved would be undone by one and alarmed by the other.
 *
 *  2. Attendance is put back from the migration-1023 snapshot where one exists.
 *     For approvals predating that snapshot the fallback ladder in
 *     `planRegularizationRestore` / `planLeaveRestore` is explicit about what it
 *     can and cannot recover, and says so in the response rather than pretending.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DiscardActor {
  userId: string;
  roles: string[];
  role: string | null;
}

export interface DiscardBlocker {
  code:
    | "NOT_APPROVED"
    | "LEAVE_LAPSED"
    | "NO_LEAVE_TYPE"
    | "PAYROLL_MONTH_CLOSED"
    | "OUT_OF_SCOPE"
    | "LOCKED_BY_BULK_UPLOAD"
    | "NOT_FOUND";
  message: string;
}

export interface DiscardPreview {
  entityType: "leave" | "regularization" | "dispute";
  entityId: string;
  employeeId: string;
  employeeName: string | null;
  employeeCode: string | null;
  currentStatus: string;
  targetStatus: "discarded";
  blockers: DiscardBlocker[];
  warnings: string[];
  leave: null | {
    leaveTypeId: string;
    leaveTypeName: string | null;
    balanceYear: number;
    daysToRestore: number;
    balanceBefore: number | null;
    balanceAfter: number | null;
    ledgerRowExists: boolean;
  };
  attendance: DateRestorePlan[];
  payroll: Array<{ month: string; runStatus: string | null; isClosed: boolean }>;
  unrecoverableFields: string[];
}

export interface DiscardResult {
  discardId: string;
  entityType: "leave" | "regularization" | "dispute";
  entityId: string;
  employeeId: string;
  restoreMode: string;
  daysRestored: number | null;
  balanceBefore: number | null;
  balanceAfter: number | null;
  datesRestored: number;
  datesDeleted: number;
  datesSkipped: number;
  attendance: DateRestorePlan[];
  warnings: string[];
  payrollRecalcStatus: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Payroll-run statuses that close a month to attendance/leave changes.
 *
 * Deliberately NOT `CLOSED_RUN_STATUSES` from payroll-targeted-recalculation.
 * That set is {locked, disbursed}, and a live census of `salary_prep_run`
 * (2026-07-31) found neither value in any of the 67 runs — the real statuses are
 * FINALIZED (51), approved (12), processing (3), draft (1). Importing it would
 * have produced a guard that never fires.
 *
 * This list matches `isPayrollMonthLocked` in
 * attendance.manual-override.routes.ts, which is the established answer in this
 * codebase to "may I change attendance for this month". `status` collates
 * utf8mb4_unicode_ci, so lowercase 'finalized' matches the stored 'FINALIZED'
 * (verified: 51 rows).
 *
 * `approved` is included here even though the manual-override guard omits it,
 * because recalculation is not status-neutral: calculatePayrollRunScoped ends with
 * an unconditional `UPDATE salary_prep_run SET status = 'processing'`
 * (payrollCalculate.service.ts:1107). Recalculating an approved run would
 * therefore silently revert its sign-off. 80 approved leaves sit in such months;
 * they need a payroll adjustment rather than a discard.
 */
export const PAYROLL_CLOSED_STATUSES = ["published", "disbursed", "locked", "finalized", "approved"];

function httpError(message: string, statusCode: number, code?: string): Error {
  return Object.assign(new Error(message), { statusCode, code });
}

/** Distinct YYYY-MM months a date range touches. */
function monthsInRange(from: string, to: string): string[] {
  const seen = new Set<string>();
  for (const date of enumerateDates(from, to)) seen.add(date.slice(0, 7));
  return [...seen];
}

// ─── Shared preconditions ────────────────────────────────────────────────────

/**
 * Branch scope. `super_admin` is unscoped (hasScopedAccess short-circuits on it);
 * `wfm` must hold an assignment scope covering the employee. An employee with no
 * branch fails closed for wfm rather than being treated as in-scope.
 */
async function checkScope(actor: DiscardActor, employeeId: string): Promise<DiscardBlocker | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id, process_id, lob_id, department_id, reporting_manager_id, manager_id
       FROM employees WHERE id = ? LIMIT 1`,
    [employeeId]
  );
  const emp = rows[0] as any;
  const allowed = await hasScopedAccess(
    actor.userId,
    ["wfm"],
    {
      branchId: emp?.branch_id ?? null,
      processId: emp?.process_id ?? null,
      lobId: emp?.lob_id ?? null,
      departmentId: emp?.department_id ?? null,
      managerEmployeeId: emp?.reporting_manager_id ?? emp?.manager_id ?? null,
      employeeId,
    },
    { allowAdminBypass: false, requireScopeForNonAdmin: true }
  );
  return allowed
    ? null
    : { code: "OUT_OF_SCOPE", message: "This employee is outside your assigned branch scope." };
}

/** Payroll status for each month, and whether it blocks the discard. */
async function checkPayrollMonths(
  months: string[]
): Promise<{ payroll: DiscardPreview["payroll"]; blocker: DiscardBlocker | null }> {
  if (months.length === 0) return { payroll: [], blocker: null };
  const placeholders = months.map(() => "?").join(", ");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT run_month, status FROM salary_prep_run WHERE run_month IN (${placeholders})`,
    months
  );

  const closedSet = new Set(PAYROLL_CLOSED_STATUSES);
  const byMonth = new Map<string, { statuses: string[]; closed: boolean }>();
  for (const month of months) byMonth.set(month, { statuses: [], closed: false });
  for (const row of rows as RowDataPacket[]) {
    const month = String((row as any).run_month);
    const status = String((row as any).status ?? "");
    const entry = byMonth.get(month);
    if (!entry) continue;
    entry.statuses.push(status);
    // A month can carry more than one run (2026-03 has both approved and
    // FINALIZED); any closed run closes the month.
    if (closedSet.has(status.toLowerCase())) entry.closed = true;
  }

  const payroll = months.map((month) => {
    const entry = byMonth.get(month)!;
    return {
      month,
      runStatus: entry.statuses.length ? entry.statuses.join(", ") : null,
      isClosed: entry.closed,
    };
  });

  const closedMonths = payroll.filter((p) => p.isClosed);
  const blocker: DiscardBlocker | null = closedMonths.length
    ? {
        code: "PAYROLL_MONTH_CLOSED",
        message:
          `Payroll is closed for ${closedMonths.map((m) => `${m.month} (${m.runStatus})`).join(", ")}. ` +
          `A closed month cannot be changed by a discard — raise a payroll adjustment instead. ` +
          `(An approved run counts as closed: recalculating it would revert its sign-off.)`,
      }
    : null;

  return { payroll, blocker };
}

// ─── Restore planning ────────────────────────────────────────────────────────

// ─── Attendance writes ───────────────────────────────────────────────────────

/** Queue or run the payroll recalculation for each affected month, after commit. */
async function recalcPayroll(
  employeeId: string,
  months: string[],
  sourceEventType: string,
  sourceEventId: string,
  actorUserId: string
): Promise<{ status: string | null; outcomes: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  const statuses: string[] = [];
  const outcomes: string[] = [];
  for (const month of months) {
    try {
      const { recalculateOpenPayrollForEmployee } = await import(
        "../payroll/payroll-targeted-recalculation.service.js"
      );
      const res = await recalculateOpenPayrollForEmployee({
        employeeId,
        payrollMonth: month,
        sourceEventType,
        sourceEventId,
        reason: `Discarded ${sourceEventType} ${sourceEventId}`,
        actorUserId,
      });
      statuses.push(`${month}:${res.status}`);
      outcomes.push(String(res.status));

      // Nothing drains payroll_recalculation_queue — no worker, cron or job reads
      // it, so a queued row stays 'pending' forever. Since a discard already
      // refuses closed months, anything other than 'recalculated' means payroll
      // did NOT move, and saying so is the difference between a visible problem
      // and a silently wrong salary.
      if (res.status !== "recalculated") {
        warnings.push(
          `Payroll was NOT recalculated for ${month} (${res.status}): ${res.message} ` +
          `Nothing processes the recalculation queue automatically — this needs a manual payroll run.`
        );
      }
    } catch (err: any) {
      outcomes.push("failed");
      warnings.push(`Payroll recalculation failed for ${month}: ${err?.message ?? String(err)}`);
    }
  }
  return { status: statuses.length ? statuses.join(", ") : null, outcomes, warnings };
}

/**
 * Collapse the per-month outcomes into something that fits payroll_recalc_status.
 *
 * The column is VARCHAR(30). The detailed form recalcPayroll returns for the API
 * response is `2026-07:recalculated, 2026-08:queued` — already 38 characters for
 * the two-month case a leave crossing a month boundary produces, so storing that
 * verbatim would silently truncate mid-status and read as a different outcome.
 * The aggregate keeps what someone acting on this needs: did payroll move, and if
 * not everywhere, what did it do instead.
 */
function aggregateRecalcStatus(outcomes: string[]): string | null {
  if (!outcomes.length) return null;
  const distinct = [...new Set(outcomes)];
  if (distinct.length === 1) return distinct[0].slice(0, 30);
  // Mixed. Name only the months that did NOT move — those are the actionable ones.
  const stalled = distinct.filter((s) => s !== "recalculated");
  return `partial:${stalled.join("/")}`.slice(0, 30);
}

/**
 * Write the payroll outcome onto the ledger row, after the fact.
 *
 * recalcPayroll runs after commit — whether the run recalculated, queued, or found
 * no open run is simply not known while the transaction is open, so this cannot be
 * part of the INSERT. Without it the column stays NULL forever and the Discard
 * Center, which reads history straight off this table, shows the recalc outcome as
 * blank; the information would exist only in the API response of the single request
 * that performed the discard, and vanish when the dialog closed.
 *
 * Isolated like every other post-commit effect: the discard is already durable and
 * a failed annotation must not be reported as a failed discard.
 */
async function recordRecalcStatus(discardId: string, outcomes: string[]): Promise<string[]> {
  const status = aggregateRecalcStatus(outcomes);
  if (!status) return [];
  try {
    await db.execute(
      `UPDATE approval_discard_log SET payroll_recalc_status = ? WHERE id = ?`,
      [status, discardId]
    );
    return [];
  } catch (err: any) {
    return [
      `Payroll recalculation outcome '${status}' could not be recorded on the discard ` +
      `ledger: ${err?.message ?? String(err)}. The discard itself is complete.`,
    ];
  }
}

/**
 * Post-commit cache and snapshot refresh.
 *
 * The attendance and payroll numbers are already correct in the database by this
 * point; these are the stores that would otherwise keep serving the pre-discard
 * values. Each is isolated — the discard is durable and must not be undone by a
 * cache or snapshot failure.
 */
async function refreshDerivedStores(
  employeeId: string,
  months: string[]
): Promise<string[]> {
  const warnings: string[] = [];

  // /api/employees/hr-hub holds a 30s in-process cache with no invalidation hook,
  // so the Attendance Hub would keep showing pre-discard present_days / lwp_days
  // even on a forced refetch.
  try {
    const { invalidateHrHubCache } = await import("../employees/employee.routes.js");
    invalidateHrHubCache();
  } catch (err: any) {
    warnings.push(`Attendance Hub cache could not be cleared: ${err?.message ?? String(err)}`);
  }

  // pnl_running_salary_snapshot feeds the P&L Agent/DSC/BMC people-cost lines and
  // is otherwise only written by a manual refresh endpoint. Scoped to this one
  // employee (~1.4s); a whole-branch refresh would take minutes.
  for (const month of months) {
    try {
      const { refreshRunningSalarySnapshot } = await import(
        "../process-pnl/pnl-running-salary.service.js"
      );
      await refreshRunningSalarySnapshot(month, { employeeId });
    } catch (err: any) {
      warnings.push(
        `P&L running-salary snapshot not refreshed for ${month}: ${err?.message ?? String(err)}. ` +
        `People-cost figures will show the pre-discard amount until the next manual refresh.`
      );
    }
  }

  // attendance_reconciliation_issue is only opened/closed by a full audit on a
  // daily cron. Not triggered here — it is a lookback sweep across all employees.
  warnings.push(
    "Attendance reconciliation issues are recalculated by a daily job, so the " +
    "control tower may lag this change by up to a day."
  );

  return warnings;
}

// ─── Entity loading ──────────────────────────────────────────────────────────

async function loadLeave(id: string, conn?: PoolConnection, forUpdate = false) {
  const runner = conn ?? db;
  const [rows] = await (runner as any).execute(
    `SELECT lr.*, lt.leave_name, e.employee_code,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name
       FROM leave_request lr
       LEFT JOIN leave_type_master lt ON lt.id = lr.leave_type_id
       LEFT JOIN employees e ON e.id = lr.employee_id
      WHERE lr.id = ? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [id]
  );
  return (rows as RowDataPacket[])[0] as any;
}

async function loadRegularization(id: string, conn?: PoolConnection, forUpdate = false) {
  const runner = conn ?? db;
  const [rows] = await (runner as any).execute(
    `SELECT ar.*, e.employee_code,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name
       FROM attendance_regularization ar
       LEFT JOIN employees e ON e.id = ar.employee_id
      WHERE ar.id = ? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [id]
  );
  return (rows as RowDataPacket[])[0] as any;
}

async function loadAttendanceRows(
  runner: PoolConnection | typeof db,
  employeeId: string,
  dates: string[],
  forUpdate = false
): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  if (dates.length === 0) return out;
  const placeholders = dates.map(() => "?").join(", ");
  const [rows] = await (runner as any).execute(
    `SELECT * FROM attendance_daily_record
      WHERE employee_id = ? AND record_date IN (${placeholders})${forUpdate ? " FOR UPDATE" : ""}`,
    [employeeId, ...dates]
  );
  for (const row of rows as RowDataPacket[]) {
    out.set(String((row as any).record_date).slice(0, 10), row);
  }
  return out;
}

/**
 * Refuse to discard a row that an approved bulk upload locked.
 *
 * A bulk batch is approved once, by a branch head, for hundreds of employees at a
 * time; `lockEntity` records every row it applied in `bulk_upload_locked_entity` so
 * that decision cannot then be unpicked one row at a time through the discard screen,
 * leaving the batch's own summary claiming rows that no longer exist.
 *
 * That table has been written since the bulk-approval flow shipped, and
 * `getEntityLock` was written to read it — but nothing ever called it, so the lock
 * was recorded and never enforced. This is the call site it was written for.
 *
 * The entity_type values are the bulk services' own ENTITY_TYPE constants
 * ("leave_request", "attendance_regularization"), not the discard module's shorter
 * preview names, so they are mapped here rather than passed through.
 */
async function bulkUploadLockBlocker(
  entityType: "leave" | "regularization" | "dispute",
  entityId: string,
): Promise<DiscardBlocker | null> {
  const { getEntityLock } = await import("../bulk-upload/bulk-approval.service.js");
  const lockedType = entityType === "leave" ? "leave_request" : "attendance_regularization";
  const lock = await getEntityLock(lockedType, entityId);
  if (!lock) return null;
  return {
    code: "LOCKED_BY_BULK_UPLOAD",
    message:
      `This row was applied by approved bulk upload ${lock.upload_batch_no ?? "(batch number unavailable)"} ` +
      `and is locked. Reverse it through that batch rather than discarding the row on its own.`,
  };
}

/**
 * The same lock, enforced inside the discard transaction.
 *
 * `bulkUploadLockBlocker` above runs in the preview, which is deliberately outside any
 * transaction — so between the preview passing and the discard committing, a bulk batch
 * can be approved over the very row being discarded. This is the guard that actually
 * makes the lock hold: it runs under the row lock the discard already holds, and throws
 * rather than reporting a blocker, because by this point there is no preview left to
 * put one in.
 */
async function assertNotBulkLocked(
  entityType: "leave_request" | "attendance_regularization",
  entityId: string,
): Promise<void> {
  const { getEntityLock } = await import("../bulk-upload/bulk-approval.service.js");
  const lock = await getEntityLock(entityType, entityId);
  if (!lock) return;
  throw httpError(
    `This row was applied by approved bulk upload ${lock.upload_batch_no ?? "(batch number unavailable)"} ` +
    `and is locked. Reverse it through that batch rather than discarding the row on its own.`,
    409,
    "LOCKED_BY_BULK_UPLOAD",
  );
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const discardService = {
  async previewLeave(id: string, actor: DiscardActor): Promise<DiscardPreview> {
    const leave = await loadLeave(id);
    if (!leave) throw httpError("Leave request not found", 404, "NOT_FOUND");

    const blockers: DiscardBlocker[] = [];
    const warnings: string[] = [];

    if (leave.status !== "approved") {
      blockers.push({
        code: "NOT_APPROVED",
        message: `Only an approved leave can be discarded (current status: ${leave.status}).`,
      });
    }
    if (leave.status === "lapsed") {
      blockers.push({ code: "LEAVE_LAPSED", message: "This leave lapsed at payroll close and cannot be discarded." });
    }
    if (!leave.leave_type_id) {
      blockers.push({ code: "NO_LEAVE_TYPE", message: "This leave has no leave type, so no balance can be credited back." });
    }

    const scopeBlocker = await checkScope(actor, leave.employee_id);
    if (scopeBlocker) blockers.push(scopeBlocker);

    const leaveLockBlocker = await bulkUploadLockBlocker("leave", id);
    if (leaveLockBlocker) blockers.push(leaveLockBlocker);

    const months = monthsInRange(String(leave.from_date), String(leave.to_date));
    const { payroll, blocker: payrollBlocker } = await checkPayrollMonths(months);
    if (payrollBlocker) blockers.push(payrollBlocker);

    // Balance
    const year = new Date(String(leave.from_date)).getFullYear();
    const days = Number(leave.total_days ?? 0);
    let balanceBefore: number | null = null;
    let ledgerRowExists = false;
    if (leave.leave_type_id) {
      const [balRows] = await db.execute<RowDataPacket[]>(
        `SELECT allocated_days, adjusted_days, used_days FROM leave_balance_ledger
          WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ? LIMIT 1`,
        [leave.employee_id, leave.leave_type_id, year]
      );
      const bal = balRows[0] as any;
      if (bal) {
        ledgerRowExists = true;
        balanceBefore =
          Number(bal.allocated_days ?? 0) + Number(bal.adjusted_days ?? 0) - Number(bal.used_days ?? 0);
      } else {
        warnings.push(
          `No leave balance row exists for ${leave.leave_name ?? "this leave type"} / ${year}; there is nothing to credit back.`
        );
      }
    }

    // Attendance
    const dates = enumerateDates(String(leave.from_date), String(leave.to_date));
    const [adrRows, snapshots] = await Promise.all([
      loadAttendanceRows(db, leave.employee_id, dates),
      readAttendanceSnapshots(db as any, "leave", id),
    ]);
    const attendance = dates.map((d) => planLeaveRestore(d, adrRows.get(d), snapshots.get(d)));

    for (const p of attendance) {
      if (p.mode === "skip_locked") warnings.push(`${p.date}: attendance row is locked and was left unchanged.`);
    }
    const hasRederive = attendance.some((p) => p.mode === "rederive");
    if (hasRederive) {
      warnings.push(
        "This leave was approved before pre-state snapshots existed. Affected days are recomputed by the attendance engine rather than restored exactly."
      );
    }

    return {
      entityType: "leave",
      entityId: id,
      employeeId: leave.employee_id,
      employeeName: leave.employee_name ?? null,
      employeeCode: leave.employee_code ?? null,
      currentStatus: String(leave.status),
      targetStatus: "discarded",
      blockers,
      warnings,
      leave: leave.leave_type_id
        ? {
            leaveTypeId: String(leave.leave_type_id),
            leaveTypeName: leave.leave_name ?? null,
            balanceYear: year,
            daysToRestore: days,
            balanceBefore,
            balanceAfter: balanceBefore === null ? null : balanceBefore + days,
            ledgerRowExists,
          }
        : null,
      attendance,
      payroll,
      unrecoverableFields: hasRederive ? UNRECOVERABLE_WITHOUT_SNAPSHOT : [],
    };
  },

  async previewRegularization(id: string, actor: DiscardActor): Promise<DiscardPreview> {
    const reg = await loadRegularization(id);
    if (!reg) throw httpError("Regularization not found", 404, "NOT_FOUND");

    const isDispute = reg.dispute_type != null;
    const blockers: DiscardBlocker[] = [];
    const warnings: string[] = [];

    if (reg.status !== "approved") {
      blockers.push({
        code: "NOT_APPROVED",
        message: `Only an approved ${isDispute ? "dispute" : "regularization"} can be discarded (current status: ${reg.status}).`,
      });
    }

    const scopeBlocker = await checkScope(actor, reg.employee_id);
    if (scopeBlocker) blockers.push(scopeBlocker);

    const regLockBlocker = await bulkUploadLockBlocker(isDispute ? "dispute" : "regularization", id);
    if (regLockBlocker) blockers.push(regLockBlocker);

    const sessionDate = String(reg.session_date).slice(0, 10);
    const { payroll, blocker: payrollBlocker } = await checkPayrollMonths([sessionDate.slice(0, 7)]);
    if (payrollBlocker) blockers.push(payrollBlocker);

    const sourceType: SnapshotSourceType = isDispute ? "dispute" : "regularization";
    const [adrRows, snapshots] = await Promise.all([
      loadAttendanceRows(db, reg.employee_id, [sessionDate]),
      readAttendanceSnapshots(db as any, sourceType, id),
    ]);
    const plan = planRegularizationRestore(id, sessionDate, adrRows.get(sessionDate), snapshots.get(sessionDate));

    if (plan.mode === "skip_locked" || plan.mode === "skip_owned") warnings.push(plan.note!);
    const degraded = plan.mode === "partial" || plan.mode === "rederive";
    if (degraded) {
      warnings.push(
        `This ${isDispute ? "dispute" : "regularization"} was approved before pre-state snapshots existed, so the restore is partial.`
      );
    }

    return {
      entityType: isDispute ? "dispute" : "regularization",
      entityId: id,
      employeeId: reg.employee_id,
      employeeName: reg.employee_name ?? null,
      employeeCode: reg.employee_code ?? null,
      currentStatus: String(reg.status),
      targetStatus: "discarded",
      blockers,
      warnings,
      leave: null,
      attendance: [plan],
      payroll,
      unrecoverableFields: degraded ? UNRECOVERABLE_WITHOUT_SNAPSHOT : [],
    };
  },

  async discardLeave(id: string, actor: DiscardActor, reason: string): Promise<DiscardResult> {
    const preview = await this.previewLeave(id, actor);
    if (preview.blockers.length > 0) {
      const first = preview.blockers[0];
      throw httpError(first.message, first.code === "OUT_OF_SCOPE" ? 403 : 409, first.code);
    }

    const warnings = [...preview.warnings];
    const reasonText = `Approved leave discarded: ${reason}`.slice(0, 500);
    const discardId = randomUUID();
    let balanceBefore: number | null = null;
    let balanceAfter: number | null = null;
    let plans: DateRestorePlan[] = [];
    let employeeId = "";
    let months: string[] = [];

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const leave = await loadLeave(id, conn, true);
      if (!leave) throw httpError("Leave request not found", 404, "NOT_FOUND");
      // Re-checked under the row lock: the preview ran outside the transaction, so
      // a concurrent discard could have landed in between. This is the guard that
      // makes a double discard impossible.
      if (leave.status !== "approved") {
        throw httpError(
          `Only an approved leave can be discarded (current status: ${leave.status}).`,
          409,
          "NOT_APPROVED"
        );
      }
      await assertNotBulkLocked("leave_request", id);

      employeeId = String(leave.employee_id);
      const days = Number(leave.total_days ?? 0);
      const year = new Date(String(leave.from_date)).getFullYear();
      const dates = enumerateDates(String(leave.from_date), String(leave.to_date));
      months = monthsInRange(String(leave.from_date), String(leave.to_date));

      // 1. Balance back. Same (employee, type, YEAR(from_date)) key the deduction
      //    used, and GREATEST(0, ...) because 4 ledger rows are already negative.
      const [balRows] = await conn.execute<RowDataPacket[]>(
        `SELECT allocated_days, adjusted_days, used_days FROM leave_balance_ledger
          WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ? FOR UPDATE`,
        [employeeId, leave.leave_type_id, year]
      );
      const bal = balRows[0] as any;
      if (bal) {
        balanceBefore =
          Number(bal.allocated_days ?? 0) + Number(bal.adjusted_days ?? 0) - Number(bal.used_days ?? 0);
        await conn.execute(
          `UPDATE leave_balance_ledger
              SET used_days = GREATEST(0, used_days - ?)
            WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
          [days, employeeId, leave.leave_type_id, year]
        );
        const [afterRows] = await conn.execute<RowDataPacket[]>(
          `SELECT allocated_days, adjusted_days, used_days FROM leave_balance_ledger
            WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ? LIMIT 1`,
          [employeeId, leave.leave_type_id, year]
        );
        const after = afterRows[0] as any;
        balanceAfter =
          Number(after.allocated_days ?? 0) + Number(after.adjusted_days ?? 0) - Number(after.used_days ?? 0);
      }

      // 2. Status off 'approved' BEFORE attendance, so the post-commit engine
      //    re-derive no longer resolves these days to leave_approved.
      const [statusResult] = await conn.execute(
        `UPDATE leave_request SET status = 'discarded' WHERE id = ? AND status = 'approved'`,
        [id]
      );
      if (Number((statusResult as any).affectedRows ?? 0) !== 1) {
        throw httpError("Leave status changed concurrently; discard aborted.", 409, "CONCURRENT_CHANGE");
      }
      await conn.execute(
        `INSERT INTO leave_approval_log (id, leave_request_id, action, action_by, remarks)
         VALUES (UUID(), ?, 'discarded', ?, ?)`,
        [id, actor.userId, reason]
      );

      // 3. Attendance, planned again under the row locks.
      const adrRows = await loadAttendanceRows(conn, employeeId, dates, true);
      const snapshots = await readAttendanceSnapshots(conn, "leave", id);
      plans = dates.map((d) => planLeaveRestore(d, adrRows.get(d), snapshots.get(d)));
      await applyRestore(conn, employeeId, plans, snapshots, actor.userId, reasonText);

      // 4. Ledger row.
      await conn.execute(
        `INSERT INTO approval_discard_log
           (id, entity_type, entity_id, employee_id, discarded_by, discarded_by_role, reason,
            restore_mode, leave_type_id, balance_year, days_restored, balance_before, balance_after,
            affected_dates, before_state_json, after_state_json, payroll_month)
         VALUES (?, 'leave', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          discardId, id, employeeId, actor.userId, actor.role ?? null, reason,
          summariseModes(plans), leave.leave_type_id, year, days, balanceBefore, balanceAfter,
          JSON.stringify(plans.map((p) => p.date)),
          JSON.stringify({ status: "approved", balance: balanceBefore, plans }),
          JSON.stringify({ status: "discarded", balance: balanceAfter }),
          months[0] ?? null,
        ]
      );

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // Post-commit side effects, each isolated: the discard is already durable and
    // must not be undone by a notification or payroll hiccup.
    warnings.push(...(await rederiveDates(employeeId, plans)));
    const payrollResult = await recalcPayroll(employeeId, months, "leave_discarded", id, actor.userId);
    warnings.push(...payrollResult.warnings);
    warnings.push(...(await recordRecalcStatus(discardId, payrollResult.outcomes)));
    warnings.push(...(await refreshDerivedStores(employeeId, months)));

    await logSensitiveAction({
      actor_user_id: actor.userId,
      action_type: "LEAVE_APPROVAL_DISCARDED",
      module_key: "leave",
      entity_type: "leave_request",
      entity_id: id,
      employee_id: employeeId,
      actor_role: actor.role ?? undefined,
      reason,
      old_value_json: { status: "approved", balance: balanceBefore },
      new_value_json: { status: "discarded", balance: balanceAfter, dates: plans.map((p) => p.date) },
    }).catch(() => { /* auditLog never throws, but do not let it matter */ });

    await notifyEmployee(employeeId, id, "leave", reason).catch(() => { /* non-fatal */ });

    return buildResult(discardId, "leave", id, employeeId, plans, warnings, {
      daysRestored: preview.leave?.daysToRestore ?? null,
      balanceBefore,
      balanceAfter,
      payrollRecalcStatus: payrollResult.status,
    });
  },

  async discardRegularization(id: string, actor: DiscardActor, reason: string): Promise<DiscardResult> {
    const preview = await this.previewRegularization(id, actor);
    if (preview.blockers.length > 0) {
      const first = preview.blockers[0];
      throw httpError(first.message, first.code === "OUT_OF_SCOPE" ? 403 : 409, first.code);
    }

    const warnings = [...preview.warnings];
    const entityType = preview.entityType as "regularization" | "dispute";
    const reasonText = `Approved ${entityType} discarded: ${reason}`.slice(0, 500);
    const discardId = randomUUID();
    let plans: DateRestorePlan[] = [];
    let employeeId = "";
    let month = "";

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const reg = await loadRegularization(id, conn, true);
      if (!reg) throw httpError("Regularization not found", 404, "NOT_FOUND");
      if (reg.status !== "approved") {
        throw httpError(
          `Only an approved ${entityType} can be discarded (current status: ${reg.status}).`,
          409,
          "NOT_APPROVED"
        );
      }
      await assertNotBulkLocked("attendance_regularization", id);

      employeeId = String(reg.employee_id);
      const sessionDate = String(reg.session_date).slice(0, 10);
      month = sessionDate.slice(0, 7);
      const sourceType: SnapshotSourceType = entityType === "dispute" ? "dispute" : "regularization";

      // Status first: payroll reconciliation and the attendance engine both key on
      // status = 'approved'. Reverting attendance while it still says approved
      // would trip payroll-attendance-control's drift alarm.
      const [statusResult] = await conn.execute(
        `UPDATE attendance_regularization
            SET status = 'discarded',
                reviewer_note = CONCAT(COALESCE(reviewer_note, ''), ' | DISCARDED: ', ?)
          WHERE id = ? AND status = 'approved'`,
        [reason, id]
      );
      if (Number((statusResult as any).affectedRows ?? 0) !== 1) {
        throw httpError("Regularization status changed concurrently; discard aborted.", 409, "CONCURRENT_CHANGE");
      }

      const adrRows = await loadAttendanceRows(conn, employeeId, [sessionDate], true);
      const snapshots = await readAttendanceSnapshots(conn, sourceType, id);
      plans = [planRegularizationRestore(id, sessionDate, adrRows.get(sessionDate), snapshots.get(sessionDate))];
      await applyRestore(conn, employeeId, plans, snapshots, actor.userId, reasonText);

      await conn.execute(
        `INSERT INTO approval_discard_log
           (id, entity_type, entity_id, employee_id, discarded_by, discarded_by_role, reason,
            restore_mode, affected_dates, before_state_json, after_state_json, payroll_month)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          discardId, entityType, id, employeeId, actor.userId, actor.role ?? null, reason,
          summariseModes(plans),
          JSON.stringify([sessionDate]),
          JSON.stringify({ status: "approved", attendance: plans.map((p) => ({ date: p.date, status: p.currentStatus, lwp: p.currentLwp })) }),
          JSON.stringify({ status: "discarded", attendance: plans.map((p) => ({ date: p.date, status: p.restoredStatus, lwp: p.restoredLwp, mode: p.mode })) }),
          month,
        ]
      );

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    warnings.push(...(await rederiveDates(employeeId, plans)));
    const payrollResult = await recalcPayroll(
      employeeId, [month], "attendance_regularization_discarded", id, actor.userId
    );
    warnings.push(...payrollResult.warnings);
    warnings.push(...(await recordRecalcStatus(discardId, payrollResult.outcomes)));
    warnings.push(...(await refreshDerivedStores(employeeId, [month])));

    // Two audit rows, mirroring the approval pair: one on the request, one on the
    // attendance day keyed the same way as ATTENDANCE_RECORD_CORRECTED so the
    // dispute audit timeline picks it up.
    await logSensitiveAction({
      actor_user_id: actor.userId,
      action_type: entityType === "dispute" ? "DISPUTE_APPROVAL_DISCARDED" : "REGULARIZATION_APPROVAL_DISCARDED",
      module_key: "attendance",
      entity_type: "attendance_regularization",
      entity_id: id,
      employee_id: employeeId,
      actor_role: actor.role ?? undefined,
      reason,
      old_value_json: { status: "approved" },
      new_value_json: { status: "discarded", attendance: plans },
    }).catch(() => {});

    await logSensitiveAction({
      actor_user_id: actor.userId,
      action_type: "ATTENDANCE_RECORD_RESTORED",
      module_key: "attendance",
      entity_type: "attendance_daily_record",
      // employee_id alone, with the date in the payload.
      //
      // Originally forced: entity_id was CHAR(36), the `<uuid>:<date>` composite is
      // 47 chars, MySQL rejected the row, and auditLog swallows its own errors — so
      // the trail lost it silently. Migration 1033 has since widened the column to
      // VARCHAR(100), and ATTENDANCE_RECORD_CORRECTED in
      // wfm.regularization.secure.routes.ts does key on the composite again.
      //
      // Kept as the bare id here on purpose: this row is looked up by employee to
      // answer "what was restored for this person", and a composite key would need
      // a LIKE scan to serve that. The one production discard from before the fix
      // (2026-07-31 19:58:40) has no row at all — nothing can recover it.
      entity_id: employeeId,
      employee_id: employeeId,
      actor_role: actor.role ?? undefined,
      reason,
      old_value_json: { record_date: plans[0]?.date, attendance_status: plans[0]?.currentStatus, lwp_value: plans[0]?.currentLwp },
      new_value_json: {
        record_date: plans[0]?.date,
        attendance_status: plans[0]?.restoredStatus,
        lwp_value: plans[0]?.restoredLwp,
        mode: plans[0]?.mode,
        rows_affected: plans[0]?.appliedRows ?? 0,
      },
    }).catch(() => {});

    await notifyEmployee(employeeId, id, entityType, reason).catch(() => {});

    return buildResult(discardId, entityType, id, employeeId, plans, warnings, {
      daysRestored: null,
      balanceBefore: null,
      balanceAfter: null,
      payrollRecalcStatus: payrollResult.status,
    });
  },

  async listDiscards(filters: {
    page: number;
    limit: number;
    entityType?: string;
    employeeId?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<{ data: unknown[]; total: number; page: number; limit: number }> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.entityType) { conds.push("adl.entity_type = ?"); params.push(filters.entityType); }
    if (filters.employeeId) { conds.push("adl.employee_id = ?"); params.push(filters.employeeId); }
    if (filters.fromDate) { conds.push("DATE(adl.discarded_at) >= ?"); params.push(filters.fromDate); }
    if (filters.toDate) { conds.push("DATE(adl.discarded_at) <= ?"); params.push(filters.toDate); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM approval_discard_log adl ${where}`,
      params
    );
    const total = Number((countRows[0] as any)?.total ?? 0);

    const offset = (filters.page - 1) * filters.limit;
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT adl.*,
              CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
              e.employee_code,
              au.email AS discarded_by_email
         FROM approval_discard_log adl
         LEFT JOIN employees e ON e.id = adl.employee_id
         LEFT JOIN auth_user au ON au.id = adl.discarded_by
         ${where}
        ORDER BY adl.discarded_at DESC
        LIMIT ${filters.limit} OFFSET ${offset}`,
      params
    );

    return { data: rows as unknown[], total, page: filters.page, limit: filters.limit };
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildResult(
  discardId: string,
  entityType: "leave" | "regularization" | "dispute",
  entityId: string,
  employeeId: string,
  plans: DateRestorePlan[],
  warnings: string[],
  extra: {
    daysRestored: number | null;
    balanceBefore: number | null;
    balanceAfter: number | null;
    payrollRecalcStatus: string | null;
  }
): DiscardResult {
  return {
    discardId,
    entityType,
    entityId,
    employeeId,
    restoreMode: summariseModes(plans),
    daysRestored: extra.daysRestored,
    balanceBefore: extra.balanceBefore,
    balanceAfter: extra.balanceAfter,
    // Counted from rows actually affected, not from what the plan intended. A
    // discard once reported "1 date deleted" while the row was still present,
    // because the DELETE matched nothing and nobody checked.
    datesRestored: plans.filter(
      (p) => (p.mode === "snapshot" || p.mode === "partial" || p.mode === "rederive") && (p.appliedRows ?? 0) > 0
    ).length,
    datesDeleted: plans.filter((p) => p.mode === "delete" && (p.appliedRows ?? 0) > 0).length,
    datesSkipped: plans.filter((p) => p.mode === "skip_locked" || p.mode === "skip_owned").length,
    attendance: plans,
    warnings,
    payrollRecalcStatus: extra.payrollRecalcStatus,
  };
}

/** Tell the employee their approved record was reversed. Deliberately no SMS. */
async function notifyEmployee(
  employeeId: string,
  entityId: string,
  entityType: "leave" | "regularization" | "dispute",
  reason: string
): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT user_id FROM employees WHERE id = ? LIMIT 1`,
    [employeeId]
  );
  const userId = (rows[0] as any)?.user_id;
  if (!userId) return;

  const label = entityType === "leave" ? "leave" : `attendance ${entityType}`;
  const { inboxService } = await import("../inbox/inbox.service.js");
  await inboxService.createItem({
    user_id: userId,
    type: entityType === "leave" ? "leave_request" : "attendance_regularization",
    title: `Approved ${label} was discarded`,
    description: `A previously approved ${label} request was discarded by an administrator. Reason: ${reason}`,
    entity_type: entityType === "leave" ? "leave" : "attendance",
    entity_id: entityId,
    action_url: entityType === "leave" ? "/leaves" : "/attendance-regularization",
    priority: "high",
  });
}
