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
  markRowFailed, markPendingApproval, lockEntity, BulkUploadError, normalizeDate,
  type ImportOutcome, type ApplyOutcome, type BatchRecord,
} from "./bulk-approval.service.js";
import { mapWithConcurrency, BULK_ROW_CONCURRENCY } from "./batch-job.js";
import { withBulkLockRetry } from "./lock-retry.js";

export const ENTITY_TYPE = "attendance_regularization";

/** Mirrors regularizationSchema's own lookback rule so the error names the limit. */
const MAX_LOOKBACK_DAYS = 90;
const VALID_STATUSES = new Set(["present", "half_day", "absent"]);
const TIME_RE = /^\d{2}:\d{2}$/;

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
  if (!d.reason || d.reason.trim().length < 10) {
    return "reason is required and must be at least 10 characters — it is the audit record for the correction";
  }
  if (d.requested_status && !VALID_STATUSES.has(d.requested_status.toLowerCase())) {
    return `requested_status must be one of present, half_day, absent (got "${d.requested_status}")`;
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

  const employees = await resolveEmployees(rows.map((r) => r.data.employee_code ?? ""));
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
      const msg = `Row ${row.rowNo}: employee_code "${d.employee_code}" is not in the employee master, or has no attendance in the last 180 days`;
      errors.push(msg);
      await markRowFailed(row.rowId, msg);
      failed++;
      continue;
    }

    try {
      const created = await wfmService.submitRegularization(
        {
          employeeId: emp.id,
          sessionDate: d.session_date,
          reason: d.reason,
          reasonCode: d.reason_code || undefined,
          requestedStatus: (d.requested_status?.toLowerCase() || null) as never,
          disputeType: (d.dispute_type?.toLowerCase() || null) as never,
          newPunchIn: d.new_punch_in || null,
          newPunchOut: d.new_punch_out || null,
          supportingNote: d.supporting_note || null,
          // The uploader is WFM or Super Admin acting on the employee's behalf,
          // never the employee themselves.
          requestedByType: "manager",
        } as never,
        userId,
      );
      await linkRowToEntity(row.rowId, ENTITY_TYPE, created.id);
      staged++;
    } catch (err) {
      const msg = `Row ${row.rowNo} (${d.employee_code}): ${(err as Error)?.message ?? String(err)}`;
      errors.push(msg);
      await markRowFailed(row.rowId, msg);
      failed++;
    }
  }

  await markPendingApproval(batchId, branchId, staged, failed);
  return { staged, failed, branchId, errors };
}

interface LinkedRow extends RowDataPacket {
  id: string;
  row_no: number;
  created_entity_id: string;
  employee_id: string | null;
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
    `SELECT ubr.id, ubr.row_no, ubr.created_entity_id, ar.employee_id
       FROM upload_batch_row ubr
       LEFT JOIN attendance_regularization ar ON ar.id = ubr.created_entity_id
      WHERE ubr.upload_batch_id = ? AND ubr.created_entity_type = ? AND ubr.created_entity_id IS NOT NULL
      ORDER BY ubr.row_no ASC`,
    [batchId, ENTITY_TYPE],
  );
  return rows as LinkedRow[];
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

  const groupResults = await mapWithConcurrency(
    [...byEmployee.values()],
    BULK_ROW_CONCURRENCY,
    async (empRows) => {
      let grpApplied = 0;
      let grpFailed = 0;
      const grpErrors: string[] = [];

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
            )
          );
          await lockEntity({
            entityType: ENTITY_TYPE,
            entityId: row.created_entity_id,
            batchId: batch.id,
            batchNo: batch.upload_batch_no,
            employeeId: row.employee_id ? String(row.employee_id) : null,
            lockedBy: approverUserId,
          });
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
      return { grpApplied, grpFailed, grpErrors };
    },
  );

  for (const r of groupResults) {
    applied += r.grpApplied;
    failed += r.grpFailed;
    errors.push(...r.grpErrors);
  }

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
