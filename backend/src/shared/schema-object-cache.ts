/**
 * "Does this table/column exist?" — cached, so a knowingly-absent object is not
 * queried on every request.
 *
 * Three governance tiles in management.service query objects that do not exist
 * in this schema: `policy_acknowledgement`, `performance_appraisal` and
 * `auth_user.two_fa_enabled`. Each is correctly guarded — `.catch()` returns
 * null so the tile reads "unavailable" rather than the far worse "0 pending"
 * — and that behaviour must not change.
 *
 * The cost is noise. Every dashboard load fires three doomed queries, and
 * db/mysql.ts logs each one, by design: "Visibility, not control flow ... without
 * this line a wrong column or a missing table is indistinguishable from 'no rows
 * matched'." That line is worth keeping, so the fix belongs here, at the call
 * site, not in the logger.
 *
 * Measured on the production error log, 2026-08-08: 28 of roughly 50 errors in
 * the retained window were these three. That mattered — an
 * ER_TRUNCATED_WRONG_VALUE from a real, live onboarding failure was sitting in
 * the same log, and the volume is what made it easy to miss.
 *
 * Self-healing: entries expire, so creating the table makes the tile start
 * working within TTL_MS without a deploy or a restart. Failure is treated as
 * "present" so a hiccup in information_schema can never suppress a real query —
 * the worst case is the status quo, one logged error.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";

/** Long enough to spare information_schema, short enough that a new table appears on its own. */
const TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, { exists: boolean; at: number }>();

async function lookup(key: string, sql: string, params: unknown[]): Promise<boolean> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.exists;

  try {
    const [rows] = await db.query<RowDataPacket[]>(sql, params);
    const exists = Number((rows[0] as { n?: number } | undefined)?.n ?? 0) > 0;
    cache.set(key, { exists, at: Date.now() });
    return exists;
  } catch {
    // Fail OPEN: assume present and let the real query run. Being wrong here
    // costs one log line; the opposite would silently stop a working tile.
    cache.set(key, { exists: true, at: Date.now() });
    return true;
  }
}

export function tableExists(table: string): Promise<boolean> {
  return lookup(
    `t:${table}`,
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table],
  );
}

export function columnExists(table: string, column: string): Promise<boolean> {
  return lookup(
    `c:${table}.${column}`,
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
}

/**
 * Runs `run()` only when the object is there, otherwise returns `absent`.
 *
 * `absent` is what the tile shows when the data cannot exist, and every current
 * caller passes a null-shaped value on purpose: null renders as "unavailable",
 * whereas 0 would render as "no pending policy acknowledgements" — a compliance
 * all-clear produced by a query that never ran.
 */
export async function ifObjectExists<T>(
  present: boolean | Promise<boolean>,
  run: () => Promise<T>,
  absent: T,
): Promise<T> {
  return (await present) ? run() : absent;
}

/** Test/ops hook: drop the cache so a freshly created table is picked up at once. */
export function clearSchemaObjectCache(): void {
  cache.clear();
}
