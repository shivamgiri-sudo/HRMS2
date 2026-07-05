import mysql from "mysql2/promise";
import { env } from "../config/env.js";

let pool: mysql.Pool | null = null;

export function getSourcePool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      // No database — allows qualified cross-DB refs like db_audit.call_quality_assessment
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 15000,
    });
  }
  return pool;
}

export async function querySource<T = Record<string, unknown>>(
  sql: string,
  params: (string | number | null)[] = []
): Promise<T[]> {
  const [rows] = await getSourcePool().execute(sql, params);
  return rows as T[];
}
