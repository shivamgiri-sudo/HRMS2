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
  markRowFailed, markPendingApproval, lockEntities, BulkUploadError, normalizeMonth,
  type ImportOutcome, type ApplyOutcome, type BatchRecord,
} from "./bulk-approval.service.js";
import { withBulkLockRetry } from "./lock-retry.js";
import { mapWithConcurrency, BULK_ROW_CONCURRENCY } from "./batch-job.js";

export const ENTITY_TYPE = "incentive_upload_line";

interface IncentiveMasterRow extends RowDataPacket {
  id: string;
  incentive_code: string;
  incentive_name: string;
}

async function loadIncentiveMasters(): Promise<Map<string, IncentiveMasterRow>> {
  const [rows] = await db.execute<IncentiveMasterRow[]>(
    "SELECT id, incentive_code, incentive_name FROM incentive_master WHERE active_status = 1",
  );
  const map = new Map<string, IncentiveMasterRow>();
  for (const r of rows as IncentiveMasterRow[]) {
    map.set(String(r.incentive_code).trim().toUpperCase(), r);
    // Also index by full name so uploaders can use either the code or the display name
    const nameKey = String(r.incentive_name).trim().toUpperCase();
    if (nameKey && !map.has(nameKey)) map.set(nameKey, r);
  }
  return map;
}

