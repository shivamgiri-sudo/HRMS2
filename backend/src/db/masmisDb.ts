import mysql from "mysql2/promise";
import { env } from "../config/env.js";

let pool: mysql.Pool | null = null;

export function getMasmisPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      // db_masmis is on its own server. Hardcoding the mas_hrms connection here is what
      // made the entire sales-upload module dead in production: the application user has no
      // grant on db_masmis, so every read returned ER_TABLEACCESS_DENIED_ERROR.
      //
      // Each setting falls back to the main connection when unset, so an installation where
      // db_masmis genuinely sits beside mas_hrms behaves exactly as before.
      host: env.MASMIS_DB_HOST || env.DB_HOST,
      port: env.MASMIS_DB_PORT || env.DB_PORT,
      user: env.MASMIS_DB_USER || env.DB_USER,
      password: env.MASMIS_DB_PASSWORD || env.DB_PASSWORD,
      // No default database — tables are qualified as db_masmis.* (or MASMIS_DB_NAME.*)
      // MASMIS_DB_NAME is available via env for queries that need it explicitly
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      connectTimeout: 15000,
      // Occasional cross-DB reads: park at most one connection on the shared server.
      maxIdle: 1,
      idleTimeout: env.DB_POOL_IDLE_TIMEOUT_MS,
    });
  }
  return pool;
}

export function getMasmisDbName(): string {
  return env.MASMIS_DB_NAME;
}

export async function queryMasmis<T = Record<string, unknown>>(
  sql: string,
  params: (string | number | null)[] = []
): Promise<T[]> {
  const [rows] = await getMasmisPool().execute(sql, params);
  return rows as T[];
}
