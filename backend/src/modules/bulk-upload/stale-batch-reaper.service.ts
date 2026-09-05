/**
 * Finds bulk-upload batches that stopped without saying so, and says so.
 *
 * THE DEFECT. bulk-approval-async.ts tracks a running import/approval in `jobMap`, an in-process
 * JavaScript Map. The batch is marked 'importing' or 'approving' IN THE DATABASE, but the only
 * thing that would ever move it out of that state lives in one Node process's memory. A deploy, a
 * pm2 restart or an OOM erases the Map, and the batch sits in a transient state forever. Even the
 * `.catch()` on the fire-and-forget call cannot help: it writes `job.status = "failed"` to a
 * JavaScript object nobody will ever read again.
 *
 * Measured on production 2026-09-05: BATCH-1788604867017 was created at 16:11:20, last touched at
 * 16:11:42, and was still 'importing' two and a half hours later with 1,246 of its 3,765 rows
 * never processed. Nothing retried it. Nothing told anyone. It was found by hand.
 *
 * WHAT THIS DOES. Marks a stalled batch 'failed' with an error_summary saying exactly where it
 * stopped and that the remaining rows are still importable. It deliberately does NOT resume the
 * work: an import that died for an unknown reason should not be restarted automatically in a loop,
 * and for approval batches the work moves people's pay. Making the stall VISIBLE is the fix —
 * "stuck forever and silent" becomes "failed, with a row count and a next step".
 *
 * Safe because the rows are untouched: staged rows stay 'valid', already-imported rows stay
 * 'imported', and loadStagedRows() only ever picks up the former. Re-running the import continues
 * from where it stopped rather than duplicating anything.
 */

import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * States only ever held WHILE a process is actively working. A batch in one of these with no
 * progress is, by definition, a batch whose worker is gone — there is no legitimate way to sit
 * here idle.
 */
export const TRANSIENT_BATCH_STATUSES = ["importing", "approving", "validating", "rejecting"] as const;

/**
 * How long with no progress before a batch is declared stalled.
 *
 * `updated_at` moves as rows are processed, so this measures silence, not total runtime — a long
 * import that is still working is never reaped. Generous because the per-row engine is slow
 * (~8 queries per row) and a big batch can legitimately go quiet for a while under pool
 * contention; the failure being caught here lasts forever, so a few extra minutes cost nothing.
 */
export const STALL_MINUTES = 30;

export interface StalledBatch {
  id: string;
  uploadBatchNo: string;
  uploadTypeCode: string;
  status: string;
  totalRows: number;
  importedRows: number;
  remainingRows: number;
  idleMinutes: number;
}

interface StalledRow extends RowDataPacket {
  id: string;
  upload_batch_no: string;
  upload_type_code: string;
  batch_status: string;
  total_rows: number;
  imported_rows: number;
  remaining_rows: number;
  idle_minutes: number;
}

/** Batches sitting in a working state with no progress for longer than `stallMinutes`. */
export async function findStalledBatches(stallMinutes = STALL_MINUTES): Promise<StalledBatch[]> {
  const placeholders = TRANSIENT_BATCH_STATUSES.map(() => "?").join(",");
  const [rows] = await db.query<StalledRow[]>(
    `SELECT b.id, b.upload_batch_no, b.upload_type_code, b.batch_status,
            b.total_rows, b.imported_rows,
            (SELECT COUNT(*) FROM upload_batch_row r
              WHERE r.upload_batch_id = b.id AND r.row_status IN ('valid','pending')) remaining_rows,
            TIMESTAMPDIFF(MINUTE, b.updated_at, NOW()) idle_minutes
       FROM upload_batch b
      WHERE b.batch_status IN (${placeholders})
        AND b.updated_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)
      ORDER BY b.updated_at ASC`,
    [...TRANSIENT_BATCH_STATUSES, stallMinutes],
  );

  return rows.map((r) => ({
    id: String(r.id),
    uploadBatchNo: String(r.upload_batch_no),
    uploadTypeCode: String(r.upload_type_code),
    status: String(r.batch_status),
    totalRows: Number(r.total_rows ?? 0),
    importedRows: Number(r.imported_rows ?? 0),
    remainingRows: Number(r.remaining_rows ?? 0),
    idleMinutes: Number(r.idle_minutes ?? 0),
  }));
}

/**
 * The message a user sees. It has to answer "what happened, and what do I do now" — the previous
 * behaviour answered neither, because there was no message at all.
 */
export function stallSummary(b: StalledBatch): string {
  return (
    `Import stopped without completing. The job tracking it was lost — most likely a server ` +
    `restart while it was running — so the batch stayed '${b.status}' with nothing left to ` +
    `finish it. ${b.remainingRows} of ${b.totalRows} row(s) were never processed; rows already ` +
    `imported are unaffected and will not be duplicated. No progress for ${b.idleMinutes} ` +
    `minute(s). Re-run the import to continue from where it stopped.`
  );
}

/**
 * Mark a stalled batch failed. Guarded on the status it was found in, so a batch that came back
 * to life between the scan and the write is left alone.
 */
export async function markBatchStalled(b: StalledBatch): Promise<boolean> {
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE upload_batch
        SET batch_status = 'failed', error_summary = ?, updated_at = NOW()
      WHERE id = ? AND batch_status = ?`,
    [stallSummary(b), b.id, b.status],
  );
  return res.affectedRows > 0;
}

export interface ReapResult {
  scanned: number;
  marked: number;
  batches: StalledBatch[];
}

export async function reapStalledBatches(stallMinutes = STALL_MINUTES): Promise<ReapResult> {
  const stalled = await findStalledBatches(stallMinutes);
  let marked = 0;
  for (const b of stalled) {
    if (await markBatchStalled(b)) marked += 1;
  }
  return { scanned: stalled.length, marked, batches: stalled };
}
