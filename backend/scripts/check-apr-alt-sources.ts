/** Read-only: day counts 18 Sep - 2 Oct in HRMS tables that could stand in for the missing APR days. Counts only. */
import 'dotenv/config';
import type { RowDataPacket } from 'mysql2';
import { db } from '../src/db/mysql.js';

const run = async (label: string, sql: string) => {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(sql);
    console.log(`${label}: ${rows.map((r) => `${String(r.d).slice(0, 10).slice(-5)}:${r.c}`).join(' ') || 'NO ROWS'}`);
  } catch (e) { console.log(`${label}: ERROR ${(e as Error).message.slice(0, 120)}`); }
};
const W = (col: string) => `${col} >= '2026-09-18' AND ${col} < '2026-10-03'`;
await run('dialer_session_log rows/day', `SELECT session_date d, COUNT(*) c FROM dialer_session_log WHERE ${W('session_date')} GROUP BY session_date ORDER BY d`);
await run('dialer_session_log keys', `SELECT integration_key d, COUNT(*) c FROM dialer_session_log WHERE session_date BETWEEN '2026-09-21' AND '2026-09-29' GROUP BY integration_key`);
await run('attendance_productive_day rows/day', `SELECT work_date d, COUNT(*) c FROM attendance_productive_day WHERE ${W('work_date')} GROUP BY work_date ORDER BY d`);
await run('attendance_productive_contribution feed/day (21-29)', `SELECT CONCAT(feed,' ',work_date) d, COUNT(*) c FROM attendance_productive_contribution WHERE work_date BETWEEN '2026-09-21' AND '2026-09-29' GROUP BY feed, work_date ORDER BY work_date, feed`);
process.exit(0);
