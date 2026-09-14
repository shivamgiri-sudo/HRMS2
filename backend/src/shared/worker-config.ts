/**
 * Runtime kill switch for workers.
 *
 * `worker_config` was created by sql/533_worker_distributed_safety.sql and seeded by
 * sql/1012_report_request_tables.sql, but no code has ever read it — a kill switch nobody
 * wired up. This is the reader.
 *
 * The point is that disabling a worker must not require a deploy. When an escalation
 * worker starts emailing the wrong people at 2am, the fix has to be one UPDATE.
 */
import type { RowDataPacket } from 'mysql2';
import { db } from '../db/mysql.js';

interface WorkerConfigRow extends RowDataPacket {
  worker_name: string;
  enabled: number;
}

/** Short TTL: long enough to spare the DB on a 30s poll, short enough that an operator
 *  flipping the switch sees it take effect within a minute. */
const TTL_MS = 60_000;
const cache = new Map<string, { enabled: boolean; at: number }>();

/**
 * Whether `workerName` may run right now.
 *
 * Fails **open** (returns true) when the row is missing or the query errors. That is
 * deliberate and is the opposite of how the notification gateway behaves:
 *   - A missing worker_config row means an operator never opted in to managing this
 *     worker. The 28 existing workers have no rows and must keep running.
 *   - The gateway, by contrast, fails closed — a missing event config means do not send.
 * Absence of a row is "unmanaged", not "disabled".
 */
export async function isWorkerEnabled(workerName: string): Promise<boolean> {
  const hit = cache.get(workerName);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.enabled;

  try {
    const [rows] = await db.execute<WorkerConfigRow[]>(
      'SELECT worker_name, enabled FROM worker_config WHERE worker_name = ? LIMIT 1',
      [workerName],
    );
    const enabled = rows.length ? Number(rows[0].enabled) === 1 : true;
    cache.set(workerName, { enabled, at: Date.now() });
    return enabled;
  } catch {
    // Table absent (migration not yet applied) or DB blip — do not take workers down.
    cache.set(workerName, { enabled: true, at: Date.now() });
    return true;
  }
}

/** Record a run. Best-effort: observability must never fail the work it observes. */
export async function markWorkerRun(workerName: string): Promise<void> {
  try {
    await db.execute('UPDATE worker_config SET last_run_at = NOW() WHERE worker_name = ?', [workerName]);
  } catch { /* ignore */ }
}

/** Drop the cache so a test — or an operator who just flipped a switch — sees it at once. */
export function clearWorkerConfigCache(workerName?: string): void {
  if (workerName) cache.delete(workerName);
  else cache.clear();
}