export async function importIncentiveBatch(
  batchId: string,
  userId: string,
): Promise<ImportOutcome> {
  const rows = await loadStagedRows(batchId);
  if (rows.length === 0) throw new BulkUploadError("This batch has no rows left to import.", 400);

  const employees = await resolveEmployees(rows.map((r) => r.data.employee_code ?? ""), { includeInactive: true });
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

  // Pass A — validation, sequential and cheap (pure JS; the only DB call is the rare,
  // Map-deduplicated incentive-batch-header INSERT). Same-file duplicates are caught
  // here too, in memory via `seenKeys`, BEFORE the batched cross-batch check below —
  // two rows sharing a key both reading "not found" out of one shared query result
  // could otherwise both survive, creating a real duplicate line that never existed
  // when this loop ran one row (and one duplicate SELECT) at a time.
  interface Candidate {
    row: (typeof rows)[number];
    emp: NonNullable<ReturnType<typeof employees.get>>;
    master: IncentiveMasterRow;
    amount: number;
    payMonth: string;
  }
  const candidates: Candidate[] = [];
  const seenKeys = new Set<string>();

  for (const row of rows) {
    const d = row.data;
    const emp = employees.get((d.employee_code ?? "").toUpperCase());
    // Accept incentive_code by code OR by full incentive_name (case-insensitive)
    const codeOrName = (d.incentive_code ?? "").trim().toUpperCase();
    const master = masters.get(codeOrName);
    const amount = Number(d.amount);

    let validationError: string | null = null;
    if (!d.employee_code) validationError = "employee_code is required";
    else if (!emp) validationError = `employee_code "${d.employee_code}" is not in the employee master`;
    else if (!codeOrName) validationError = "incentive_code is required";
    else if (!master) {
      const uniqueCodes = [...new Set([...masters.values()].map((m) => m.incentive_code))].sort();
      validationError =
        `incentive_code "${d.incentive_code}" is not an active incentive code or name — ` +
        `valid codes are ${uniqueCodes.join(", ")}`;
    } else if (!normalizeMonth(d.pay_month)) {
      validationError = `pay_month must be a month (YYYY-MM or MM-YYYY), got "${d.pay_month}"`;
    } else if (!Number.isFinite(amount) || amount <= 0) {
      validationError = `amount must be a number greater than 0 (got "${d.amount}")`;
    }

    if (!validationError) d.pay_month = normalizeMonth(d.pay_month) as string;

    if (!validationError && emp && master) {
      const key = `${emp.id}::${master.id}::${d.pay_month}`;
      if (seenKeys.has(key)) {
        validationError = `Duplicate: ${d.incentive_code} for ${d.employee_code} in ${d.pay_month} appears more than once in this file`;
      } else {
        seenKeys.add(key);
      }
    }

    if (validationError || !emp || !master) {
      const msg = `Row ${row.rowNo} (${d.employee_code || "no code"}): ${validationError}`;
      errors.push(msg);
      await markRowFailed(row.rowId, msg);
      failed++;
      continue;
    }

    candidates.push({ row, emp, master, amount, payMonth: d.pay_month });
  }

  // One batched cross-batch duplicate check instead of one SELECT per row: fetch every
  // (employee, incentive, month) triple already staged/approved for the employees and
  // months this file actually touches, then match each candidate against it in memory.
  // Chunked on employee_id at 500 in case a single file spans that many distinct
  // employees. This is what turns N duplicate-check round trips into 1 (or a handful).
  const existingKeys = new Set<string>();
  const distinctEmployeeIds = [...new Set(candidates.map((c) => c.emp.id))];
  const distinctMonths = [...new Set(candidates.map((c) => c.payMonth))];
  const EMP_CHUNK = 500;
  for (let i = 0; i < distinctEmployeeIds.length; i += EMP_CHUNK) {
    const empSlice = distinctEmployeeIds.slice(i, i + EMP_CHUNK);
    const [existingRows] = await db.execute<RowDataPacket[]>(
      `SELECT iul.employee_id, iub.incentive_id, iub.salary_month
         FROM incentive_upload_line iul
         JOIN incentive_upload_batch iub ON iub.id = iul.batch_id
        WHERE iub.status NOT IN ('rejected','inactive')
          AND iul.employee_id IN (${empSlice.map(() => "?").join(",")})
          AND iub.salary_month IN (${distinctMonths.map(() => "?").join(",")})`,
      [...empSlice, ...distinctMonths],
    );
    for (const r of existingRows as RowDataPacket[]) {
      existingKeys.add(`${r.employee_id}::${r.incentive_id}::${r.salary_month}`);
    }
  }

  interface ReadyRow {
    row: (typeof rows)[number];
    emp: NonNullable<ReturnType<typeof employees.get>>;
    master: IncentiveMasterRow;
    amount: number;
    payMonth: string;
    incentiveBatchId: string;
    lineId: string;
  }
  const ready: ReadyRow[] = [];
  for (const { row, emp, master, amount, payMonth } of candidates) {
    const d = row.data;
    if (existingKeys.has(`${emp.id}::${master.id}::${payMonth}`)) {
      const msg =
        `Row ${row.rowNo} (${d.employee_code}): Duplicate: ${d.incentive_code} for ${d.employee_code} ` +
        `in ${payMonth} already exists in a pending/approved batch`;
      errors.push(msg);
      await markRowFailed(row.rowId, msg);
      failed++;
      continue;
    }
    const incentiveBatchId = await incentiveBatchFor(master, payMonth, uploadBatchNo);
    ready.push({ row, emp, master, amount, payMonth, incentiveBatchId, lineId: randomUUID() });
  }

  // Pass B — the actual writes, chunked at 500 rows per statement rather than one
  // statement per row (same trip-per-chunk trick used for employee/branch/etc. master
  // imports, and for lockEntities on the approval side of this very file). Chunks run
  // BULK_ROW_CONCURRENCY at a time; safe because every row's key is unique after Pass
  // A's dedup, so no two chunks ever touch the same incentive_upload_line row.
  const INSERT_CHUNK = 500;
  const chunks: ReadyRow[][] = [];
  for (let i = 0; i < ready.length; i += INSERT_CHUNK) chunks.push(ready.slice(i, i + INSERT_CHUNK));

  const insertLineSql = (placeholders: string) => `
    INSERT INTO incentive_upload_line
       (id, batch_id, employee_id, employee_code, incentive_code, amount, remarks,
        validation_status, branch_id)
     VALUES ${placeholders}`;
  const lineParams = (r: ReadyRow) => [
    r.lineId, r.incentiveBatchId, r.emp.id, r.emp.employee_code, r.master.incentive_code,
    r.amount, r.row.data.remarks || null, r.emp.branch_id,
  ];

  await mapWithConcurrency(chunks, BULK_ROW_CONCURRENCY, async (chunkRows) => {
    try {
      // One INSERT for the whole chunk...
      await db.execute(
        insertLineSql(chunkRows.map(() => "(?, ?, ?, ?, ?, ?, ?, 'ok', ?)").join(", ")),
        chunkRows.flatMap(lineParams),
      );
      // ...then one UPDATE to link every row in it back to its line, instead of
      // linkRowToEntity's per-row UPDATE run once per row.
      const cases = chunkRows.map(() => "WHEN ? THEN ?").join(" ");
      const caseParams = chunkRows.flatMap((r) => [r.row.rowId, r.lineId]);
      const ids = chunkRows.map((r) => r.row.rowId);
      await db.execute(
        `UPDATE upload_batch_row
            SET created_entity_type = ?, created_entity_id = CASE id ${cases} END, row_status = 'imported'
          WHERE id IN (${ids.map(() => "?").join(",")})`,
        [ENTITY_TYPE, ...caseParams, ...ids],
      );
      staged += chunkRows.length;
    } catch {
      // The chunk's batched INSERT failed — a constraint violation on one of its rows
      // is the likely cause, not a problem with the other 499. Retry this chunk only,
      // one row at a time, exactly like the pre-batching code did, so only the
      // genuinely bad row ends up marked as an error (employee-master-bulk.service.ts
      // uses the same fallback for the same reason).
      for (const r of chunkRows) {
        const d = r.row.data;
        try {
          await db.execute(insertLineSql("(?, ?, ?, ?, ?, ?, ?, 'ok', ?)"), lineParams(r));
          await linkRowToEntity(r.row.rowId, ENTITY_TYPE, r.lineId);
          staged++;
        } catch (err) {
          const msg = `Row ${r.row.rowNo} (${d.employee_code}): ${(err as Error)?.message ?? String(err)}`;
          errors.push(msg);
          await markRowFailed(r.row.rowId, msg);
          failed++;
        }
      }
    }
  });

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

  // Audit: record that this upload was staged, even if later rejected
  for (const incentiveBatchId of incentiveBatches.values()) {
    void logSensitiveAction({
      actor_user_id: userId,
      action_type: "INCENTIVE_BATCH_UPLOADED",
      module_key: "incentives",
      entity_type: "incentive_upload_batch",
      entity_id: incentiveBatchId,
      new_value_json: { upload_batch_id: batchId, staged, failed, branch_id: branchId },
    });
  }

  return { staged, failed, branchId, errors };
}

