/**
 * When a write times out waiting on a row lock (ER_LOCK_WAIT_TIMEOUT), say WHO else was connected.
 *
 * The app's DB user cannot read information_schema.innodb_trx / sys.innodb_lock_waits (no PROCESS
 * privilege), so the holder of a lock cannot be named directly. It CAN read its own threads in
 * information_schema.processlist — and every app connection is the same user — so a snapshot of
 * threads that are busy for a while, or sitting idle with a long TIME (the signature of a
 * transaction left open), points at the culprit. No statement text is kept beyond 120 characters
 * and long digit runs are masked, so no account number or id reaches the log.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

const mask = (s: unknown) => String(s ?? "").replace(/\d{6,}/g, "#").replace(/\s+/g, " ").slice(0, 120);

export async function logLockContext(label: string): Promise<void> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ID AS thread, COMMAND AS command, TIME AS secs, STATE AS state, INFO AS q
         FROM information_schema.processlist
        WHERE ID <> CONNECTION_ID() AND ((COMMAND = 'Sleep' AND TIME >= 5) OR (COMMAND <> 'Sleep' AND TIME >= 3))
        ORDER BY TIME DESC LIMIT 15`,
    );
    const lines = (rows as RowDataPacket[]).map(
      (r) => `thread=${r.thread} ${r.command} ${r.secs}s ${r.state ?? ""} ${mask(r.q)}`,
    );
    console.error(`[lock-timeout] ${label}: ${lines.length} candidate connection(s)\n  ${lines.join("\n  ")}`);
  } catch (err) {
    console.error(`[lock-timeout] ${label}: could not read processlist:`, err instanceof Error ? err.message : err);
  }
}
