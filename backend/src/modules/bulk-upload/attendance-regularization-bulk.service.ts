/**
 * Attendance Regularization — bulk upload.
 *
 * Import stages each spreadsheet line as a real row in `attendance_regularization`
 * with status='pending', which is byte-for-byte what the single-employee
 * Attendance Regularization screen creates: it calls the same
 * wfmService.submitRegularization(), so the duplicate check, the reason-code
 * validation and the branch/manager routing all run per row.
 *
 * Approval calls wfmService.reviewRegularization(), the same engine the manual
 * approver runs — which is what actually writes the correction into
 * attendance_daily_record. This file never touches an attendance record itself.
 */
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { wfmService } from "../wfm/wfm.service.js";
import { DISPUTE_TYPES } from "../wfm/wfm.validation.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import {
  loadStagedRows, resolveEmployees, resolveSingleBranch, linkRowToEntity,
  markRowFailed, markPendingApproval, lockEntities, BulkUploadError, normalizeDate,
  type ImportOutcome, type ApplyOutcome, type BatchRecord,
} from "./bulk-approval.service.js";
import { mapWithConcurrency, BULK_ROW_CONCURRENCY } from "./batch-job.js";
import { withBulkLockRetry } from "./lock-retry.js";
import { sendSMS } from "../communication/sms.helper.js";

export const ENTITY_TYPE = "attendance_regularization";

/** Mirrors regularizationSchema's own lookback rule so the error names the limit. */
const MAX_LOOKBACK_DAYS = 90;
const VALID_STATUSES = new Set(["present", "half_day", "absent"]);
const TIME_RE = /^\d{2}:\d{2}$/;

/** Normalise requested_status variants to canonical DB values.
 *  Users type "Half Day", "half-day", "Half_Day" etc. — all map to "half_day".
 */
function normalizeRequestedStatus(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/[\s\-]+/g, "_");
  if (s === "half_day" || s === "halfday") return "half_day";
  if (s === "present") return "present";
  if (s === "absent") return "absent";
  if (s === "missing_punch") return "missing_punch";
  return s;
}

function validateRow(d: Record<string, string>): string | null {
  if (!d.employee_code) return "employee_code is required";

  // Normalise in place before validating, so a DD-MM-YYYY cell (what the Hub's own
  // template guide tells users to type) or an Excel date serial is accepted rather
  // than rejected as malformed.
  const session_date = normalizeDate(d.session_date);
  if (!session_date) {
    return `session_date must be a date (YYYY-MM-DD or DD-MM-YYYY), got "${d.session_date}"`;
  }
  d.session_date = session_date;

  // Normalise requested_status before validation — half-day / Half Day / Half_Day → half_day
  if (d.requested_status) {
    d.requested_status = normalizeRequestedStatus(d.requested_status);
  }

  if (!d.reason || d.reason.trim().length < 10) {
    return "reason is required and must be at least 10 characters — it is the audit record for the correction";
  }
  if (d.requested_status && !VALID_STATUSES.has(d.requested_status)) {
    return `requested_status must be one of: present, half_day, absent (got "${d.requested_status}"). Also accepted: half-day, Half Day, Half_Day`;
  }
  // Treat "-", "N/A", "na", "none", whitespace as blank (user fills placeholder dashes)
  if (d.dispute_type && /^[-–—nN\/aA\s]+$/.test(d.dispute_type.trim())) {
    d.dispute_type = "";
  }
  if (d.dispute_type && !(DISPUTE_TYPES as readonly string[]).includes(d.dispute_type.toLowerCase())) {
    return `dispute_type "${d.dispute_type}" is not a recognised dispute type`;
  }
  for (const field of ["new_punch_in", "new_punch_out"]) {
    if (d[field] && !TIME_RE.test(d[field])) return `${field} must be HH:MM (got "${d[field]}")`;
  }

  // A regularization with neither a status nor a corrected punch cannot change
  // anything — reviewRegularization refuses to approve it. Catching that here means
  // the uploader sees it at upload time, not the branch head at approval time.
  if (!d.requested_status && !d.new_punch_in && !d.new_punch_out) {
    const exceptionTypes = ["work_from_home", "week_off_worked", "holiday_worked"];
    if (!exceptionTypes.includes((d.dispute_type ?? "").toLowerCase())) {
      return "row has neither requested_status nor a corrected punch time, so approving it could not change the attendance record";
    }
  }

  const session = new Date(`${d.session_date}T00:00:00`);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (session > today) return "cannot regularize a future date";
  const lookback = new Date();
  lookback.setDate(lookback.getDate() - MAX_LOOKBACK_DAYS);
  lookback.setHours(0, 0, 0, 0);
  if (session < lookback) return `cannot regularize dates older than ${MAX_LOOKBACK_DAYS} days`;

  return null;
}

