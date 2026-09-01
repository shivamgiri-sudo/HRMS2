/**
 * Leave Application — bulk upload.
 *
 * Import stages each spreadsheet line as a real row in `leave_request` by calling
 * leaveService.submitRequest() — the exact call the Apply Leave screen makes. So the
 * overlap check, the holiday/week-off chargeable-day calculation, the CL/ML monthly
 * cap and the EL policy rules all run per row, and total_days is stored as the
 * service's authoritative chargeable count rather than whatever the spreadsheet said.
 *
 * NOTHING is deducted at upload. The balance moves only when the branch head
 * approves, at which point leaveService.reviewRequest() runs and writes
 * leave_balance_ledger, leave_balance_deduction and leave_approval_log exactly as a
 * manual approval does. That is why a rejected batch needs no reversal — there is
 * nothing to reverse.
 */
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { leaveService } from "../leave/leave.service.js";
import {
  loadStagedRows, resolveEmployees, resolveSingleBranch, linkRowToEntity,
  markRowFailed, markPendingApproval, lockEntity, BulkUploadError, normalizeDate,
  type ImportOutcome, type ApplyOutcome, type BatchRecord,
} from "./bulk-approval.service.js";
import { mapWithConcurrency, BULK_ROW_CONCURRENCY } from "./batch-job.js";

export const ENTITY_TYPE = "leave_request";

/**
 * Deadlock retry helper — MySQL InnoDB can raise ER_LOCK_DEADLOCK when concurrent
 * leave balance reads/writes collide. Retry the transaction up to maxRetries times.
 */
async function withDeadlockRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      const errno = (err as { errno?: number })?.errno;
      if ((code === "ER_LOCK_DEADLOCK" || errno === 1213) && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 50 * attempt));
        continue;
      }
      throw err;
    }
  }
}

interface LeaveTypeRow extends RowDataPacket {
  id: string;
  leave_code: string;
  leave_name: string;
}

async function loadLeaveTypes(): Promise<Map<string, LeaveTypeRow>> {
  const [rows] = await db.execute<LeaveTypeRow[]>(
    "SELECT id, leave_code, leave_name FROM leave_type_master",
  );
  const map = new Map<string, LeaveTypeRow>();
  for (const r of rows as LeaveTypeRow[]) {
    map.set(String(r.leave_code).trim().toUpperCase(), r);
  }
  return map;
}

