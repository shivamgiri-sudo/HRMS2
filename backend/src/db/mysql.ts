import mysql, { type RowDataPacket, type FieldPacket, type QueryResult, type Pool } from "mysql2/promise";
import { env } from "../config/env.js";

const _pool: Pool = mysql.createPool({
  host:               env.DB_HOST,
  port:               env.DB_PORT,
  user:               env.DB_USER,
  password:           env.DB_PASSWORD,
  database:           env.DB_NAME,
  connectionLimit:    env.DB_POOL_MAX,
  waitForConnections: true,
  queueLimit:         0,
  timezone:           "local",   // Use server local time (avoids double-offset on IST-stored values)
  dateStrings:        true,      // Return DATETIME/TIMESTAMP as strings, not JS Date objects
  decimalNumbers:     true,
});

/**
 * Typed db facade that accepts unknown[] params (mysql2 requires ExecuteValues,
 * but services build dynamic param arrays typed as unknown[]).
 */
type ExecuteParams = Parameters<Pool["execute"]>[1];

export const db = {
  execute<T extends QueryResult = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, FieldPacket[]]> {
    return _pool.execute<T>(sql, params as ExecuteParams);
  },
  executeRun(sql: string, params?: unknown[]): Promise<[QueryResult, FieldPacket[]]> {
    return _pool.execute(sql, params as ExecuteParams);
  },
  getConnection: _pool.getConnection.bind(_pool),
  query: _pool.query.bind(_pool),
  end: _pool.end.bind(_pool),
};

// Catch pool-level errors to avoid unhandled rejections
const poolEvents = _pool as unknown as {
  pool?: { on?: (event: string, listener: (err: Error) => void) => void };
  on?: { (event: string, listener: (err: Error) => void): void };
};

(poolEvents.pool ?? poolEvents).on?.("error", (err: Error) => {
  console.error("[mysql pool] unexpected error:", err.message);
});

export async function pingDb(): Promise<void> {
  const conn = await _pool.getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}