export async function importRegularizationBatch(
  batchId: string,
  userId: string,
): Promise<ImportOutcome> {
  const rows = await loadStagedRows(batchId);
  if (rows.length === 0) throw new BulkUploadError("This batch has no rows left to import.", 400);

  const employees = await resolveEmployees(rows.map((r) => r.data.employee_code ?? ""), { includeInactive: true });
  const errors: string[] = [];
  let staged = 0;
  let failed = 0;

  // Branch is resolved before anything is written, so a cross-branch file is refused
  // rather than half-created and then blocked at approval.
  const matched = rows
    .map((r) => employees.get((r.data.employee_code ?? "").toUpperCase()))
    .filter(Boolean) as NonNullable<ReturnType<typeof employees.get>>[];
  const { branchId, error: branchError } = resolveSingleBranch(matched);
  if (branchError) throw new BulkUploadError(branchError, 400);

  // Partition into (a) rows that fail validation immediately — no DB work needed — and
  // (b) rows that are valid and ready to stage. Validation is CPU-only so it runs first
  // in a single pass to avoid touching the pool for rows we already know will fail.
  const toStage: typeof rows = [];
  for (const row of rows) {
    const d = row.data;
    const code = (d.employee_code ?? "").toUpperCase();
    const emp = employees.get(code);
    const validationError = validateRow(d);
    if (validationError) {
      const msg = `Row ${row.rowNo} (${d.employee_code || "no code"}): ${validationError}`;
      errors.push(msg);
      await markRowFailed(row.rowId, msg);
      failed++;
      continue;
    }
    if (!emp) {
      const msg = `Row ${row.rowNo}: employee_code "${d.employee_code}" is not in the employee master`;
      errors.push(msg);
      await markRowFailed(row.rowId, msg);
      failed++;
      continue;
    }
    toStage.push(row);
  }

  // Group by employee so consecutive dates for the same person stay serial (they
  // share a row in attendance_regularization keyed on employee+date, so two parallel
  // inserts for the same employee would race). Different employees touch disjoint rows
  // and run concurrently, bounded by BULK_ROW_CONCURRENCY. This is the same grouping
  // applyRegularizationBatch uses — import now matches apply.
  const byEmployee = new Map<string, typeof rows>();
  for (const row of toStage) {
    const key = (row.data.employee_code ?? "").toUpperCase();
    if (!byEmployee.has(key)) byEmployee.set(key, []);
    byEmployee.get(key)!.push(row);
  }

  const groupResults = await mapWithConcurrency(
    [...byEmployee.values()],
    BULK_ROW_CONCURRENCY,
    async (empRows) => {
      let grpStaged = 0;
      let grpFailed = 0;
      const grpErrors: string[] = [];
      for (const row of empRows) {
        const d = row.data;
        const emp = employees.get((d.employee_code ?? "").toUpperCase())!;
        try {
          const created = await wfmService.submitRegularization(
            {
              employeeId: emp.id,
              sessionDate: d.session_date,
              reason: d.reason,
              reasonCode: d.reason_code || undefined,
              requestedStatus: (d.requested_status ? normalizeRequestedStatus(d.requested_status) : null) as never,
              disputeType: (d.dispute_type?.toLowerCase() || null) as never,
              newPunchIn: d.new_punch_in || null,
              newPunchOut: d.new_punch_out || null,
              supportingNote: d.supporting_note || null,
              requestedByType: "manager",
            } as never,
            userId,
          );
          await linkRowToEntity(row.rowId, ENTITY_TYPE, created.id);
          grpStaged++;
        } catch (err) {
          const msg = `Row ${row.rowNo} (${d.employee_code}): ${(err as Error)?.message ?? String(err)}`;
          grpErrors.push(msg);
          await markRowFailed(row.rowId, msg);
          grpFailed++;
        }
      }
      return { grpStaged, grpFailed, grpErrors };
    },
  );

  for (const r of groupResults) {
    staged += r.grpStaged;
    failed += r.grpFailed;
    errors.push(...r.grpErrors);
  }

  await markPendingApproval(batchId, branchId, staged, failed);
  return { staged, failed, branchId, errors };
}

