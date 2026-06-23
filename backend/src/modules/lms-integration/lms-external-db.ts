import mysql from 'mysql2/promise';
import { env } from '../../config/env.js';

const lmsPool = mysql.createPool({
  host: env.LMS_DB_HOST,
  user: env.LMS_DB_USER,
  password: env.LMS_DB_PASSWORD,
  database: env.LMS_DB_NAME,
  waitForConnections: true,
  connectionLimit: 3,
  queueLimit: 0,
} as Parameters<typeof mysql.createPool>[0]);

export async function getLmsConnection() {
  return lmsPool.getConnection();
}

export async function closeLmsPool() {
  return lmsPool.end();
}
