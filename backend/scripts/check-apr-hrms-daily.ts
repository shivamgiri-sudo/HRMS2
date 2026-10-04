/** Read-only: HRMS `apr` table row counts per day and source since a date (aggregates only). */
import 'dotenv/config';
import type { RowDataPacket } from 'mysql2';
import { db } from '../src/db/mysql.js';

const from = process.argv[2] ?? '2026-09-01';
if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('fromDate must be YYYY-MM-DD');
const [rows] = await db.execute<RowDataPacket[]>(
  `SELECT ReportDate d, source, COUNT(*) c, COUNT(DISTINCT campaign_id) camps FROM apr WHERE ReportDate >= ? GROUP BY ReportDate, source ORDER BY ReportDate, source`,
  [from],
);
for (const r of rows) console.log(`${String(r.d).slice(0, 15)} ${r.source ?? 'null'} rows=${r.c} campaigns=${r.camps}`);
const [[mx]] = await db.execute<RowDataPacket[]>(`SELECT MAX(ReportDate) m, COUNT(*) n FROM apr`);
console.log(`MAX ReportDate=${mx.m} total=${mx.n}`);
process.exit(0);