interface LinkedRow extends RowDataPacket {
  id: string;
  row_no: number;
  created_entity_id: string;
  employee_id: string | null;
  /** Needed to key the deferred payroll recalculation by employee-MONTH. */
  session_date: string | null;
}

/**
 * The staged regularizations this batch created, each carrying the employee it
 * belongs to.
 *
 * The employee_id is joined in rather than looked up per row because the apply below
 * groups by it: two corrections for the SAME employee must run one after the other
 * (they read and rewrite the same attendance_daily_record days and would deadlock or
 * race), while different employees touch disjoint rows and can run together.
 */
async function linkedRows(batchId: string): Promise<LinkedRow[]> {
  const [rows] = await db.execute<LinkedRow[]>(
    `SELECT ubr.id, ubr.row_no, ubr.created_entity_id, ar.employee_id,
            DATE_FORMAT(ar.session_date, '%Y-%m-%d') AS session_date
       FROM upload_batch_row ubr
       LEFT JOIN attendance_regularization ar ON ar.id = ubr.created_entity_id
      WHERE ubr.upload_batch_id = ? AND ubr.created_entity_type = ? AND ubr.created_entity_id IS NOT NULL
      ORDER BY ubr.row_no ASC`,
    [batchId, ENTITY_TYPE],
  );
  return rows as LinkedRow[];
}

/**
 * The three side effects reviewRegularization defers for the bulk path, run once each.
 *
 * Inline, these dominate the approval loop. The payroll recalculation is the worst: it re-costs
 * an employee's entire open month, and running it per row means an employee with ten corrections
 * in the file has their month re-costed ten times for the same final answer. Keyed by
 * employee-MONTH here, a 3,653-row batch spanning ~700 employees does ~700 recalculations
 * instead of 3,653.
 *
 * Nothing is dropped — the work-inbox alerts still close, the SMS still goes, the month is still
 * recalculated. Only the number of times each happens changes, and recalculation is idempotent,
 * so the end state is identical.
 *
 * Every part is best-effort and independently caught: the approvals are already committed, and a
 * failed notification must not turn a successful batch into a failed one. A missed inbox clear is
 * swept up by the reconciliation worker; a stale payroll line surfaces in payroll readiness.
 */
