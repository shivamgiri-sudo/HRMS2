/**
 * Payroll Deduction — bulk upload.
 *
 * Rows land in `employee_deduction_entries`, the same table the manual deduction
 * entry writes — but with status='pending_approval' rather than 'active'.
 *
 * That distinction is the whole safety property: payrollCalculate.service.ts filters
 * `ede.status = 'active'` when it pulls custom deductions, so a pending row is
 * invisible to payroll no matter when a run happens. Branch head approval flips it to
 * 'active' — the exact state a manually entered deduction is born in — and only then
 * can it reach a payslip. No salary arithmetic is touched anywhere in this file.
 *
 * This is the one of the four domains that had no pending state at all before
 * migration 1522; the other three already modelled approval natively.
 */
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { logSensitiveAction } from "../../shared/auditLog.js";
import {
  loadStagedRows, resolveEmployees, resolveSingleBranch, linkRowToEntity,
  markRowFailed, markPendingApproval, lockEntity, BulkUploadError, normalizeMonth,
  type ImportOutcome, type ApplyOutcome, type BatchRecord,
} from "./bulk-approval.service.js";
import { withBulkLockRetry } from "./lock-retry.js";
import { mapWithConcurrency, BULK_ROW_CONCURRENCY } from "./batch-job.js";

export const ENTITY_TYPE = "employee_deduction_entries";

async function loadDeductionTypes(): Promise<Set<string>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT deduction_code FROM payroll_deduction_type WHERE active_status = 1",
  );
  return new Set((rows as RowDataPacket[]).map((r) => String(r.deduction_code).trim().toUpperCase()));
}

