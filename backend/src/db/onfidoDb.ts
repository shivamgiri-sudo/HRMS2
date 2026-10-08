import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

/**
 * Pool for onfido_db — the Onfido process raw-data warehouse (task/report exports
 * bulk-uploaded from HRMS: DOC/POA volume, quality-audit and client-escalation
 * feeds). Unlike billDb/lms-mysql (upstream, read-only sources), this DB is a
 * destination HRMS writes into, so there is no read-only session guard here.
 */
const config: mysql.PoolOptions = {
  host: env.ONFIDO_DB_HOST,
  port: env.ONFIDO_DB_PORT || 3306,
  user: env.ONFIDO_DB_USER,
  password: env.ONFIDO_DB_PASSWORD,
  database: env.ONFIDO_DB_NAME,
  waitForConnections: true,
  connectionLimit: 8,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  connectTimeout: 15000,
  connectAttributes: {
    program_name: 'HRMS_Onfido_Process',
  },
};

let pool: mysql.Pool | null = null;

export async function getOnfidoPool(): Promise<mysql.Pool> {
  if (pool) return pool;

  const candidate = mysql.createPool(config);
  try {
    const conn = await candidate.getConnection();
    try {
      const [rows] = await conn.query('SELECT VERSION() AS version, DATABASE() AS db_name');
      const row = (rows as Array<{ version: string; db_name: string }>)[0];
      console.log(`[ONFIDO] Connected to ${config.host}:${config.port}/${row?.db_name} (MySQL ${row?.version})`);
    } finally {
      conn.release();
    }
  } catch (error: unknown) {
    // Never leave a half-initialised pool behind — see billDb.ts for why this matters.
    await candidate.end().catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ONFIDO] Connection failed:', message);
    throw error;
  }

  pool = candidate;
  return pool;
}

export async function closeOnfidoPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[ONFIDO] Connection pool closed');
  }
}

export async function testOnfidoConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const p = await getOnfidoPool();
    await p.execute('SELECT 1 AS ok');
    return { ok: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}
