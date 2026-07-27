import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';

export async function generateRequestReference(): Promise<string> {
  const year = new Date().getFullYear();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT COUNT(*) + 1 AS seq
       FROM report_request
       WHERE YEAR(requested_at) = ?`,
      [year]
    );
    const seq = Number((rows[0] as { seq: number }).seq);
    const ref = `RPT-${year}-${String(seq).padStart(6, '0')}`;
    await conn.commit();
    return ref;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
