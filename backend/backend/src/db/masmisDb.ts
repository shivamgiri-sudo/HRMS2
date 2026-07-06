import mysql from "mysql2/promise";
import { env } from "../config/env.js";

let pool: mysql.Pool | null = null;

export function getMasmisPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host:     process.env.MYSQL_MASMIS_HOST     || env.DB_HOST,
      user:     process.env.MYSQL_MASMIS_USER     || env.DB_USER,
      password: process.env.MYSQL_MASMIS_PASSWORD || env.DB_PASSWORD,
      port:     Number(process.env.MYSQL_MASMIS_PORT || env.DB_PORT) || 3306,
      database: process.env.MYSQL_MASMIS_DATABASE || "db_masmis",
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 15000,
    });
  }
  return pool;
}

export async function queryMasmis<T = Record<string, unknown>>(
  sql: string,
  params: (string | number | null)[] = []
): Promise<T[]> {
  const [rows] = await getMasmisPool().execute(sql, params);
  return rows as T[];
}
