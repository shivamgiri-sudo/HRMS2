import mysql from 'mysql2/promise';

const lmsPool = mysql.createPool({
  host: process.env.LMS_DB_HOST || '115.241.59.220',
  user: process.env.LMS_DB_USER || 'shivam_user',
  password: process.env.LMS_DB_PASSWORD || 'qwersdfg!@#hjk',
  database: 'mcn_lms',
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
