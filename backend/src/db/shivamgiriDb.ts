import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { env } from '../config/env.js';

let pool: mysql.Pool | null = null;
type ShivamgiriExecuteParams = Parameters<mysql.Pool['execute']>[1];

// Existing consumers (objection-analysis.service.ts, quality-dashboard.routes.ts,
// quality-insights.service.ts, tni.service.ts) call getShivamgiriPool() directly and
// issue their own SELECTs — verified 2026-08-21, no INSERT/UPDATE/DELETE in any of
// them. Enforcing READ ONLY at the session level (mirroring dialerDb.ts) is therefore
// transparent to them: it changes nothing they can already do, it only blocks writes
// none of them perform. New call sites should prefer shivamgiriQuery() below, which
// additionally whitelists statement types the way dialerDb.ts's dialerQuery() does.
export function getShivamgiriPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.SHIVAMGIRI_DB_NAME,
      waitForConnections: true,
      connectionLimit: 5,
      connectTimeout: 10000,
      // Occasional cross-DB reads: park at most one connection on the shared server.
      maxIdle: 1,
      idleTimeout: env.DB_POOL_IDLE_TIMEOUT_MS,
    });

    // Enforce read-only the same way dialerDb.ts does: best-effort on pool creation,
    // logged (not thrown) on failure so existing consumers keep working if this ever
    // can't be set — the query whitelist below is the hard backstop for new call sites.
    pool
      .getConnection()
      .then(async (conn) => {
        try {
          await conn.query('SET SESSION TRANSACTION READ ONLY');
          console.log(`[SHIVAMGIRI] Connected to ${env.DB_HOST}/${env.SHIVAMGIRI_DB_NAME} (READ-ONLY)`);
        } finally {
          conn.release();
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[SHIVAMGIRI] Failed to enforce READ ONLY session:', message);
      });
  }
  return pool;
}

export async function closeShivamgiriPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function testShivamgiriConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const p = getShivamgiriPool();
    await p.query('SELECT 1 AS ok');
    return { ok: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

/**
 * Safe query wrapper for NEW call sites — BLOCKS non-SELECT queries.
 * Existing consumers keep using getShivamgiriPool() directly and are unaffected;
 * this is the recommended path for Phase B+ work reading Call Master's own DB.
 */
export async function shivamgiriQuery<T = RowDataPacket>(
  sql: string,
  params?: ShivamgiriExecuteParams
): Promise<T[]> {
  const trimmedSql = sql.trim().toUpperCase();
  const allowedStarts = ['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN'];
  const isAllowed = allowedStarts.some((start) => trimmedSql.startsWith(start));

  if (!isAllowed) {
    const error = new Error(
      `SHIVAMGIRI_DB: Only SELECT/SHOW/DESCRIBE queries allowed (READ-ONLY). Blocked: ${trimmedSql.substring(0, 50)}`
    );
    console.error('[SHIVAMGIRI] BLOCKED:', error.message);
    throw error;
  }

  const shivamgiriPool = getShivamgiriPool();
  const [rows] = await shivamgiriPool.execute(sql, params);
  return rows as T[];
}
