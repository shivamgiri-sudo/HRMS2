/**
 * Background job runner for the long-running bulk-upload operations.
 *
 * Why this exists: importing or approving a batch runs a domain engine once per row
 * — reviewRegularization alone is a transaction plus ~8 queries — so a 217-row
 * attendance batch takes well over a minute. Both operations used to run inside the
 * HTTP request, which meant nginx's 60s proxy_read_timeout cut the connection and the
 * approver saw a 502 Bad Gateway while the server was still happily applying rows.
 * The work had usually succeeded; only the answer was lost, and the batch was left
 * claimed in 'approving' with no way for the UI to find out what happened.
 *
 * So the request no longer waits. It claims the batch, starts the work here, and
 * returns 202 immediately; the browser polls a status endpoint until the batch
 * reaches a terminal state. Nothing about the domain work changes — the same
 * functions run in the same order — only who is waiting for them.
 *
 * The registry is in-process and that is deliberate: hrms-api runs `instances: 1,
 * exec_mode: "fork"` (ecosystem.config.cjs), so there is exactly one process to hold
 * it. Progress is NOT read from this map though — it is derived from the database
 * (see readBatchProgress), so a poll still reports the truth after a restart that
 * loses the map.
 */
import type { RowDataPacket } from "mysql2";
import { env } from "../../config/env.js";
import { db } from "../../db/mysql.js";

export type BatchJobKind = "import" | "approve" | "reject";

export interface BatchJobState {
  batchId: string;
  kind: BatchJobKind;
  phase: "running" | "done" | "failed";
  startedAt: number;
  finishedAt?: number;
  /** The payload the route used to return synchronously, once the work finishes. */
  result?: unknown;
  error?: string;
  statusCode?: number;
}

const jobs = new Map<string, BatchJobState>();

/** How long a finished job stays readable, so a slow poll still collects its result. */
const RETAIN_MS = 30 * 60 * 1000;

function sweep(): void {
  const cutoff = Date.now() - RETAIN_MS;
  for (const [key, job] of jobs) {
    if (job.phase !== "running" && (job.finishedAt ?? 0) < cutoff) jobs.delete(key);
  }
}

export function getBatchJob(batchId: string): BatchJobState | null {
  sweep();
  return jobs.get(batchId) ?? null;
}

/**
 * Run `work` detached from the request that started it.
 *
 * `onFailure` is where the caller undoes its claim — the request has already been
 * answered by the time this runs, so a throw cannot travel back up to Express and
 * would otherwise become an unhandled rejection.
 */
export function startBatchJob(
  batchId: string,
  kind: BatchJobKind,
  work: () => Promise<unknown>,
  onFailure?: (err: unknown) => Promise<void>,
): BatchJobState {
  sweep();
  const job: BatchJobState = { batchId, kind, phase: "running", startedAt: Date.now() };
  jobs.set(batchId, job);

  void (async () => {
    try {
      job.result = await work();
      job.phase = "done";
    } catch (err) {
      job.phase = "failed";
      job.error = (err as Error)?.message ?? String(err);
      job.statusCode = Number((err as { statusCode?: unknown })?.statusCode ?? 0) || 500;
      if (onFailure) {
        await onFailure(err).catch(() => { /* the original error is what matters */ });
      }
    } finally {
      job.finishedAt = Date.now();
    }
  })();

  return job;
}

export interface BatchProgress {
  /** Rows the operation has to get through, or null when it cannot be counted. */
  total: number | null;
  /** Rows finished either way, or null for an operation with no per-row trace. */
  processed: number | null;
  succeeded: number | null;
  failed: number | null;
}

/**
 * Live progress, read from the database rather than from the job map.
 *
 * Import: every row starts 'valid'/'pending' and is moved to 'imported' or 'error'
 * as it is handled, so the rows that have left the starting states are the rows done.
 *
 * Approve: rows are already 'imported' when the approval starts, so the same trick
 * does not work. Each applied row instead gets a bulk_upload_locked_entity row (that
 * is what makes it immutable), and a failed one is flipped to 'error' — between them
 * they count the work.
 *
 * Reject writes neither, so it reports an indeterminate progress rather than a wrong
 * one. Rejections do not carry the attendance/balance writes that make an approval
 * slow, so there is little to report anyway.
 */
