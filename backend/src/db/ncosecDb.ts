import sql from 'mssql';
import { env } from '../config/env.js';
import { getPoolForKey, testPoolForKey } from '../modules/external-db/external-db.service.js';

const legacyConfig: sql.config = {
  server: env.NCOSEC_DB_HOST,
  port: env.NCOSEC_DB_PORT,
  user: env.NCOSEC_DB_USER,
  password: env.NCOSEC_DB_PASSWORD,
  database: env.NCOSEC_DB_NAME,
  options: {
    encrypt: env.NCOSEC_DB_ENCRYPT === 'true',
    trustServerCertificate: env.NCOSEC_DB_TRUST_CERT === 'true',
    enableArithAbort: true,
    readOnlyIntent: true,
  },
  connectionTimeout: 15000,
  requestTimeout: 60000,
};

let legacyPool: sql.ConnectionPool | null = null;

async function getLegacyPool(): Promise<sql.ConnectionPool> {
  if (legacyPool && legacyPool.connected) return legacyPool;
  legacyPool = await new sql.ConnectionPool(legacyConfig).connect();
  return legacyPool;
}

export async function getNcosecPool(): Promise<sql.ConnectionPool> {
  try {
    return (await getPoolForKey('cosec_biometric')) as sql.ConnectionPool;
  } catch {
    if (!env.NCOSEC_DB_HOST) throw new Error('COSEC not configured: set credentials via Integration Hub or env vars');
    return getLegacyPool();
  }
}

export async function closeNcosecPool(): Promise<void> {
  if (legacyPool) { await legacyPool.close(); legacyPool = null; }
}

export async function testNcosecConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await testPoolForKey('cosec_biometric');
    if (result.ok) return result;
  } catch (err: unknown) {
    console.error('[ncosecDb] Config-based pool test failed:', err instanceof Error ? err.message : String(err));
  }
  // fallback to env-var pool
  try {
    const p = await getLegacyPool();
    await p.request().query('SELECT 1 AS ok');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
