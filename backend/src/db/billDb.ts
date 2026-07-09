import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { env } from '../config/env.js';

const config: mysql.PoolOptions = {
  host: env.BILL_DB_HOST,
  port: env.BILL_DB_PORT || 3306,
  user: env.BILL_DB_USER,
  password: env.BILL_DB_PASSWORD,
  database: env.BILL_DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  connectTimeout: 15000,
  flags: ['-ALLOW_LOCAL_INFILE'],
  connectAttributes: {
    program_name: 'HRMS_ReadOnly_Bill',
  },
};

let pool: mysql.Pool | null = null;
type BillExecuteParams = Parameters<mysql.Pool['execute']>[1];

export async function getBillPool(): Promise<mysql.Pool> {
  if (!pool) {
    pool = mysql.createPool(config);
    try {
      const conn = await pool.getConnection();
      await conn.query('SET SESSION TRANSACTION READ ONLY');
      conn.release();
      console.log(`[BILL] Connected to ${config.host}:${config.port}/${config.database} (READ-ONLY)`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[BILL] Connection failed:', message);
      throw error;
    }
  }
  return pool;
}

export async function closeBillPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[BILL] Connection pool closed');
  }
}

export async function testBillConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const p = await getBillPool();
    await p.execute('SELECT 1 AS ok');
    return { ok: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

/**
 * Safe query wrapper — BLOCKS non-SELECT queries (READ-ONLY source).
 */
export async function billQuery<T = RowDataPacket>(
  sql: string,
  params?: BillExecuteParams
): Promise<T[]> {
  const trimmedSql = sql.trim().toUpperCase();
  const allowedStarts = ['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN'];
  const isAllowed = allowedStarts.some(start => trimmedSql.startsWith(start));

  if (!isAllowed) {
    throw new Error(
      `BILL_DB: Only SELECT/SHOW/DESCRIBE queries allowed (READ-ONLY). Blocked: ${trimmedSql.substring(0, 50)}`
    );
  }

  const billPool = await getBillPool();
  const [rows] = await billPool.execute(sql, params);
  return rows as T[];
}
