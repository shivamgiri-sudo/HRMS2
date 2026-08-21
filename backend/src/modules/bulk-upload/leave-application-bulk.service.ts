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

export const ENTITY_TYPE = "leave_request";

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

  for (const row of rows) {
    try {
      // branch_head_approved, not approved: it is the terminal approval status the
      // leave engine already recognises for branch-head decisions, and it triggers
      // the identical balance deduction and attendance write.
      await leaveService.reviewRequest(
        row.created_entity_id,
        {
          status: "branch_head_approved",
          remarks: remarks
            ? `Branch Head bulk approval (${batch.upload_batch_no}): ${remarks}`
            : `Branch Head bulk approval (${batch.upload_batch_no})`,
        },
        approverUserId,
      );
      await lockEntity({
        entityType: ENTITY_TYPE,
        entityId: row.created_entity_id,
        batchId: batch.id,
        batchNo: batch.upload_batch_no,
        employeeId: null,
        lockedBy: approverUserId,
      });
      applied++;
    } catch (err) {
      const msg = `Row ${row.row_no}: ${(err as Error)?.message ?? String(err)}`;
      errors.push(msg);
      await markRowFailed(row.id, msg);
      failed++;
    }
  }

  return { applied, failed, errors };
}

export async function rejectLeaveBatch(
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
      await leaveService.reviewRequest(
        row.created_entity_id,
        {
          status: "rejected",
          remarks: `Branch Head rejected bulk upload ${batch.upload_batch_no}: ${remarks}`,
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
