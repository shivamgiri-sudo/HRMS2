import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { env } from '../config/env.js';

const config: mysql.PoolOptions = {
  host: env.DIALER_DB_HOST,
  port: env.DIALER_DB_PORT || 3306,
  user: env.DIALER_DB_USER,
  password: env.DIALER_DB_PASSWORD,
  database: env.DIALER_DB_NAME,
  waitForConnections: true,
  connectionLimit: 5, // Low limit for read-only queries
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  connectTimeout: 15000,
  // ENFORCE READ-ONLY
  flags: ['-ALLOW_LOCAL_INFILE'],
  connectAttributes: {
    program_name: 'HRMS_ReadOnly_Dialer',
  },
};

let pool: mysql.Pool | null = null;
type DialerExecuteParams = Parameters<mysql.Pool['execute']>[1];

export async function getDialerPool(): Promise<mysql.Pool> {
  if (!pool) {
    pool = mysql.createPool(config);

    // Test connection and enforce read-only
    try {
      const conn = await pool.getConnection();
      await conn.query('SET SESSION TRANSACTION READ ONLY');
      conn.release();
      console.log(`[DIALER] Connected to ${config.host}:${config.port}/${config.database} (READ-ONLY)`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[DIALER] Connection failed:', message);
      throw error;
    }
  }
  return pool;
}

export async function closeDialerPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[DIALER] Connection pool closed');
  }
}

export async function testDialerConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const p = await getDialerPool();
    await p.execute('SELECT 1 AS ok');
    return { ok: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

/**
 * Safe query wrapper - BLOCKS non-SELECT queries
 * CRITICAL: Only SELECT/SHOW/DESCRIBE allowed (READ-ONLY)
 */
export async function dialerQuery<T = RowDataPacket>(
  sql: string,
  params?: DialerExecuteParams
): Promise<T[]> {
  // CRITICAL SECURITY: Only allow SELECT queries
  const trimmedSql = sql.trim().toUpperCase();
  const allowedStarts = ['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN'];
  const isAllowed = allowedStarts.some(start => trimmedSql.startsWith(start));

  if (!isAllowed) {
    const error = new Error(
      `DIALER_DB: Only SELECT/SHOW/DESCRIBE queries allowed (READ-ONLY). Blocked: ${trimmedSql.substring(0, 50)}`
    );
    console.error('[DIALER] BLOCKED:', error.message);
    throw error;
  }

  const dialerPool = await getDialerPool();
  const [rows] = await dialerPool.execute(sql, params);
  return rows as T[];
}
