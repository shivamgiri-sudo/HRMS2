/**
 * Bulk import worker — runs inside hrms-workers, completely separate from the
 * HTTP server process.
 *
 * Flow:
 *   1. API route claims the upload_batch (batch_status = 'importing'), inserts a row
 *      into bulk_import_queue, and returns 202 immediately.
 *   2. This worker polls bulk_import_queue every POLL_MS milliseconds.
 *   3. When it finds an unclaimed row it atomically marks it claimed (claimed_at = NOW())
 *      and runs dispatchImport — the exact same function the old in-process path called.
 *   4. On success or failure the worker deletes the queue row and updates upload_batch
 *      with the terminal status, exactly as the old onFailure callback did.
 *
 * Why this is safe with a single worker instance:
 *   PM2 runs hrms-workers as instances: 1. There is exactly one poller at a time, so
 *   the claimed_at UPDATE is not racing another worker. If the process restarts, an
 *   unclaimed queue row is picked up on the next poll. A claimed row that was never
 *   deleted (crash between claim and delete) stays claimed forever — that batch's
 *   upload_batch.batch_status is still 'importing', and the stale-import reaper in the
 *   API route will eventually release it back to 'validated' so the user can retry.
 */

import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../db/mysql.js";
import { beat, clearBeat, HEARTBEAT_MS, JOB_OWNER } from "../modules/bulk-upload/batch-job.js";
import { dispatchImport } from "../modules/bulk-upload/bulk-dispatch.js";

const POLL_MS = 3_000;

interface QueueRow extends RowDataPacket {
  id: string;
  batch_id: string;
  rpc_name: string;
  user_id: string;
}

async function claimNextJob(): Promise<QueueRow | null> {
  // Attempt to claim the oldest unclaimed job atomically.
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE bulk_import_queue SET claimed_at = NOW()
     WHERE claimed_at IS NULL
     ORDER BY queued_at ASC
     LIMIT 1`,
  );
  if (result.affectedRows === 0) return null;

  const [rows] = await db.execute<QueueRow[]>(
    `SELECT id, batch_id, rpc_name, user_id
     FROM bulk_import_queue
     WHERE claimed_at IS NOT NULL AND claimed_at >= NOW() - INTERVAL 5 SECOND
     ORDER BY claimed_at DESC
     LIMIT 1`,
  );
  return (rows as QueueRow[])[0] ?? null;
}

async function deleteQueueEntry(queueId: string): Promise<void> {
  try {
    await db.execute(`DELETE FROM bulk_import_queue WHERE id = ?`, [queueId]);
  } catch {
    // Non-fatal: the batch has already reached a terminal status.
  }
}

async function processJob(job: QueueRow): Promise<void> {
  const { id: queueId, batch_id, rpc_name, user_id } = job;

  // Stamp the heartbeat and start the ticker so the reaper knows this batch is live.
  await beat(batch_id);
  const ticker = setInterval(() => { void beat(batch_id); }, HEARTBEAT_MS);
  (ticker as unknown as { unref?: () => void }).unref?.();

  // Also stamp job_owner so logs can see which process handled this batch.
  try {
    await db.execute(
      `UPDATE upload_batch SET job_owner = ? WHERE id = ?`,
      [JOB_OWNER, batch_id],
    );
  } catch { /* non-critical */ }

  try {
    await dispatchImport(rpc_name, batch_id, user_id);
    // dispatchImport sets batch_status internally (to 'imported' or 'pending_approval').
  } catch (err) {
    await db.execute(
      `UPDATE upload_batch
         SET batch_status = 'failed', approval_status = NULL,
             error_summary = ?, updated_at = NOW()
       WHERE id = ?`,
      [String((err as Error)?.message ?? "Import failed").slice(0, 1000), batch_id],
    ).catch(() => { /* ignore secondary failure */ });
  } finally {
    clearInterval(ticker);
    await clearBeat(batch_id);
    await deleteQueueEntry(queueId);
  }
}

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function poll(): Promise<void> {
  if (running) return; // previous job is still in flight
  const job = await claimNextJob().catch(() => null);
  if (!job) return;
  running = true;
  try {
    await processJob(job);
  } finally {
    running = false;
  }
}

export function startBulkImportWorker(): void {
  if (timer) return;
  timer = setInterval(() => { void poll(); }, POLL_MS);
  (timer as unknown as { unref?: () => void }).unref?.();
  console.log(`[bulk-import-worker] started (poll every ${POLL_MS}ms, owner=${JOB_OWNER})`);
}

export function stopBulkImportWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
