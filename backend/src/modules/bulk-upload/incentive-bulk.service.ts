/**
 * Incentive — bulk upload.
 *
 * Rows land in `incentive_upload_batch` + `incentive_upload_line`, the same tables the
 * Incentives screen writes, held at status='pending_approval'.
 *
 * That status is load-bearing. payrollCalculate.service.ts §5f pays an employee the
 * sum of incentive_upload_line where the parent batch status is 'approved' or
 * 'applied' for the pay month — so an uploaded incentive reaches a payslip the moment
 * the batch flips to 'approved', with no further action. Holding it at
 * 'pending_approval' until the branch head decides is therefore the gate itself, not
 * a cosmetic state.
 *
 * incentive_upload_batch is keyed to a single incentive_id, so a file mixing PERF and
 * NSA produces one incentive batch per code, all owned by the one upload_batch the
 * branch head approves.
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

export const ENTITY_TYPE = "incentive_upload_line";

interface IncentiveMasterRow extends RowDataPacket {
  id: string;
  incentive_code: string;
}

async function loadIncentiveMasters(): Promise<Map<string, IncentiveMasterRow>> {
  const [rows] = await db.execute<IncentiveMasterRow[]>(
    "SELECT id, incentive_code FROM incentive_master WHERE active_status = 1",
  );
  const map = new Map<string, IncentiveMasterRow>();
  for (const r of rows as IncentiveMasterRow[]) {
    map.set(String(r.incentive_code).trim().toUpperCase(), r);
  }
  return map;
}

export async function importIncentiveBatch(
  batchId: string,
  userId: string,
): Promise<ImportOutcome> {
  const rows = await loadStagedRows(batchId);
  if (rows.length === 0) throw new BulkUploadError("This batch has no rows left to import.", 400);

  const employees = await resolveEmployees(rows.map((r) => r.data.employee_code ?? ""));
  const masters = await loadIncentiveMasters();
  const errors: string[] = [];
  let staged = 0;
  let failed = 0;

  const matched = rows
    .map((r) => employees.get((r.data.employee_code ?? "").toUpperCase()))
    .filter(Boolean) as NonNullable<ReturnType<typeof employees.get>>[];
  const { branchId, error: branchError } = resolveSingleBranch(matched);
  if (branchError) throw new BulkUploadError(branchError, 400);

  // One incentive_upload_batch per (incentive code, pay month) present in the file.
  const incentiveBatches = new Map<string, string>();
  async function incentiveBatchFor(
    master: IncentiveMasterRow,
    payMonth: string,
    uploadBatchNo: string,
  ): Promise<string> {
    const key = `${master.id}::${payMonth}`;
    const existing = incentiveBatches.get(key);
    if (existing) return existing;
    const id = randomUUID();
    await db.execute(
      // pay_month is a STORED GENERATED column mirroring salary_month, so it must NOT
      // appear in the column list — MySQL rejects the whole INSERT if it does. Setting
      // salary_month is what makes payrollCalculate's `ibu.pay_month = ?` match.
      `INSERT INTO incentive_upload_batch
         (id, incentive_id, batch_ref, salary_month, uploaded_by, branch_id,
          total_employees, total_amount, status, current_approval_step, remarks)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'pending_approval', 1, ?)`,
      [
        id, master.id, `${uploadBatchNo}-${master.incentive_code}`, payMonth,
        userId, branchId,
        `Created by bulk upload ${uploadBatchNo}; awaiting Branch Head approval`,
      ],
    );
    incentiveBatches.set(key, id);
    return id;
  }

  const uploadBatchNo = await (async () => {
    const [r] = await db.execute<RowDataPacket[]>(
      "SELECT upload_batch_no FROM upload_batch WHERE id = ? LIMIT 1", [batchId],
    );
    return String((r as RowDataPacket[])[0]?.upload_batch_no ?? batchId);
  })();

  for (const row of rows) {
    const d = row.data;
    const emp = employees.get((d.employee_code ?? "").toUpperCase());
    const code = (d.incentive_code ?? "").trim().toUpperCase();
    const master = masters.get(code);
    const amount = Number(d.amount);

    let validationError: string | null = null;
    if (!d.employee_code) validationError = "employee_code is required";
    else if (!emp) validationError = `employee_code "${d.employee_code}" not found or not active`;
    else if (!code) validationError = "incentive_code is required";
    else if (!master) {
      validationError =
        `incentive_code "${d.incentive_code}" is not an active incentive_master code — ` +
        `valid codes are ${[...masters.keys()].sort().join(", ")}`;
    } else if (!normalizeMonth(d.pay_month)) {
      validationError = `pay_month must be a month (YYYY-MM or MM-YYYY), got "${d.pay_month}"`;
    } else if (!Number.isFinite(amount) || amount <= 0) {
      validationError = `amount must be a number greater than 0 (got "${d.amount}")`;
    }

    if (!validationError) d.pay_month = normalizeMonth(d.pay_month) as string;

    if (validationError || !emp || !master) {
      const msg = `Row ${row.rowNo} (${d.employee_code || "no code"}): ${validationError}`;
      errors.push(msg);
      await markRowFailed(row.rowId, msg);
      failed++;
      continue;
    }

    try {
      const incentiveBatchId = await incentiveBatchFor(master, d.pay_month, uploadBatchNo);
      const lineId = randomUUID();
      await db.execute(
        `INSERT INTO incentive_upload_line
           (id, batch_id, employee_id, employee_code, incentive_code, amount, remarks,
            validation_status, branch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ok', ?)`,
        [
          lineId, incentiveBatchId, emp.id, emp.employee_code, master.incentive_code,
          amount, d.remarks || null, emp.branch_id,
        ],
      );
      await linkRowToEntity(row.rowId, ENTITY_TYPE, lineId);
      staged++;
    } catch (err) {
      const msg = `Row ${row.rowNo} (${d.employee_code}): ${(err as Error)?.message ?? String(err)}`;
      errors.push(msg);
      await markRowFailed(row.rowId, msg);
      failed++;
    }
  }

  // Roll the per-batch totals up from the lines actually written, so the header can
  // never disagree with its own detail.
  for (const incentiveBatchId of incentiveBatches.values()) {
    await db.execute(
      `UPDATE incentive_upload_batch ib
          SET ib.total_employees = (
                SELECT COUNT(DISTINCT employee_id) FROM incentive_upload_line WHERE batch_id = ib.id),
              ib.total_amount = (
                SELECT COALESCE(SUM(amount), 0) FROM incentive_upload_line WHERE batch_id = ib.id),
              ib.updated_at = NOW()
        WHERE ib.id = ?`,
      [incentiveBatchId],
    );
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

/** The incentive batches this upload created, found through its own lines. */
async function incentiveBatchIds(uploadBatchId: string): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT iul.batch_id
       FROM upload_batch_row ubr
       JOIN incentive_upload_line iul ON iul.id = ubr.created_entity_id
      WHERE ubr.upload_batch_id = ? AND ubr.created_entity_type = ?`,
    [uploadBatchId, ENTITY_TYPE],
  );
  return (rows as RowDataPacket[]).map((r) => String(r.batch_id));
}

export async function applyIncentiveBatch(
  batch: BatchRecord,
  approverUserId: string,
  remarks: string | null,
): Promise<ApplyOutcome> {
  const incentiveBatches = await incentiveBatchIds(batch.id);
  const rows = await linkedRows(batch.id);
  const errors: string[] = [];
  let applied = 0;
  let failed = 0;

  for (const incentiveBatchId of incentiveBatches) {
    try {
      const [res] = await db.execute<ResultSetHeader>(
        `UPDATE incentive_upload_batch
            SET status = 'approved', updated_at = NOW()
          WHERE id = ? AND status = 'pending_approval'`,
        [incentiveBatchId],
      );
      if (res.affectedRows === 0) {
        throw new Error("incentive batch is no longer pending approval");
      }
      // The approval step row the Incentives screen reads, so a bulk-approved batch
      // shows the same chain history as one approved through that screen.
      await db.execute(
        // actioned_by is STORED GENERATED from approver_user_id — naming it in the
        // column list makes MySQL reject the INSERT outright.
        `INSERT INTO incentive_approval_step
           (id, batch_id, step_number, required_role, approver_user_id, status, remarks,
            decided_at, actioned_at)
         VALUES (?, ?, 1, 'branch_head', ?, 'approved', ?, NOW(), NOW())`,
        [
          randomUUID(), incentiveBatchId, approverUserId,
          remarks ?? `Branch Head bulk approval (${batch.upload_batch_no})`,
        ],
      );
      void logSensitiveAction({
        actor_user_id: approverUserId,
        actor_role: "branch_head",
        action_type: "INCENTIVE_BATCH_APPROVED",
        module_key: "incentives",
        entity_type: "incentive_upload_batch",
        entity_id: incentiveBatchId,
        reason: remarks ?? undefined,
        new_value_json: { via_bulk_upload: true, upload_batch_no: batch.upload_batch_no },
      });
    } catch (err) {
      errors.push(`Incentive batch ${incentiveBatchId}: ${(err as Error)?.message ?? String(err)}`);
      failed++;
    }
  }

  for (const row of rows) {
    await lockEntity({
      entityType: ENTITY_TYPE,
      entityId: row.created_entity_id,
      batchId: batch.id,
      batchNo: batch.upload_batch_no,
      employeeId: null,
      lockedBy: approverUserId,
    });
    applied++;
  }

  return { applied, failed, errors };
}

export async function rejectIncentiveBatch(
  batch: BatchRecord,
  approverUserId: string,
  remarks: string,
): Promise<ApplyOutcome> {
  const incentiveBatches = await incentiveBatchIds(batch.id);
  const errors: string[] = [];
  let applied = 0;
  let failed = 0;

  for (const incentiveBatchId of incentiveBatches) {
    try {
      await db.execute(
        `UPDATE incentive_upload_batch
            SET status = 'rejected', remarks = ?, updated_at = NOW()
          WHERE id = ? AND status = 'pending_approval'`,
        [`Branch Head rejected bulk upload ${batch.upload_batch_no}: ${remarks}`, incentiveBatchId],
      );
      await db.execute(
        `INSERT INTO incentive_approval_step
           (id, batch_id, step_number, required_role, approver_user_id, status, remarks,
            decided_at, actioned_at)
         VALUES (?, ?, 1, 'branch_head', ?, 'rejected', ?, NOW(), NOW())`,
        [randomUUID(), incentiveBatchId, approverUserId, remarks],
      );
      void logSensitiveAction({
        actor_user_id: approverUserId,
        actor_role: "branch_head",
        action_type: "INCENTIVE_BATCH_REJECTED",
        module_key: "incentives",
        entity_type: "incentive_upload_batch",
        entity_id: incentiveBatchId,
        reason: remarks,
        new_value_json: { upload_batch_no: batch.upload_batch_no },
      });
      applied++;
    } catch (err) {
      errors.push(`Incentive batch ${incentiveBatchId}: ${(err as Error)?.message ?? String(err)}`);
      failed++;
    }
  }

  return { applied, failed, errors };
}
