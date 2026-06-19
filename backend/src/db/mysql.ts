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
  queueLimit:         200,   // reject after 200 queued — prevents unbounded memory growth under spike
  connectTimeout:     10000,
  timezone:           "local",
  decimalNumbers:     true,
});

/**
 * Typed db facade that accepts unknown[] params (mysql2 requires ExecuteValues,
 * but services build dynamic param arrays typed as unknown[]).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyParams = any;

export const db = {
  execute<T extends QueryResult = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, FieldPacket[]]> {
    return _pool.execute<T>(sql, params as AnyParams);
  },
  executeRun(sql: string, params?: unknown[]): Promise<[QueryResult, FieldPacket[]]> {
    return _pool.execute(sql, params as AnyParams);
  },
  getConnection: _pool.getConnection.bind(_pool),
  query: _pool.query.bind(_pool),
  end: _pool.end.bind(_pool),
};

export async function pingDb(): Promise<void> {
  const conn = await _pool.getConnection();
  await conn.ping();
  conn.release();
}

// ── Billing DB (db_bill) — READ-ONLY pool ────────────────────────────────────
// Only created when BILL_DB_HOST is configured.
let _billPool: Pool | null = null;

function getBillPool(): Pool {
  if (_billPool) return _billPool;
  if (!env.BILL_DB_HOST) {
    throw new Error("BILL_DB_HOST is not configured. Set it in .env to use billing DB features.");
  }
  _billPool = mysql.createPool({
    host:               env.BILL_DB_HOST,
    port:               env.BILL_DB_PORT,
    user:               env.BILL_DB_USER,
    password:           env.BILL_DB_PASSWORD,
    database:           env.BILL_DB_NAME,
    connectionLimit:    5,
    waitForConnections: true,
    queueLimit:         0,
    timezone:           "+00:00",
    decimalNumbers:     true,
  });
  return _billPool;
}

export const billDb = {
  execute<T extends QueryResult = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, FieldPacket[]]> {
    return getBillPool().execute<T>(sql, params as AnyParams);
  },
};
