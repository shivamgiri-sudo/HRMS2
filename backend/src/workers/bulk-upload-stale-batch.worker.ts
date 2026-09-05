/**
 * Stale bulk-upload batch reaper.
 *
 * bulk-approval-async.ts holds a running import's state in `jobMap`, an in-process Map. The batch
 * is marked 'importing' in the DATABASE while the thing that would finish it lives only in one
 * Node process. A restart erases the Map and the batch sits in that state forever — no retry, no
 * error, no notification. BATCH-1788604867017 sat 'importing' for two and a half hours with 1,246
 * rows unprocessed and was found by hand.
 *
 * This is the backstop, not the cure. The cure is durable job state; until that exists, an import
 * that dies should at least SAY it died. A slow import that finishes is an annoyance; one that
 * stops silently costs a day.
 *
 * Deliberately does not resume the work — an import that died for an unknown reason should not be
 * restarted in a loop unattended, and approval batches move people's pay.
 */

import { reapStalledBatches, STALL_MINUTES } from "../modules/bulk-upload/stale-batch-reaper.service.js";
import { recordWorkerRun, withWorkerLock } from "./worker-utils.js";

const WORKER_NAME = "bulk-upload-stale-batch";

/** Often enough that nobody waits half a day to learn their import died. */
const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const STARTUP_DELAY_MS = 2 * 60 * 1000;

let startupRef: ReturnType<typeof setTimeout> | undefined;
let intervalRef: ReturnType<typeof setInterval> | undefined;

async function audit(): Promise<void> {
  const r = await reapStalledBatches(STALL_MINUTES);

  if (r.scanned === 0) {
    await recordWorkerRun(WORKER_NAME, "completed", { scanned: 0, marked: 0 });
    return;
  }

  for (const b of r.batches) {
    console.error(
      `[${WORKER_NAME}] ${b.uploadBatchNo} (${b.uploadTypeCode}) stalled in '${b.status}' for ` +
        `${b.idleMinutes}min — ${b.remainingRows}/${b.totalRows} row(s) never processed. ` +
        `Marked failed; re-run the import to continue from where it stopped.`,
    );
  }
  await recordWorkerRun(WORKER_NAME, "completed", {
    scanned: r.scanned,
    marked: r.marked,
    batches: r.batches.map((b) => ({ no: b.uploadBatchNo, status: b.status, remaining: b.remainingRows })),
  });
}

async function sweep(): Promise<void> {
  try {
    await withWorkerLock(WORKER_NAME, audit);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${WORKER_NAME}] sweep failed:`, message);
    await recordWorkerRun(WORKER_NAME, "failed", { error: message });
  }
}

export function startBulkUploadStaleBatchWorker(): void {
  if (intervalRef) return;
  console.log(
    `[${WORKER_NAME}] Starting — interval: ${CHECK_INTERVAL_MS / 60000}min, ` +
      `stall threshold: ${STALL_MINUTES}min`,
  );
  startupRef = setTimeout(() => { void sweep(); }, STARTUP_DELAY_MS);
  intervalRef = setInterval(() => { void sweep(); }, CHECK_INTERVAL_MS);
}

export function stopBulkUploadStaleBatchWorker(): void {
  if (startupRef) {
    clearTimeout(startupRef);
    startupRef = undefined;
  }
  if (intervalRef) {
    clearInterval(intervalRef);
    intervalRef = undefined;
  }
  console.log(`[${WORKER_NAME}] Stopped`);
}

export { sweep as runBulkUploadStaleBatchSweep };
