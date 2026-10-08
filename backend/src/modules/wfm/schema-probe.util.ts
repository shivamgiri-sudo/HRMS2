/**
 * Generic table/column existence probes, cached per-table at module scope.
 * Used by the roster enterprise-controls program's policy resolvers (rest,
 * week-off) so a service can be deployed ahead of its own migration being
 * applied and degrade to "policy table doesn't exist yet" — which the
 * resolvers treat as "no policy configured" (fail closed), never as "no
 * restriction" — instead of throwing an unknown-table SQL error.
 */

import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

type Executor = { execute<T extends RowDataPacket[] = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, unknown]> };

const tableExistsCache = new Map<string, boolean>();
const tableColumnsCache = new Map<string, Set<string>>();

// Accepts an optional executor (a transaction's `conn`, not just the pool
// `db`) purely so callers inside a bulk-upload transaction can probe through
// the same connection their other queries use — which also happens to be
// what makes those services' existing tests (which mock only `conn.execute`)
// work unchanged. The answer itself is identical either way: schema
// metadata, unlike a row's data, doesn't change within a transaction's
// lifetime, so there's no correctness reason to prefer one over the other —
// this is a test/consistency convenience, not a snapshot-isolation need.
export async function hasTable(table: string, executor: Executor = db): Promise<boolean> {
  if (tableExistsCache.has(table)) return tableExistsCache.get(table)!;
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table]
  );
  const exists = rows.length > 0;
  tableExistsCache.set(table, exists);
  return exists;
}

export async function tableColumns(table: string, executor: Executor = db): Promise<Set<string>> {
  if (tableColumnsCache.has(table)) return tableColumnsCache.get(table)!;
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  const cols = new Set((rows as RowDataPacket[]).map((r) => String(r.COLUMN_NAME)));
  tableColumnsCache.set(table, cols);
  return cols;
}

/** Test-only: clears caches so a test file can simulate a different schema
 *  state (table present/absent) across cases without process restart. */
export function __resetSchemaProbeCachesForTests(): void {
  tableExistsCache.clear();
  tableColumnsCache.clear();
}
