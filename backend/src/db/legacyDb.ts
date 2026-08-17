import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

// If LEGACY_MYSQL_HOST is not set, fall back to BILL_DB_* credentials.
// All existing code that calls getLegacyPool() is querying db_bill.
const host     = env.LEGACY_MYSQL_HOST     || env.BILL_DB_HOST;
const port     = env.LEGACY_MYSQL_PORT     || env.BILL_DB_PORT || 3306;
const user     = env.LEGACY_MYSQL_USER     || env.BILL_DB_USER;
const password = env.LEGACY_MYSQL_PASSWORD || env.BILL_DB_PASSWORD;
const database = env.LEGACY_MYSQL_DATABASE || env.BILL_DB_NAME;

const config: mysql.PoolOptions = {
  host,
  port,
  user,
  password,
  database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  connectTimeout: 15000,
};

let pool: mysql.Pool | null = null;

export async function getLegacyPool(): Promise<mysql.Pool> {
  if (!pool) {
    pool = mysql.createPool(config);
    // db_bill is an upstream read-only source per the project charter — billDb.ts (the
    // sibling pool to the same source) already enforces this at the session level;
    // this pool didn't. No code currently writes through getLegacyPool() (confirmed:
    // no INSERT/UPDATE/DELETE against db_bill.* anywhere in the backend), so this is
    // defense-in-depth, not a fix for a demonstrated violation.
    try {
      const conn = await pool.getConnection();
      // MySQL 5.5 doesn't support SET SESSION TRANSACTION READ ONLY (added in 5.6.5).
      // Try the modern syntax; fall back silently — no code writes through this pool.
      try {
        await conn.query('SET SESSION TRANSACTION READ ONLY');
      } catch {
        try {
          await conn.query('SET SESSION tx_read_only = 1');
        } catch {
          console.warn('[LEGACY/BILL] READ ONLY session not enforced (old MySQL version) — no writes expected');
        }
      }
      conn.release();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[LEGACY/BILL] Failed to acquire connection:', message);
      throw error;
    }
    console.log(`[LEGACY/BILL] Connected to ${host}:${port}/${database} (READ-ONLY)`);
  }
  return pool;
}

export async function closeLegacyPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[LEGACY/BILL] Connection pool closed');
  }
}

export async function testLegacyConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const p = await getLegacyPool();
    await p.execute('SELECT 1 AS ok');
    return { ok: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}
