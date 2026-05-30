import mysql from "mysql2/promise";
import { env } from "../config/env.js";

const pool = mysql.createPool({
  host:               env.DB_HOST,
  port:               env.DB_PORT,
  user:               env.DB_USER,
  password:           env.DB_PASSWORD,
  database:           env.DB_NAME,
  connectionLimit:    env.DB_POOL_MAX,
  waitForConnections: true,
  queueLimit:         0,
  timezone:           "+00:00",
  decimalNumbers:     true,
});

/**
 * Application DB adapter.
 *
 * Services build parameterised SQL using values that are validated or
 * normalised before execution. mysql2's strict ExecuteValues signature rejects
 * `unknown[]` assembled by those services even though the runtime accepts the
 * parameterised scalar/null values. Keep one controlled cast at this DB
 * boundary rather than spreading unsafe casts across every business module.
 */
export const db = {
  execute<T = unknown>(sql: string, values?: readonly unknown[]): Promise<[T, unknown[]]> {
    return pool.execute(sql, values as any[] | undefined) as unknown as Promise<[T, unknown[]]>;
  },
  getConnection() {
    return pool.getConnection();
  },
};

export async function pingDb(): Promise<void> {
  const conn = await db.getConnection();
  await conn.ping();
  conn.release();
}
