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
 * Backed by the `alert_cooldown` table (migration 1054).
 *
 * Fails **open** on a database error: an alert that should have been throttled is
 * a nuisance, but a throttle that silently swallows every alert because the table
 * is missing is a missed SLA nobody hears about. That matches isWorkerEnabled and
 * is the opposite of the notification gateway, which fails closed.
 */

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
    if (!rows.length) return true;
    const last = new Date(rows[0].last_sent_at).getTime();
    if (Number.isNaN(last)) return true;
    return Date.now() - last >= cooldownMs;
  } catch {
    return true;
  }
}

/** Record that an alert just went out. Best-effort. */
export async function markAlerted(workerName: string, subjectId: string): Promise<void> {
  const key = `${workerName}:${subjectId}`;
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
