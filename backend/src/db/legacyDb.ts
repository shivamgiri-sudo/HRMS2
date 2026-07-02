import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

const config: mysql.PoolOptions = {
  host: env.LEGACY_MYSQL_HOST,
  port: env.LEGACY_MYSQL_PORT,
  user: env.LEGACY_MYSQL_USER,
  password: env.LEGACY_MYSQL_PASSWORD,
  database: env.LEGACY_MYSQL_DATABASE,
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
    console.log(`[LEGACY] Connected to ${env.LEGACY_MYSQL_HOST}:${env.LEGACY_MYSQL_PORT}/${env.LEGACY_MYSQL_DATABASE}`);
  }
  return pool;
}

export async function closeLegacyPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[LEGACY] Connection pool closed');
  }
}

export async function testLegacyConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const p = await getLegacyPool();
    await p.execute('SELECT 1 AS ok');
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
