/**
 * Upload-batch retention worker.
 *
 * upload_batch_row is ~18 GB (raw_data + normalized_data JSON per row) and nothing trims it. Rows of a batch
 * that has FINISHED are only needed for a short troubleshooting window; after that we keep a small snapshot
 * (counts + error breakdown, no row data) in upload_batch_snapshot and delete the rows.
 *
 * SAFETY (this deletes production data, so it is deliberately conservative):
 *  - EXECUTES by default since 2026-10-03 (owner: upload_batch_row was recreated with 7-day retention and must
 *    clean itself up). Set UPLOAD_BATCH_RETENTION_MODE=dry_run to switch deletion off; a dry run logs, per
 *    upload type, how many batches/rows WOULD go. It was dry-run-by-default while the table held ~18 GB of
 *    history nobody had reviewed; the rest of the safety list below is unchanged.
 *  - Only TERMINAL batches: imported, completed, imported_with_errors, rejected, failed, validation_failed.
 *    Never uploaded / validated / processing — a validated batch is pending import or approval and its rows are
 *    the work still to be done.
 *  - Snapshot is written first; a batch is marked purged only after its last row is gone.
 *  - Every DELETE is its own small auto-committed statement (no wrapping transaction), paced, so no long lock
 *    and no huge undo log. A run stops at a time budget and resumes the next day where it left off.
 *  - The snapshot stores no sample data rows — rows can carry salary / bank / UAN / identity data.
 *
 * Consequence to know: once a batch is purged its row-level drill-down, error-report download, import-status
 * counts and delete-batch cascade no longer have rows to read. The header (upload_batch) and everything the
 * import already wrote to the destination tables are untouched.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { logger } from "../logger.js";

export const DONE_STATUSES = ["imported", "completed", "imported_with_errors"] as const;
export const FAILED_STATUSES = ["rejected", "failed", "validation_failed"] as const;

const CHUNK_SIZE = 1000;
const PAUSE_MS = 150;
const BATCHES_PER_RUN = 200;
const RUN_BUDGET_MS = 45 * 60 * 1000;

export type RetentionMode = "dry_run" | "execute";

export function retentionMode(raw: string | undefined = process.env.UPLOAD_BATCH_RETENTION_MODE): RetentionMode {
  // Deletion is the default; only an explicit "dry_run" turns it off (see the header comment).
  return raw === "dry_run" ? "dry_run" : "execute";
}

export interface Policy {
  retain_days: number;
  retain_failed_days: number;
  enabled: number;
}

/** Policy for one upload type: its own row, else the '*' default, else built-in 7/30. */
export function resolvePolicy(type: string, policies: Map<string, Policy>): Policy {
  return policies.get(type) ?? policies.get("*") ?? { retain_days: 7, retain_failed_days: 30, enabled: 1 };
}

interface Candidate extends RowDataPacket {
  id: string;
  upload_batch_no: string;
  upload_type_code: string;
  original_file_name: string | null;
  batch_status: string;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  imported_rows: number;
  created_at: Date;
  age_days: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadPolicies(): Promise<Map<string, Policy>> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT upload_type_code, retain_days, retain_failed_days, enabled FROM upload_batch_retention_policy",
  );
  return new Map(rows.map((r) => [String(r.upload_type_code), { retain_days: Number(r.retain_days), retain_failed_days: Number(r.retain_failed_days), enabled: Number(r.enabled) }]));
}

/** Terminal batches that still have a header but no completed purge. Age is taken from the last import/update. */
async function findCandidates(limit: number): Promise<Candidate[]> {
  const statuses = [...DONE_STATUSES, ...FAILED_STATUSES];
  const [rows] = await db.query<Candidate[]>(
    `SELECT ub.id, ub.upload_batch_no, ub.upload_type_code, ub.original_file_name, ub.batch_status,
            ub.total_rows, ub.valid_rows, ub.error_rows, ub.imported_rows, ub.created_at,
            TIMESTAMPDIFF(DAY, COALESCE(ub.imported_at, ub.updated_at, ub.created_at), NOW()) AS age_days
       FROM upload_batch ub
       LEFT JOIN upload_batch_snapshot s ON s.id = ub.id
      WHERE ub.batch_status IN (?)
        AND (s.id IS NULL OR s.rows_purged_at IS NULL)
      ORDER BY ub.created_at ASC
      LIMIT ?`,
    [statuses, limit],
  );
  return rows;
}

function isDue(c: Candidate, p: Policy): boolean {
  if (!p.enabled) return false;
  const days = (FAILED_STATUSES as readonly string[]).includes(c.batch_status) ? p.retain_failed_days : p.retain_days;
  return Number(c.age_days) >= days;
}