export async function importLeaveBatch(
  batchId: string,
  userId: string,
): Promise<ImportOutcome> {
  const rows = await loadStagedRows(batchId);
  if (rows.length === 0) throw new BulkUploadError("This batch has no rows left to import.", 400);

  const employees = await resolveEmployees(rows.map((r) => r.data.employee_code ?? ""));
  const leaveTypes = await loadLeaveTypes();
  const errors: string[] = [];
  let staged = 0;
  let failed = 0;

  const matched = rows
    .map((r) => employees.get((r.data.employee_code ?? "").toUpperCase()))
    .filter(Boolean) as NonNullable<ReturnType<typeof employees.get>>[];
  const { branchId, error: branchError } = resolveSingleBranch(matched);
  if (branchError) throw new BulkUploadError(branchError, 400);

  for (const row of rows) {
    const d = row.data;
    const emp = employees.get((d.employee_code ?? "").toUpperCase());
    const leaveType = leaveTypes.get((d.leave_code ?? "").toUpperCase());

    let validationError: string | null = null;
    if (!d.employee_code) validationError = "employee_code is required";
    else if (!emp) validationError = `employee_code "${d.employee_code}" not found or not active`;
    else if (!d.leave_code) validationError = "leave_code is required";
    else if (!leaveType) {
      validationError =
        `leave_code "${d.leave_code}" is not in leave_type_master — valid codes are ` +
        `${[...leaveTypes.keys()].sort().join(", ")}`;
    } else {
      // Normalise both dates in place first: DD-MM-YYYY (what the Hub template guide
      // instructs) and Excel date serials both have to be accepted.
      const from = normalizeDate(d.from_date);
      const to = normalizeDate(d.to_date);
      if (!from) validationError = `from_date must be a date (YYYY-MM-DD or DD-MM-YYYY), got "${d.from_date}"`;
      else if (!to) validationError = `to_date must be a date (YYYY-MM-DD or DD-MM-YYYY), got "${d.to_date}"`;
      else {
        d.from_date = from;
        d.to_date = to;
      }
    }

    if (!validationError && emp && leaveType) {
      if (d.to_date < d.from_date) validationError = "to_date must be on or after from_date";
      else {
      const days = Number(d.total_days);
      if (!Number.isFinite(days) || days < 0.5) {
        validationError = `total_days must be a number of at least 0.5 (got "${d.total_days}")`;
      } else {
        const calendarDays =
          (new Date(`${d.to_date}T00:00:00`).getTime() -
            new Date(`${d.from_date}T00:00:00`).getTime()) / 86_400_000 + 1;
        if (days > calendarDays) {
          validationError =
            `total_days ${days} exceeds the ${calendarDays} calendar day(s) between from_date and to_date`;
        }
        }
      }
    }

    if (validationError || !emp || !leaveType) {
      const msg = `Row ${row.rowNo} (${d.employee_code || "no code"}): ${validationError}`;
      errors.push(msg);
      await markRowFailed(row.rowId, msg);
      failed++;
      continue;
    }

    try {
      // The same call Apply Leave makes. Balance is NOT touched here.
      const created = await leaveService.submitRequest(
        {
          employeeId: emp.id,
          leaveTypeId: leaveType.id,
          fromDate: d.from_date,
          toDate: d.to_date,
          totalDays: Number(d.total_days),
          reason: d.reason || null,
        },
        userId,
      );
      // Flag it for the branch head explicitly. submitRequest already sets
      // pending_branch_head for the two EL exception paths; for every other leave
      // type it sets plain 'pending', and a bulk-uploaded row must still route to
      // the branch head rather than the employee's reporting manager.
      await db.execute(
        `UPDATE leave_request
            SET requires_branch_head_approval = 1, approval_level = 'branch_head'
          WHERE id = ?`,
        [created.id],
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
}

async function linkedRows(batchId: string): Promise<LinkedRow[]> {
  const [rows] = await db.execute<LinkedRow[]>(
    `SELECT id, row_no, created_entity_id
       FROM upload_batch_row
      WHERE upload_batch_id = ? AND created_entity_type = ? AND created_entity_id IS NOT NULL
      ORDER BY row_no ASC`,
    [batchId, ENTITY_TYPE],
  );
  return rows as LinkedRow[];
}

export async function applyLeaveBatch(
  batch: BatchRecord,
  approverUserId: string,
  remarks: string | null,
): Promise<ApplyOutcome> {
  const rows = await linkedRows(batch.id);
  const errors: string[] = [];
  let applied = 0;
  let failed = 0;

  // Fetch employee_id for each leave_request so we can group by employee.
  // Same-employee rows must run serially — reviewRequest reads then writes the
  // leave balance and two parallel calls for the same employee would both read
  // the pre-deduction balance and produce a double-deduction. Different employees
  // have independent balances so their rows can run concurrently.
  const leaveIds = rows.map((r) => r.created_entity_id);
  const empByLeaveId = new Map<string, string>();
  if (leaveIds.length > 0) {
    const [lrRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_id FROM leave_request WHERE id IN (${leaveIds.map(() => "?").join(",")})`,
      leaveIds,
    );
    for (const lr of lrRows as RowDataPacket[]) {
      empByLeaveId.set(String(lr.id), String(lr.employee_id));
    }
  }

  const byEmployee = new Map<string, LinkedRow[]>();
  for (const row of rows) {
    const empId = empByLeaveId.get(row.created_entity_id) ?? `__unresolved_${row.row_no}`;
    if (!byEmployee.has(empId)) byEmployee.set(empId, []);
    byEmployee.get(empId)!.push(row);
  }

  // Bounded rather than a plain Promise.all over every employee: the pool is 25
  // connections with queueLimit 100 (db/mysql.ts), shared with every other request
  // the API is serving. A 217-employee batch fanned out at once asks for 217
  // connections, drains the pool and then overflows the queue — which turns one slow
  // approval into failed requests across the whole app.
  const groupResults = await mapWithConcurrency(
    [...byEmployee.values()],
    BULK_ROW_CONCURRENCY,
    async (empRows) => {
      let grpApplied = 0;
      let grpFailed = 0;
      const grpErrors: string[] = [];

      for (const row of empRows) {
        try {
          // 'approved', not 'branch_head_approved'.
          //
          // Both statuses run the identical balance deduction and attendance write inside
          // reviewRequest, so the two looked interchangeable. They are not, once the row
          // is in the table: 'approved' is the ONLY leave status the rest of the system
          // reads. attendance-engine.service.ts resolves an approved-leave override with
          // `leave_request.status = 'approved'`, and the day it writes into
          // attendance_daily_record is left is_locked = 0 (verified live: 14 of 14
          // leave_approved rows are unlocked). So a batch approved as
          // 'branch_head_approved' produced a leave_approved attendance row that the
          // nightly engine could not see any leave behind — it reclassified the day from
          // biometric/APR evidence, overwrote the unlocked row as 'absent' with
          // lwp_value 1.00, and payroll charged LWP for leave the branch head had
          // approved. The upload would have looked like it worked, and the money would
          // have been wrong a night later.
          //
          // Fourteen other consumers filter leave the same way — payroll's
          // leave-reversal.service.ts, the leave-balance-sync worker, roster capacity,
          // RTA and the reporting executors among them — so this is not only the engine.
          //
          // Who approved it is not lost: importLeaveBatch already sets approval_level =
          // 'branch_head' and requires_branch_head_approval = 1 on every row of the
          // batch, and the remark below names the batch.
          await withDeadlockRetry(() =>
            leaveService.reviewRequest(
              row.created_entity_id,
              {
                status: "approved",
                remarks: remarks
                  ? `Branch Head bulk approval (${batch.upload_batch_no}): ${remarks}`
                  : `Branch Head bulk approval (${batch.upload_batch_no})`,
              },
              approverUserId,
            ),
          );
          await lockEntity({
            entityType: ENTITY_TYPE,
            entityId: row.created_entity_id,
            batchId: batch.id,
            batchNo: batch.upload_batch_no,
            employeeId: null,
            lockedBy: approverUserId,
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

export async function rejectLeaveBatch(
  batch: BatchRecord,
  approverUserId: string,
  remarks: string,
): Promise<ApplyOutcome> {
  const rows = await linkedRows(batch.id);

  // Rejections only set status=rejected and write a log entry — no balance reads or
  // writes — so rows can run in parallel without race-condition risk. The parallelism
  // is still bounded: the connection pool is shared with the rest of the app, and a
  // few hundred rows released at once would drain it (see BULK_ROW_CONCURRENCY).
  const results = await mapWithConcurrency(rows, BULK_ROW_CONCURRENCY, (row) =>
    leaveService
      .reviewRequest(
        row.created_entity_id,
        {
          status: "rejected",
          remarks: `Branch Head rejected bulk upload ${batch.upload_batch_no}: ${remarks}`,
        },
        approverUserId,
      )
      .then(
        () => ({ status: "fulfilled" as const }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      ),
  );

  let applied = 0;
  let failed = 0;
  const errors: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const outcome = results[i];
    if (outcome.status === "fulfilled") {
      applied++;
    } else {
      failed++;
      const reason = outcome.reason;
      errors.push(`Row ${rows[i].row_no}: ${(reason as Error)?.message ?? String(reason)}`);
    }
  }
  return { applied, failed, errors };
}
