import mysql from 'mysql2/promise';
import { env } from '../../config/env.js';

/**
 * @deprecated Use lmsQuery() from backend/src/modules/lms/lms.service.ts instead.
 * This pool uses .env LMS_DB_* directly and does not respect Integration Hub credentials.
 * Will be removed once lms-integration/ module is fully retired.
 */
const lmsPool = mysql.createPool({
  host: env.LMS_DB_HOST,
  user: env.LMS_DB_USER,
  password: env.LMS_DB_PASSWORD,
  database: env.LMS_DB_NAME,
  waitForConnections: true,
  connectionLimit: 3,
  queueLimit: 0,
} as Parameters<typeof mysql.createPool>[0]);

/**
 * @deprecated Use lmsQuery() from backend/src/modules/lms/lms.service.ts instead.
 * This pool uses .env LMS_DB_* directly and does not respect Integration Hub credentials.
 * Will be removed once lms-integration/ module is fully retired.
 */
export async function getLmsConnection() {
  return lmsPool.getConnection();
}

/**
 * @deprecated Use lmsQuery() from backend/src/modules/lms/lms.service.ts instead.
 * This pool uses .env LMS_DB_* directly and does not respect Integration Hub credentials.
 * Will be removed once lms-integration/ module is fully retired.
 */
export async function closeLmsPool() {
  return lmsPool.end();
}
