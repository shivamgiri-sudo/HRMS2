import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

/**
 * Pool for bella_db — the Bella Vita process raw-data warehouse (sales, lead
 * allocation, CDR, inbound SLA, targets and cancellations bulk-uploaded from
 * HRMS). Modelled on onfidoDb.ts: like onfido_db this is a destination HRMS
 * writes into, not an upstream read-only source, so there is no read-only
 * session guard here.
 *
 * It lives on the same host as onfido_db but in its own schema: the volumes are
 * the reason these are not in mas_hrms at all (CDR alone lands ~170k rows/month
 * and lead allocation ~375k/month), and keeping Bella Vita out of onfido_db
 * keeps each client's retention and access rules separable.
 */
const config: mysql.PoolOptions = {
  host: env.BELLA_DB_HOST,
  port: env.BELLA_DB_PORT || 3306,
  user: env.BELLA_DB_USER,
  password: env.BELLA_DB_PASSWORD,
  database: env.BELLA_DB_NAME,
  waitForConnections: true,
  connectionLimit: 8,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  connectTimeout: 15000,
  connectAttributes: {
    program_name: 'HRMS_BellaVita_Process',
  },
};

let pool: mysql.Pool | null = null;

export async function getBellaPool(): Promise<mysql.Pool> {
  if (pool) return pool;

  const candidate = mysql.createPool(config);
  try {
    const conn = await candidate.getConnection();
    try {
      const [rows] = await conn.query('SELECT VERSION() AS version, DATABASE() AS db_name');
      const row = (rows as Array<{ version: string; db_name: string }>)[0];
      console.log(`[BELLA] Connected to ${config.host}:${config.port}/${row?.db_name} (MySQL ${row?.version})`);
    } finally {
      conn.release();
    }
  } catch (error: unknown) {
    // Never leave a half-initialised pool behind — see billDb.ts for why this matters.
    await candidate.end().catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    console.error('[BELLA] Connection failed:', message);
    throw error;
  }

  pool = candidate;
  return pool;
}

export async function closeBellaPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[BELLA] Connection pool closed');
  }
}

export async function testBellaConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const p = await getBellaPool();
    await p.execute('SELECT 1 AS ok');
    return { ok: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}
