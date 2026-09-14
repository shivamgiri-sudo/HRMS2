import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";

const tableExistsCache = new Map<string, Promise<boolean>>();

export async function tableExists(tableName: string): Promise<boolean> {
  if (!tableExistsCache.has(tableName)) {
    tableExistsCache.set(
      tableName,
      db.execute<RowDataPacket[]>(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
        [tableName]
      ).then(([rows]) => rows.length > 0).catch((error) => {
        tableExistsCache.delete(tableName);
        throw error;
      })
    );
  }
  return tableExistsCache.get(tableName)!;
}

export async function scalar(sql: string, params: unknown[] = [], fallback = 0): Promise<number> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    const first = rows[0] ?? {};
    const value = Object.values(first)[0];
    const n = Number(value ?? fallback);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

export async function queryRows<T extends RowDataPacket>(sql: string, params?: unknown[]): Promise<T[]> {
  const [rows] = await db.execute<T[]>(sql, params);
  return rows;
}
