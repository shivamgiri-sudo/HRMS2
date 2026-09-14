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

/**
 * db_bill runs MySQL 5.5.44. `SET SESSION TRANSACTION READ ONLY` arrived in 5.6, so on
 * this server it always failed with ER_UNKNOWN_SYSTEM_VARIABLE — and because `pool` was
 * already assigned before the statement ran, the next caller got that same pool back
 * without ever re-attempting the guard. So the effect was not "db_bill is unavailable"
 * but something worse: whether a query worked depended on whether an earlier caller had
 * swallowed the throw, and when it did work the read-only session guard was not applied.
 *
 * The statement is now issued only where the server supports it. On 5.5 the read-only
 * guarantee comes from the SELECT/SHOW allowlist in billQuery() below and from the
 * account's own GRANTs — it cannot be enforced at session level, so do not assume it is.
 */
function supportsReadOnlyTransactions(versionString: string): boolean {
  const m = /^(\d+)\.(\d+)/.exec(versionString);
  if (!m) return false;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return major > 5 || (major === 5 && minor >= 6);
}

export async function getBillPool(): Promise<mysql.Pool> {
  if (pool) return pool;

  const candidate = mysql.createPool(config);
  try {
    const conn = await candidate.getConnection();
    try {
      const [rows] = await conn.query<RowDataPacket[]>('SELECT VERSION() AS version');
      const version = String(rows[0]?.version ?? '');
      if (supportsReadOnlyTransactions(version)) {
        await conn.query('SET SESSION TRANSACTION READ ONLY');
        console.log(`[BILL] Connected to ${config.host}:${config.port}/${config.database} (READ-ONLY session, MySQL ${version})`);
      } else {
        console.log(`[BILL] Connected to ${config.host}:${config.port}/${config.database} (MySQL ${version} predates SET SESSION TRANSACTION READ ONLY; reads are enforced by the billQuery allowlist and by GRANTs)`);
      }
    } finally {
      conn.release();
    }
  } catch (error: unknown) {
    // Never leave a half-initialised pool behind: a later caller would reuse it and skip
    // the guard above entirely, which is how a failed init became a silent downgrade.
    await candidate.end().catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    console.error('[BILL] Connection failed:', message);
    throw error;
  }

  pool = candidate;
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