interface LinkedRow extends RowDataPacket {
  id: string;
  row_no: number;
  created_entity_id: string;
}

/**
 * The rows this batch still intends to apply.
 *
 * `row_status <> 'discarded'` matters: an approver can drop individual employees out of
 * a pending batch, and a discarded row's domain record is already gone (incentive line
 * deleted) or already deactivated (deduction set inactive). Without this filter the apply
 * pass still walked those rows — writing a lock for a line that no longer exists, and
 * counting a deliberate discard as a FAILURE, which flipped an otherwise clean batch to
 * 'partially_applied' and told the uploader rows had failed when none had.
 */
async function linkedRows(batchId: string): Promise<LinkedRow[]> {
  const [rows] = await db.execute<LinkedRow[]>(
    `SELECT id, row_no, created_entity_id
       FROM upload_batch_row
      WHERE upload_batch_id = ? AND created_entity_type = ? AND created_entity_id IS NOT NULL
        AND COALESCE(row_status, '') <> 'discarded'
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
      await withBulkLockRetry(async () => {
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
      });
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

  // One statement per chunk rather than one per row. This loop is a bare INSERT with no
  // other per-row work to amortise it, so at 1,000 rows it was 1,000 sequential round trips
  // holding a pooled connection throughout - pure latency, and a long collision window
  // against any other batch touching bulk_upload_locked_entity. Same writes, same
  // idempotency, one trip per 500 rows.
  await lockEntities(
    rows.map((row) => ({
      entityType: ENTITY_TYPE,
      entityId: row.created_entity_id,
      batchId: batch.id,
      batchNo: batch.upload_batch_no,
      employeeId: null,
      lockedBy: approverUserId,
    })),
  );
  applied += rows.length;

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
