/**
 * Small transaction helper for the Team Roster workflow: one dedicated connection, commit on
 * success, rollback (and rethrow) on any error, always released.
 */
import { db } from "../../db/mysql.js";
import type { SqlExecutor } from "./team-roster-types.js";

export async function withTransaction<T>(fn: (conn: SqlExecutor) => Promise<T>): Promise<T> {
  const conn = await (db as any).getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn as SqlExecutor);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error("[team-roster] rollback failed:", (rollbackErr as Error)?.message);
    }
    throw err;
  } finally {
    conn.release();
  }
}

export const isDuplicateKey = (err: unknown) =>
  (err as { code?: string; errno?: number })?.code === "ER_DUP_ENTRY" || (err as { errno?: number })?.errno === 1062;
