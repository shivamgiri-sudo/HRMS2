import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";

/**
 * Per-subject alert throttle that survives a process restart.
 *
 * sla-breach-worker and interview-delay-alert each kept their cooldown in a
 * module-level `Map`. ecosystem.config.cjs permits 10 pm2 restarts, and every
 * restart emptied the map and re-alerted every waiting candidate — which is how
 * notification_log came to hold 18,959 SLA mails, 6,510 of them in one day.
 *
 * Backed by the `alert_cooldown` table (migration 1054), with the old in-memory
 * map kept as a **fallback layer**, not as the primary store.
 *
 * The fallback is not belt-and-braces. A migration file only runs if it is also
 * listed in MIGRATION_MANIFEST, and that list has already lost this entry once:
 * a concurrent session rebuilt runPendingMigrations.ts from a stale base and
 * dropped the line while leaving the .sql file in place. If that happens again,
 * every query here throws, and a naive fail-open would mean *no throttling at
 * all* — strictly worse than the Map this replaced. Degrading to in-process
 * throttling instead makes the worst case equal to the old behaviour.
 *
 * Still fails open in the sense that matters: a database problem must not
 * silence an SLA alert nobody then hears about. That matches isWorkerEnabled and
 * is the opposite of the notification gateway, which fails closed.
 */

/** Fallback throttle used only when the table is unreachable. */
const memoryFallback = new Map<string, number>();
let tableUnavailable = false;

/** Whether `subjectId` may be alerted about now, given `cooldownMs`. */
export async function shouldAlert(
  workerName: string,
  subjectId: string,
  cooldownMs: number
): Promise<boolean> {
  const key = `${workerName}:${subjectId}`;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT last_sent_at FROM alert_cooldown WHERE alert_key = ? LIMIT 1",
      [key]
    );
    tableUnavailable = false;
    if (!rows.length) return true;
    const last = new Date(rows[0].last_sent_at).getTime();
    if (Number.isNaN(last)) return true;
    return Date.now() - last >= cooldownMs;
  } catch (error) {
    if (!tableUnavailable) {
      tableUnavailable = true;
      console.warn(
        `[alert-cooldown] falling back to in-process throttling for ${workerName} — ` +
          `is 1054_alert_worker_governance.sql in MIGRATION_MANIFEST? ` +
          `(${error instanceof Error ? error.message : String(error)})`
      );
    }
    const last = memoryFallback.get(key);
    return last === undefined || Date.now() - last >= cooldownMs;
  }
}

/** Record that an alert just went out. Best-effort. */
export async function markAlerted(workerName: string, subjectId: string): Promise<void> {
  const key = `${workerName}:${subjectId}`;
  // Always recorded in memory too, so a table that disappears mid-run still has
  // a throttle to fall back on.
  memoryFallback.set(key, Date.now());
  try {
    await db.execute(
      `INSERT INTO alert_cooldown (alert_key, last_sent_at, send_count)
            VALUES (?, NOW(), 1)
       ON DUPLICATE KEY UPDATE last_sent_at = NOW(), send_count = send_count + 1`,
      [key]
    );
  } catch {
    /* observability must not fail the work it observes */
  }
}

/**
 * Drop rows older than `olderThanMs`. Called opportunistically by the workers so
 * the table cannot grow without bound; there is no scheduled sweep for it.
 */
export async function cleanupCooldowns(workerName: string, olderThanMs: number): Promise<void> {
  const cutoff = Date.now() - olderThanMs;
  for (const [key, ts] of memoryFallback.entries()) {
    if (key.startsWith(`${workerName}:`) && ts < cutoff) memoryFallback.delete(key);
  }
  try {
    await db.execute(
      `DELETE FROM alert_cooldown
        WHERE alert_key LIKE ?
          AND last_sent_at < DATE_SUB(NOW(), INTERVAL ? SECOND)`,
      [`${workerName}:%`, Math.max(1, Math.round(olderThanMs / 1000))]
    );
  } catch {
    /* ignore */
  }
}
