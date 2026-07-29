import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

let pool: mysql.Pool | null = null;

export function getShivamgiriPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.SHIVAMGIRI_DB_NAME,
      waitForConnections: true,
      connectionLimit: 5,
      connectTimeout: 10000,
      // Occasional cross-DB reads: park at most one connection on the shared server.
      maxIdle: 1,
      idleTimeout: env.DB_POOL_IDLE_TIMEOUT_MS,
    });
  }
  return pool;
}

export async function closeShivamgiriPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