async function runDeferredSideEffects(
  applied: Array<{ employeeId: string; sessionDate: string; regularizationId: string }>,
  approverUserId: string,
): Promise<void> {
  if (applied.length === 0) return;

  const employeeIds = [...new Set(applied.map((a) => a.employeeId))];

  // 1. Close the work-inbox alerts these decisions settle — one statement for the whole batch
  //    instead of one per row, each carrying a correlated NOT EXISTS.
  try {
    const placeholders = employeeIds.map(() => "?").join(",");
    await db.execute(
      `UPDATE work_inbox_item
          SET is_actioned = 1, is_read = 1
        WHERE is_actioned = 0
          AND entity_type = 'attendance'
          AND type IN ('attendance_regularization','attendance_missing_punch','attendance_validation')
          AND entity_id IN (${placeholders})
          AND NOT EXISTS (
                SELECT 1 FROM attendance_regularization ar
                 WHERE ar.employee_id = work_inbox_item.entity_id
                   AND ar.status NOT IN ('approved','rejected','cancelled','discarded'))`,
      employeeIds,
    );
  } catch { /* non-fatal: the inbox reconciliation sweep closes what this misses */ }

  // 2. One SMS per employee, not per row. Someone with eight corrections in the file gets one
  //    message about the batch rather than eight identical ones seconds apart.
  try {
    const placeholders = employeeIds.map(() => "?").join(",");
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, CONCAT(first_name,' ',COALESCE(last_name,'')) AS name, mobile, personal_phone
         FROM employees WHERE id IN (${placeholders})`,
      employeeIds,
    );
    const byEmp = new Map<string, { name: string; phone: string | null }>();
    for (const e of empRows as any[]) {
      byEmp.set(String(e.id), { name: String(e.name ?? ""), phone: e.mobile ?? e.personal_phone ?? null });
    }
    const datesByEmp = new Map<string, string[]>();
    for (const a of applied) {
      if (!datesByEmp.has(a.employeeId)) datesByEmp.set(a.employeeId, []);
      datesByEmp.get(a.employeeId)!.push(a.sessionDate);
    }
    for (const [empId, dates] of datesByEmp) {
      const emp = byEmp.get(empId);
      if (!emp?.phone) continue;
      const sorted = [...new Set(dates)].sort();
      sendSMS(emp.phone, "attendance_regularization_approved", {
        name: emp.name,
        date: sorted.length === 1 ? sorted[0] : `${sorted[0]} +${sorted.length - 1} more`,
      }).catch(() => {});
    }
  } catch { /* non-fatal */ }

  // 3. Payroll recalculation, once per distinct employee-month.
  try {
    const { recalculateOpenPayrollForEmployee, queuePayrollRecalculation } = await import(
      "../payroll/payroll-targeted-recalculation.service.js"
    );
    const byEmpMonth = new Map<string, { employeeId: string; month: string; regularizationId: string }>();
    for (const a of applied) {
      const month = a.sessionDate.slice(0, 7);
      const key = `${a.employeeId}|${month}`;
      if (!byEmpMonth.has(key)) {
        byEmpMonth.set(key, { employeeId: a.employeeId, month, regularizationId: a.regularizationId });
      }
    }
    // Bounded like the row loop: a recalculation is heavier than a row, and the pool is shared
    // with 45 workers.
    await mapWithConcurrency([...byEmpMonth.values()], BULK_ROW_CONCURRENCY, async (t) => {
      try {
        await recalculateOpenPayrollForEmployee({
          employeeId: t.employeeId,
          payrollMonth: t.month,
          sourceEventType: "attendance_regularization",
          sourceEventId: t.regularizationId,
          reason: `Bulk approved attendance regularizations for ${t.month}`,
          actorUserId: approverUserId,
        });
      } catch (err: any) {
        try {
          await queuePayrollRecalculation({
            employeeId: t.employeeId,
            payrollMonth: t.month,
            sourceEventType: "attendance_regularization",
            sourceEventId: t.regularizationId,
            reason: `Bulk recalculation failed: ${err?.message ?? String(err)}`,
            requestedBy: approverUserId,
          });
        } catch { /* payroll readiness will surface the stale line */ }
      }
    });
  } catch { /* non-fatal */ }
}

export async function applyRegularizationBatch(
  batch: BatchRecord,
  approverUserId: string,
  remarks: string | null,
): Promise<ApplyOutcome> {
  const rows = await linkedRows(batch.id);
  const errors: string[] = [];
  let applied = 0;
  let failed = 0;

  // Row by row, one at a time, this is the slowest of the four apply paths:
  // reviewRegularization opens a transaction and runs roughly eight queries per row,
  // so a 217-row branch-month batch ran for minutes and used to be cut off by the
  // proxy timeout. Employees are independent of each other — a correction only ever
  // touches that employee's own attendance days — so their groups run concurrently,
  // bounded by BULK_ROW_CONCURRENCY so the shared connection pool keeps its headroom.
  //
  // Within a group the rows stay strictly serial: consecutive dates for one employee
  // are exactly the case that deadlocks on attendance_daily_record, which is what
  // withBulkLockRetry below exists for. This mirrors applyLeaveBatch's grouping.
  const byEmployee = new Map<string, LinkedRow[]>();
  for (const row of rows) {
    const key = row.employee_id ? String(row.employee_id) : `__unresolved_${row.row_no}`;
    if (!byEmployee.has(key)) byEmployee.set(key, []);
    byEmployee.get(key)!.push(row);
  }

  // Locks are collected here and written ONCE after the loop (see lockEntities call
  // below) instead of one INSERT per row inline. For a 148-row batch that was 148
  // sequential round trips competing with the domain engine's own per-row queries for
  // the same pooled connections — the biggest single throughput cost this apply path
  // had left after the per-row work itself. Batched, it is one write (chunked at 500).
  const toLock: { entityId: string; employeeId: string | null }[] = [];

  const groupResults = await mapWithConcurrency(
    [...byEmployee.values()],
    BULK_ROW_CONCURRENCY,
    async (empRows) => {
      let grpApplied = 0;
      let grpFailed = 0;
      const grpErrors: string[] = [];
      const grpLocked: { entityId: string; employeeId: string | null }[] = [];
      const grpApplied_: { employeeId: string; sessionDate: string; regularizationId: string }[] = [];

      for (const row of empRows) {
        try {
          await withBulkLockRetry(() =>
            wfmService.reviewRegularization(
              row.created_entity_id,
              {
                status: "approved",
                reviewerNote: remarks
                  ? `Branch Head bulk approval (${batch.upload_batch_no}): ${remarks}`
                  : `Branch Head bulk approval (${batch.upload_batch_no})`,
              },
              approverUserId,
              // Work-inbox clear, SMS and payroll recalculation are per-employee-month concerns,
              // not per-row ones. Run inline they dominate this loop — the recalculation alone
              // re-costs an employee's whole month once per correction they have in the file.
              // Collected below and run once each after the loop; see runDeferredSideEffects.
              { deferSideEffects: true },
            )
          );
          grpLocked.push({ entityId: row.created_entity_id, employeeId: row.employee_id ? String(row.employee_id) : null });
          // Collected for the deferred side effects. Only rows that actually applied, so a
          // failed row never triggers a notification or a recalculation of its own.
          if (row.employee_id && row.session_date) {
            grpApplied_.push({
              employeeId: String(row.employee_id),
              sessionDate: String(row.session_date),
              regularizationId: row.created_entity_id,
            });
          }
          void logSensitiveAction({
            actor_user_id: approverUserId,
            actor_role: "branch_head",
            action_type: "REGULARIZATION_APPROVED",
            module_key: "attendance",
            entity_type: ENTITY_TYPE,
            entity_id: row.created_entity_id,
            reason: remarks ?? undefined,
            new_value_json: { via_bulk_upload: true, upload_batch_no: batch.upload_batch_no },
          });
          grpApplied++;
        } catch (err) {
          const msg = `Row ${row.row_no}: ${(err as Error)?.message ?? String(err)}`;
          grpErrors.push(msg);
          await markRowFailed(row.id, msg);
          grpFailed++;
        }
      }
      return { grpApplied, grpFailed, grpErrors, grpLocked, grpApplied_ };
    },
  );

  const appliedRows: { employeeId: string; sessionDate: string; regularizationId: string }[] = [];
  for (const r of groupResults) {
    applied += r.grpApplied;
    failed += r.grpFailed;
    errors.push(...r.grpErrors);
    toLock.push(...r.grpLocked);
    appliedRows.push(...r.grpApplied_);
  }

  await lockEntities(
    toLock.map((e) => ({
      entityType: ENTITY_TYPE,
      entityId: e.entityId,
      batchId: batch.id,
      batchNo: batch.upload_batch_no,
      employeeId: e.employeeId,
      lockedBy: approverUserId,
    })),
  );

  // After the locks, so a side effect that runs long cannot delay the batch's own bookkeeping.
  await runDeferredSideEffects(appliedRows, approverUserId);

  return { applied, failed, errors };
}

export async function rejectRegularizationBatch(
  batch: BatchRecord,
  approverUserId: string,
  remarks: string,
): Promise<ApplyOutcome> {
  const rows = await linkedRows(batch.id);
  const errors: string[] = [];
  let applied = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      await wfmService.reviewRegularization(
        row.created_entity_id,
        {
          status: "rejected",
          reviewerNote: `Branch Head rejected bulk upload ${batch.upload_batch_no}: ${remarks}`,
        },
        approverUserId,
      );
      applied++;
    } catch (err) {
      errors.push(`Row ${row.row_no}: ${(err as Error)?.message ?? String(err)}`);
      failed++;
    }
  }

  return { applied, failed, errors };
}
