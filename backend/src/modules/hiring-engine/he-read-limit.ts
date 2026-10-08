/**
 * Read limits for the Command Center analytics (drive analytics, drive trend / campaign dashboard groups, sources, insight facts, cost,
 * outcome reasons, persons). The DB pool is small and shared with the app, so these reads never run more than READ_CONCURRENCY at a time,
 * across every build in this process (concurrent users queue here instead of draining the pool). Every statement also carries a MySQL
 * MAX_EXECUTION_TIME hint, so a slow read fails (ER_QUERY_TIMEOUT) and its section is flagged instead of holding a connection.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export const READ_CONCURRENCY = 4;
export const STATEMENT_TIMEOUT_MS = 8000;

let active = 0;
const waiting: Array<() => void> = [];

/** Runs `fn` when one of the READ_CONCURRENCY slots is free; the slot is released however `fn` ends (handed straight to the next waiter). */
export async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= READ_CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve)); // the releasing caller hands its slot over
  else active++;
  try { return await fn(); } finally {
    const next = waiting.shift();
    if (next) next(); else active--;
  }
}

/** Test hook: slots in use and callers waiting. */
export function readLimitState(): { active: number; waiting: number } { return { active, waiting: waiting.length }; }

/** The statement with a MAX_EXECUTION_TIME optimizer hint after its leading SELECT (other statements are returned unchanged). */
export function withStatementTimeout(sql: string, ms: number = STATEMENT_TIMEOUT_MS): string {
  return sql.replace(/^(\s*SELECT)\b/i, `$1 /*+ MAX_EXECUTION_TIME(${Math.max(1, Math.floor(ms))}) */`);
}

/** `db.execute` behind the limiter and with the statement timeout; drop-in for the analytics reads. */
export const limitedDb = {
  execute<T extends RowDataPacket[] = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, unknown]> {
    return limited(() => db.execute<T>(withStatementTimeout(sql), params as never) as unknown as Promise<[T, unknown]>);
  },
};
