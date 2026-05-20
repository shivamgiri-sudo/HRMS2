import mysql from "mysql2/promise";
import { env } from "../config/env.js";

export const db = mysql.createPool({
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

export async function pingDb(): Promise<void> {
  const conn = await db.getConnection();
  await conn.ping();
  conn.release();
}
