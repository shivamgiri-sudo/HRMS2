import mysql from "mysql2/promise";
import { env } from "../config/env.js";

let pool: mysql.Pool | null = null;

export async function getVicidialPool(): Promise<mysql.Pool> {
  if (pool) return pool;
  if (!env.SBI_VICIDIAL_USER || !env.SBI_VICIDIAL_PASSWORD) {
    throw new Error("SBI ViciDial credentials not configured (SBI_VICIDIAL_USER / SBI_VICIDIAL_PASSWORD)");
  }
  const candidate = mysql.createPool({
    host: env.SBI_VICIDIAL_HOST,
    port: env.SBI_VICIDIAL_PORT,
    user: env.SBI_VICIDIAL_USER,
    password: env.SBI_VICIDIAL_PASSWORD,
    database: env.SBI_VICIDIAL_DB,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 50,
    connectTimeout: 15000,
    timezone: "+05:30",
    dateStrings: true,
  });
  try {
    const conn = await candidate.getConnection();
    await conn.query("SELECT 1");
    conn.release();
    console.log(`[SBI_VICIDIAL] Connected to ${env.SBI_VICIDIAL_HOST}/${env.SBI_VICIDIAL_DB}`);
  } catch (err) {
    await candidate.end().catch(() => {});
    throw err;
  }
  pool = candidate;
  return pool;
}

export async function vicidialQuery<T = mysql.RowDataPacket>(sql: string, params?: unknown[]): Promise<T[]> {
  const p = await getVicidialPool();
  const [rows] = await p.execute(sql, params);
  return rows as T[];
}

export async function testVicidialConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    await vicidialQuery("SELECT 1");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
