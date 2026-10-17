/**
 * Lock-conflict telemetry: counts every InnoDB deadlock (1213) and lock-wait timeout (1205), by statement shape.
 *
 * WHY: on 2026-10-17 the production log held 1,968 deadlock lines but no way to rank them. Statements run inside a
 * transaction (connection.execute) bypass the central db.execute error handler, so the worst offenders were
 * invisible. This module is told about every one of them, groups them by a normalised statement, and writes the
 * totals to db_lock_incident every minute so the admin view (and the next incident) can name the guilty statement.
 *
 * It is observation only. It never retries, swallows or rewrites an error, and a failure to record is itself
 * swallowed (a deadlock must never become a second error because the bookkeeping failed).
 */
import type { Pool } from "mysql2/promise";

export type LockConflictKind = "deadlock" | "lock_wait_timeout";

const FLUSH_MS = 60_000;
const MAX_SHAPES = 500; // bound memory if something generates unbounded distinct statements

interface Bucket { kind: LockConflictKind; shape: string; count: number }
const buckets = new Map<string, Bucket>();
let pool: Pool | undefined;
let timer: NodeJS.Timeout | undefined;

export function classifyLockConflict(error: unknown): LockConflictKind | null {
  if (!error || typeof error !== "object") return null;
  const { code, errno } = error as { code?: unknown; errno?: unknown };
  if (code === "ER_LOCK_DEADLOCK" || errno === 1213) return "deadlock";
  if (code === "ER_LOCK_WAIT_TIMEOUT" || errno === 1205) return "lock_wait_timeout";
  return null;
}

/** One line per distinct statement: whitespace collapsed, literals and IN-lists replaced, capped at 300 chars. */
export function statementShape(sql: string | undefined): string {
  if (!sql) return "(unknown statement)";
  return sql
    .replace(/\s+/g, " ")
    .replace(/'(?:[^'\\]|\\.)*'/g, "?")
    .replace(/\b\d+(?:\.\d+)?\b/g, "?")
    .replace(/\(\s*\?(?:\s*,\s*\?)+\s*\)/g, "(?…)")
    .trim()
    .slice(0, 300);
}

export function recordLockConflict(error: unknown, sql?: string): void {
  const kind = classifyLockConflict(error);
  if (!kind) return;
  // Prefer the statement MySQL attached to the error (it is the one that lost), else the caller's.
  const attached = (error as { sql?: unknown }).sql;
  const shape = statementShape(typeof attached === "string" ? attached : sql);
  const key = `${kind}|${shape}`;
  const hit = buckets.get(key);
  if (hit) hit.count += 1;
  else if (buckets.size < MAX_SHAPES) buckets.set(key, { kind, shape, count: 1 });
  console.warn(`[lock-conflict] ${kind} ${shape.slice(0, 120)}`);
}

/** Wraps a statement's promise so a lock conflict is counted, then re-thrown unchanged. */
export function trackLockConflicts<T>(sql: string, promise: Promise<T>): Promise<T> {
  return promise.catch((error: unknown) => {
    recordLockConflict(error, sql);
    throw error;
  });
}

export function peekLockConflicts(): Array<{ kind: LockConflictKind; shape: string; count: number }> {
  return [...buckets.values()].sort((a, b) => b.count - a.count).map((b) => ({ ...b }));
}

export async function flushLockConflicts(): Promise<number> {
  if (!pool || buckets.size === 0) return 0;
  const rows = [...buckets.values()];
  buckets.clear();
  try {
    for (const b of rows) {
      await pool.execute(
        `INSERT INTO db_lock_incident (kind, action, statement_shape, occurrences, reason)
         VALUES (?, 'observed', ?, ?, 'statement lost a lock conflict')`,
        [b.kind, b.shape, b.count],
      );
    }
    return rows.length;
  } catch (err) {
    // Table not migrated yet, or DB busy: drop this window rather than fail anything.
    console.warn("[lock-conflict] flush skipped:", err instanceof Error ? err.message : String(err));
    return 0;
  }
}

/** Called once by mysql.ts with the shared pool; starts the periodic flush (unref'd, never blocks shutdown). */
export function installLockTelemetry(sharedPool: Pool): void {
  pool = sharedPool;
  if (timer) return;
  timer = setInterval(() => { void flushLockConflicts(); }, FLUSH_MS);
  timer.unref();
}

/** Test seam. */
export function resetLockTelemetryForTests(): void {
  buckets.clear();
  pool = undefined;
  if (timer) { clearInterval(timer); timer = undefined; }
}