export async function importDeductionBatch(
  batchId: string,
  userId: string,
): Promise<ImportOutcome> {
  const rows = await loadStagedRows(batchId);
  if (rows.length === 0) throw new BulkUploadError("This batch has no rows left to import.", 400);

  const employees = await resolveEmployees(rows.map((r) => r.data.employee_code ?? ""));
  const types = await loadDeductionTypes();
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
    const typeCode = (d.deduction_type_code ?? "").trim().toUpperCase();
    const amount = Number(d.amount);

    let validationError: string | null = null;
    if (!d.employee_code) validationError = "employee_code is required";
    else if (!emp) validationError = `employee_code "${d.employee_code}" not found or not active`;
    else if (!typeCode) validationError = "deduction_type_code is required";
    else if (!types.has(typeCode)) {
      validationError =
        `deduction_type_code "${d.deduction_type_code}" is not an active payroll_deduction_type — ` +
        `valid codes are ${[...types].sort().join(", ")}`;
    } else if (!normalizeMonth(d.run_month)) {
      // run_month is VARCHAR(7), never a DATE. A value in any other shape does not
      // error — it simply matches no payroll run, silently.
      validationError = `run_month must be a month (YYYY-MM or MM-YYYY), got "${d.run_month}"`;
    } else if (!Number.isFinite(amount) || amount <= 0) {
      validationError = `amount must be a number greater than 0 (got "${d.amount}")`;
    } else if (!d.description || d.description.trim().length < 5) {
      validationError = "description is required and must be at least 5 characters";
    }

    if (!validationError) d.run_month = normalizeMonth(d.run_month) as string;

    // Duplicate guard: same employee + deduction code + run month already active/pending
    if (!validationError && emp) {
      const [dupRows] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM employee_deduction_entries
          WHERE employee_id = ? AND deduction_type_code = ? AND run_month = ?
            AND status NOT IN ('inactive','rejected')
          LIMIT 1`,
        [emp.id, typeCode, d.run_month],
      );
      if ((dupRows as RowDataPacket[]).length > 0) {
        validationError = `Duplicate: deduction ${d.deduction_type_code} for ${d.employee_code} in ${d.run_month} already exists`;
      }
    }

    if (validationError || !emp) {
      const msg = `Row ${row.rowNo} (${d.employee_code || "no code"}): ${validationError}`;
      errors.push(msg);
      await markRowFailed(row.rowId, msg);
      failed++;
      continue;
    }

    try {
      const id = randomUUID();
      await db.execute(
        `INSERT INTO employee_deduction_entries
           (id, employee_id, description, deduction_type_code, amount, is_prorated,
            run_month, status, created_by, branch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?)`,
        [
          id, emp.id, d.description.trim(), typeCode, amount,
          d.is_prorated === "1" || d.is_prorated?.toLowerCase() === "true" ? 1 : 0,
          d.run_month, userId, emp.branch_id,
        ],
      );
      await linkRowToEntity(row.rowId, ENTITY_TYPE, id);
      staged++;
    } catch (err) {
      const msg = `Row ${row.rowNo} (${d.employee_code}): ${(err as Error)?.message ?? String(err)}`;
      errors.push(msg);
      await markRowFailed(row.rowId, msg);
      failed++;
    }
  }

  await markPendingApproval(batchId, branchId, staged, failed);

  // Audit: record that this upload was staged, even if later rejected
  void logSensitiveAction({
    actor_user_id: userId,
    action_type: "DEDUCTION_BATCH_UPLOADED",
    module_key: "payroll",
    entity_type: "upload_batch",
    entity_id: batchId,
    new_value_json: { staged, failed, branch_id: branchId },
  });

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

export async function applyDeductionBatch(
  batch: BatchRecord,
  approverUserId: string,
  remarks: string | null,
): Promise<ApplyOutcome> {
  const rows = await linkedRows(batch.id);
  const errors: string[] = [];
  let applied = 0;
  let failed = 0;

  // Bounded parallelism, not a serial loop.
  //
  // Every row here is independent in a way the other gated types are not: the UPDATE is
  // addressed by primary key and guarded on `status = 'pending_approval'`, and nothing it
  // writes is read by another row of the same batch. There is no per-employee ordering to
  // preserve, so rows can be run directly rather than grouped first.
  //
  // Serially this was one round trip per row with nothing to overlap it against, which is
  // what made a large deduction batch take minutes of almost pure waiting.
  // BULK_ROW_CONCURRENCY is derived from the real pool size, so this overlaps without
  // crowding out live traffic.
  const outcomes = await mapWithConcurrency(rows, BULK_ROW_CONCURRENCY, async (row) => {
    try {
      // Guarded on the current status so a replayed approval cannot resurrect a row
      // a later action deactivated.
      await withBulkLockRetry(async () => {
        const [res] = await db.execute<ResultSetHeader>(
          `UPDATE employee_deduction_entries
              SET status = 'active', updated_at = NOW()
            WHERE id = ? AND status = 'pending_approval'`,
          [row.created_entity_id],
        );
        if (res.affectedRows === 0) {
          throw new Error("deduction entry is no longer pending approval");
        }
        await lockEntity({
          entityType: ENTITY_TYPE,
          entityId: row.created_entity_id,
          batchId: batch.id,
          batchNo: batch.upload_batch_no,
          employeeId: null,
          lockedBy: approverUserId,
        });
      });
      void logSensitiveAction({
        actor_user_id: approverUserId,
        actor_role: "branch_head",
        action_type: "DEDUCTION_APPROVED",
        module_key: "payroll",
        entity_type: ENTITY_TYPE,
        entity_id: row.created_entity_id,
        reason: remarks ?? undefined,
        old_value_json: { status: "pending_approval" },
        new_value_json: {
          status: "active",
          via_bulk_upload: true,
          upload_batch_no: batch.upload_batch_no,
        },
      });
      return { ok: true as const };
    } catch (err) {
      const msg = `Row ${row.row_no}: ${(err as Error)?.message ?? String(err)}`;
      await markRowFailed(row.id, msg);
      return { ok: false as const, msg };
    }
  });

  // Tallied after the fact rather than with counters mutated from inside the tasks, so the
  // error order follows row order regardless of the order the tasks happened to finish in.
  for (const outcome of outcomes) {
    if (outcome.ok) {
      applied++;
    } else {
      failed++;
      errors.push(outcome.msg);
    }
  }

  return { applied, failed, errors };
}

export async function rejectDeductionBatch(
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
      // 'inactive', not a DELETE: the rejected row stays visible as evidence of what
      // was proposed and refused. The reason lives in the audit log and on
      // upload_batch.approval_remarks — employee_deduction_entries has no
      // deactivate_reason column on the live schema despite one route writing to it.
      await db.execute(
        `UPDATE employee_deduction_entries
            SET status = 'inactive', updated_at = NOW()
          WHERE id = ? AND status = 'pending_approval'`,
        [row.created_entity_id],
      );
      void logSensitiveAction({
        actor_user_id: approverUserId,
        actor_role: "branch_head",
        action_type: "DEDUCTION_REJECTED",
        module_key: "payroll",
        entity_type: ENTITY_TYPE,
        entity_id: row.created_entity_id,
        reason: remarks,
        new_value_json: { status: "inactive", upload_batch_no: batch.upload_batch_no },
      });
      applied++;
    } catch (err) {
      errors.push(`Row ${row.row_no}: ${(err as Error)?.message ?? String(err)}`);
      failed++;
    }
  }

  return { applied, failed, errors };
}
