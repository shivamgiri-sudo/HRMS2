import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

const RUN_HOUR = 2;
/** Older than this and a 'queued' row is not in flight — it was abandoned. */
const STALE_QUEUED_HOURS = 6;
let nextRun: NodeJS.Timeout | undefined;

/**
 * Report dispatches abandoned in 'queued', without touching them.
 *
 * dispatchService inserts a dispatch_log row as 'queued', calls the provider, then
 * updates the row to 'sent' or 'failed'. Nothing anywhere scans for 'queued' — so if
 * the process dies between the insert and the update, the row stays 'queued' for good:
 * never sent, never retried, and invisible because nobody queries a status that is
 * supposed to be transient.
 *
 * It has already happened, and at more than one moment: 25 rows sit at 'queued' across
 * all three channels, the oldest from 2026-08-04, with the largest cluster at
 * 2026-08-07 03:31 when the workers process was stopped mid-dispatch to halt the mail
 * storm. Every one of the 25 is flagged is_critical = 1 — critical is precisely the
 * class that must not vanish quietly, and it is the class this gap has swallowed.
 *
 * Deliberately reports rather than resends. The row is written BEFORE the provider
 * call, so a stale 'queued' cannot distinguish "never sent" from "sent, then the
 * process died before recording it" — retrying would double-send to real people, and
 * for a financial notification that is worse than the original loss. Making it visible
 * lets a human decide; guessing does not.
 */
export async function reportStaleQueuedDispatches(): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS stuck,
            MIN(created_at) AS oldest,
            COUNT(DISTINCT channel) AS channels,
            SUM(is_critical = 1) AS critical
       FROM dispatch_log
      WHERE status = 'queued'
        AND created_at < NOW() - INTERVAL ? HOUR`,
    [STALE_QUEUED_HOURS],
  );

  const stuck = Number(rows[0]?.stuck ?? 0);
  if (stuck > 0) {
    console.warn(
      `[CommunicationCleanup] ${stuck} dispatch(es) abandoned in 'queued' for over `
      + `${STALE_QUEUED_HOURS}h (oldest ${String(rows[0]?.oldest)}, ${rows[0]?.critical ?? 0} critical). `
      + `These were never sent and nothing retries them — a process died between writing the `
      + `row and calling the provider. Not auto-resent: the row predates the provider call, so `
      + `a resend risks delivering twice.`,
    );
  }
  return stuck;
}

/**
 * The same gap on the other mail path.
 *
 * notificationGateway writes its claim to notification_log BEFORE the deliverer runs —
 * deliberately, so a crash cannot double-send. The cost is identical to dispatch_log's:
 * a process that dies in between leaves the row at 'pending' permanently, and nothing
 * scans for it. Two tables, two independent implementations, the same silent hole.
 *
 * 9 such rows exist, all SLA_BREACH candidate-waiting alerts between 2026-07-21 and
 * 2026-07-28. That path has written nothing since, so this is currently dormant rather
 * than bleeding — which is exactly why it is worth watching now: if the gateway is
 * switched on for a `fin` event, the same crash silently drops a payroll notification
 * and nobody learns of it.
 *
 * Reports only, for the same reason as above: the claim precedes delivery, so 'pending'
 * cannot prove a message went unsent.
 */
export async function reportStalePendingNotifications(): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS stuck,
            MIN(created_at) AS oldest,
            COUNT(DISTINCT template_code) AS templates
       FROM notification_log
      WHERE status = 'pending'
        AND created_at < NOW() - INTERVAL ? HOUR`,
    [STALE_QUEUED_HOURS],
  );

  const stuck = Number(rows[0]?.stuck ?? 0);
  if (stuck > 0) {
    console.warn(
      `[CommunicationCleanup] ${stuck} notification(s) abandoned in 'pending' for over `
      + `${STALE_QUEUED_HOURS}h (oldest ${String(rows[0]?.oldest)}, ${rows[0]?.templates ?? 0} template(s)). `
      + `Same shape as the dispatch_log case: the gateway claims before it delivers, so a `
      + `process death in between strands the row. Not auto-resent.`,
    );
  }
  return stuck;
}

export async function runCommunicationCleanup(): Promise<{
  routineDeleted: number;
  standardDeleted: number;
  staleQueued: number;
  stalePending: number;
}> {
  const [routineResult] = await db.execute<ResultSetHeader>(
    `DELETE FROM dispatch_log
     WHERE is_critical = 0
       AND retention_category = 'routine'
       AND sent_at < NOW() - INTERVAL 30 DAY`
  );
  const routineDeleted = routineResult.affectedRows;

  const [standardResult] = await db.execute<ResultSetHeader>(
    `DELETE FROM dispatch_log
     WHERE is_critical = 0
       AND retention_category = 'standard'
       AND sent_at < NOW() - INTERVAL 90 DAY`
  );
  const standardDeleted = standardResult.affectedRows;

  console.log(
    `[CommunicationCleanup] Deleted ${routineDeleted} routine rows (>30d), ${standardDeleted} standard rows (>90d)`
  );

  // After the deletes, so the count reflects what is actually left. Never allowed to
  // fail the cleanup: pruning old rows is the job here, reporting is the addition.
  let staleQueued = 0;
  let stalePending = 0;
  try {
    staleQueued = await reportStaleQueuedDispatches();
    stalePending = await reportStalePendingNotifications();
  } catch (error) {
    console.error("[CommunicationCleanup] stale-dispatch checks failed", error);
  }

  return { routineDeleted, standardDeleted, staleQueued, stalePending };
}

export function millisecondsUntilNextCleanup(now = new Date()): number {
  const next = new Date(now);
  next.setHours(RUN_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function startCommunicationCleanup(): void {
  if (nextRun) return;
  nextRun = setTimeout(async () => {
    try {
      await runCommunicationCleanup();
    } catch (error) {
      console.error("Failed to run communication cleanup", error);
    } finally {
      nextRun = undefined;
      startCommunicationCleanup();
    }
  }, millisecondsUntilNextCleanup());
  nextRun.unref();
}

export function stopCommunicationCleanup(): void {
  if (!nextRun) return;
  clearTimeout(nextRun);
  nextRun = undefined;
}