/** Counts + error breakdown only. Never reads or stores row data. */
async function writeSnapshot(c: Candidate): Promise<void> {
  const [statusRows] = await db.query<RowDataPacket[]>(
    "SELECT row_status, COUNT(*) AS n FROM upload_batch_row WHERE upload_batch_id = ? GROUP BY row_status",
    [c.id],
  );
  const statusBreakdown: Record<string, number> = {};
  let rowsAtPurge = 0;
  for (const r of statusRows) {
    statusBreakdown[String(r.row_status ?? "unknown")] = Number(r.n);
    rowsAtPurge += Number(r.n);
  }

  const [errRows] = await db.query<RowDataPacket[]>(
    `SELECT LEFT(CAST(JSON_EXTRACT(error_messages, '$[0]') AS CHAR), 160) AS msg, COUNT(*) AS n
       FROM upload_batch_row
      WHERE upload_batch_id = ? AND error_messages IS NOT NULL AND JSON_LENGTH(error_messages) > 0
      GROUP BY msg ORDER BY n DESC LIMIT 20`,
    [c.id],
  );
  const errorBreakdown: Record<string, number> = {};
  for (const r of errRows) errorBreakdown[String(r.msg ?? "unknown")] = Number(r.n);

  const [sampleRows] = await db.query<RowDataPacket[]>(
    `SELECT row_no, LEFT(CAST(error_messages AS CHAR), 400) AS errors
       FROM upload_batch_row
      WHERE upload_batch_id = ? AND error_messages IS NOT NULL AND JSON_LENGTH(error_messages) > 0
      ORDER BY row_no LIMIT 5`,
    [c.id],
  );

  await db.execute(
    `INSERT IGNORE INTO upload_batch_snapshot
       (id, upload_batch_no, upload_type_code, original_file_name, batch_status, total_rows, valid_rows,
        error_rows, imported_rows, status_breakdown, error_breakdown, sample_errors, rows_at_purge, batch_created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      c.id, c.upload_batch_no, c.upload_type_code, c.original_file_name, c.batch_status,
      c.total_rows ?? 0, c.valid_rows ?? 0, c.error_rows ?? 0, c.imported_rows ?? 0,
      JSON.stringify(statusBreakdown), JSON.stringify(errorBreakdown), JSON.stringify(sampleRows),
      rowsAtPurge, c.created_at,
    ],
  );
}

/** Deletes one batch's rows in small auto-committed chunks. Returns rows deleted; stops early at the deadline. */
async function purgeRows(batchId: string, deadline: number): Promise<{ deleted: number; finished: boolean }> {
  let deleted = 0;
  for (;;) {
    if (Date.now() > deadline) return { deleted, finished: false };
    // CHUNK_SIZE is a module constant, inlined on purpose: a bound `LIMIT ?` in a prepared statement is rejected by
    // this MySQL ("Incorrect arguments to mysqld_stmt_execute"), which a mocked test cannot see.
    const [res] = await db.execute<import("mysql2").ResultSetHeader>(
      `DELETE FROM upload_batch_row WHERE upload_batch_id = ? LIMIT ${CHUNK_SIZE}`,
      [batchId],
    );
    deleted += res.affectedRows;
    if (res.affectedRows < CHUNK_SIZE) return { deleted, finished: true };
    await sleep(PAUSE_MS);
  }
}

export async function runUploadBatchRetention(mode: RetentionMode = retentionMode()) {
  const started = Date.now();
  const deadline = started + RUN_BUDGET_MS;
  const policies = await loadPolicies();
  const candidates = await findCandidates(BATCHES_PER_RUN);
  const due = candidates.filter((c) => isDue(c, resolvePolicy(c.upload_type_code, policies)));

  if (mode === "dry_run") {
    const byType = new Map<string, { batches: number; rows: number }>();
    for (const c of due) {
      const e = byType.get(c.upload_type_code) ?? { batches: 0, rows: 0 };
      e.batches += 1;
      e.rows += Number(c.total_rows ?? 0);
      byType.set(c.upload_type_code, e);
    }
    logger.info(
      { worker: "upload-batch-retention", mode, considered: candidates.length, due: due.length, byType: Object.fromEntries(byType) },
      "DRY RUN — nothing deleted. Unset UPLOAD_BATCH_RETENTION_MODE (or set it to execute) to purge.",
    );
    return { mode, due: due.length, batchesPurged: 0, rowsDeleted: 0 };
  }

  let batchesPurged = 0;
  let rowsDeleted = 0;
  for (const c of due) {
    if (Date.now() > deadline) break;
    try {
      await writeSnapshot(c);
      const r = await purgeRows(c.id, deadline);
      rowsDeleted += r.deleted;
      await db.execute(
        `UPDATE upload_batch_snapshot SET rows_deleted = rows_deleted + ?, rows_purged_at = IF(?, NOW(), rows_purged_at) WHERE id = ?`,
        [r.deleted, r.finished ? 1 : 0, c.id],
      );
      if (r.finished) batchesPurged += 1;
    } catch (err) {
      logger.error({ worker: "upload-batch-retention", batchNo: c.upload_batch_no, err }, "batch skipped");
    }
  }
  logger.info({ worker: "upload-batch-retention", mode, batchesPurged, rowsDeleted, ms: Date.now() - started }, "run complete");
  return { mode, due: due.length, batchesPurged, rowsDeleted };
}

let started = false;

/** Daily at 02:00. Wired from all-workers.ts; does nothing unless ENABLE_SCHEDULERS runs it. */
export function startUploadBatchRetentionCron(): void {
  if (started || process.env.NODE_ENV === "test") return;
  started = true;
  // Timer to the next 02:00, rescheduled after each run: the convention every other daily job here uses
  // (see noc-sla-reminder.worker.ts). node-cron is not a dependency of this project, so importing it broke the build.
  const msUntilTwoAm = (): number => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(2, 0, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  };
  const schedule = (): void => {
    const timer = setTimeout(() => {
      runUploadBatchRetention()
        .catch((err) => logger.error({ worker: "upload-batch-retention", err }, "scheduled run failed"))
        .finally(schedule);
    }, msUntilTwoAm());
    timer.unref?.();
  };
  schedule();
  logger.info({ worker: "upload-batch-retention", mode: retentionMode() }, "scheduled daily 02:00");
}
