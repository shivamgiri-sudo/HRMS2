import mysql from "mysql2/promise";
import { env } from "../config/env.js";

let pool: mysql.Pool | null = null;

export function getMasmisPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      // No default database — tables are qualified as db_masmis.* (or MASMIS_DB_NAME.*)
      // MASMIS_DB_NAME is available via env for queries that need it explicitly
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      connectTimeout: 15000,
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