export async function readBatchProgress(
  batchId: string,
  kind: BatchJobKind,
): Promise<BatchProgress> {
  if (kind === "import") {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*)                                                        AS total,
         SUM(row_status IN ('imported'))                                 AS succeeded,
         SUM(row_status IN ('error','failed'))                           AS failed
       FROM upload_batch_row
       WHERE upload_batch_id = ?`,
      [batchId],
    );
    const r = (rows as RowDataPacket[])[0] ?? {};
    const succeeded = Number(r.succeeded ?? 0);
    const failed = Number(r.failed ?? 0);
    return { total: Number(r.total ?? 0), processed: succeeded + failed, succeeded, failed };
  }

  if (kind === "approve") {
    // ONE query, not two. This used to read `total`/`failed` from upload_batch_row and
    // `succeeded` from bulk_upload_locked_entity in two separate round trips — while a
    // few hundred rows are being locked concurrently in the background, a poll landing
    // between those two reads could catch `succeeded` computed a moment later than
    // `total`, and briefly report more rows done than exist (live example: "Applying
    // 165 of 148 rows…"). A LEFT JOIN makes both counts come from the same read.
    let rows: RowDataPacket[];
    try {
      [rows] = await db.execute<RowDataPacket[]>(
        `SELECT
           COUNT(*)                              AS total,
           SUM(ubr.row_status IN ('error','failed')) AS failed,
           SUM(ble.id IS NOT NULL)                AS succeeded
         FROM upload_batch_row ubr
         LEFT JOIN bulk_upload_locked_entity ble
           ON ble.upload_batch_id = ubr.upload_batch_id AND ble.entity_id = ubr.created_entity_id
         WHERE ubr.upload_batch_id = ? AND ubr.created_entity_id IS NOT NULL`,
        [batchId],
      );
    } catch (err: unknown) {
      // The lock table arrives with migration 1522; before it is applied there is
      // simply no applied-count to report, which is not a reason to fail the poll.
      if (String((err as { code?: unknown })?.code ?? "") !== "ER_NO_SUCH_TABLE") throw err;
      [rows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total, SUM(row_status IN ('error','failed')) AS failed
           FROM upload_batch_row WHERE upload_batch_id = ? AND created_entity_id IS NOT NULL`,
        [batchId],
      );
    }
    const r = (rows as RowDataPacket[])[0] ?? {};
    const total = Number(r.total ?? 0);
    const failed = Number(r.failed ?? 0);
    const succeeded = Number(r.succeeded ?? 0);
    // Belt and suspenders: processed can never exceed total, whatever the numbers say.
    return { total, processed: Math.min(succeeded + failed, total), succeeded, failed };
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM upload_batch_row
      WHERE upload_batch_id = ? AND created_entity_id IS NOT NULL`,
    [batchId],
  );
  return {
    total: Number((rows as RowDataPacket[])[0]?.total ?? 0),
    processed: null,
    succeeded: null,
    failed: null,
  };
}

/**
 * How many rows may be in flight against MySQL at once.
 *
 * An unbounded `Promise.all` over a 217-employee batch would ask for 217 connections at
 * once, exhaust the pool and then overflow `queueLimit` — turning a slow approval into a
 * failed one for everybody using the app at that moment. So this is bounded. The only
 * question is where the bound goes, and it must be derived rather than written down:
 *
 * `env.ts` defaults `DB_POOL_MAX` to 25, but the deployed `backend/.env` sets it to **10**
 * (verified 2026-09-02). A constant chosen against the 25 that appears in the source is
 * therefore sized against a pool that does not exist in production — it would let a single
 * batch hold most of the real pool while live user requests queue behind it, which is the
 * contention this bound exists to prevent. Reading `env.DB_POOL_MAX` keeps the two in step
 * no matter what any environment sets.
 *
 * Divided by three, not used whole, because a row is not one connection:
 * `leaveService.submitRequest` takes a second pooled connection for its `GET_LOCK` while it
 * runs, so the true in-flight count is up to 2x this number. At the live pool of 10 that is
 * 3 groups → up to 6 connections, leaving 4 for everyone else; at the 25 of the default it
 * lands on the 6 this constant used to hard-code. Floor of 2 so a small pool still overlaps
 * at all; ceiling of 6 because beyond that the limit stops being the bottleneck and row-lock
 * contention starts to be — and contention is what was failing these batches, not throughput.
 */
export const BULK_ROW_CONCURRENCY = Math.max(2, Math.min(6, Math.floor(env.DB_POOL_MAX / 3)));

/** Run `task` over `items` with at most `limit` in flight, results in input order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
