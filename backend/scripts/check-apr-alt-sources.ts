/** Read-only: day counts 18 Sep - 2 Oct in other copies that could stand in for the missing APR days. Counts only. */
import 'dotenv/config';
import type { RowDataPacket } from 'mysql2';
import { db } from '../src/db/mysql.js';
import { dialerQuery } from '../src/db/dialerDb.js';

const line = (rows: RowDataPacket[]) => rows.map((r) => `${String(r.d).slice(4, 10)}:${r.c}`).join(' ') || 'NO ROWS';
const run = async (label: string, f: () => Promise<RowDataPacket[]>) => {
  try { console.log(`${label}: ${line(await f())}`); } catch (e) { console.log(`${label}: ERROR ${(e as Error).message.slice(0, 120)}`); }
};
const F = '2026-09-18', T = '2026-10-03';

await run('dialer cdr_ob_25 calls/day', () => dialerQuery<RowDataPacket>(`SELECT DATE(CallDate) d, COUNT(*) c FROM cdr_ob_25 WHERE CallDate >= ? AND CallDate < ? GROUP BY DATE(CallDate) ORDER BY d`, [F, T]));
await run('dialer cdr_in_10_4 calls/day', () => dialerQuery<RowDataPacket>(`SELECT DATE(CallDate) d, COUNT(*) c FROM cdr_in_10_4 WHERE CallDate >= ? AND CallDate < ? GROUP BY DATE(CallDate) ORDER BY d`, [F, T]));
await run('hrms integration_call_daily rows/day', async () => (await db.execute<RowDataPacket[]>(`SELECT activity_date d, COUNT(*) c FROM integration_call_daily WHERE activity_date >= ? AND activity_date < ? GROUP BY activity_date ORDER BY d`, [F, T]))[0]);
await run('hrms integration_call_daily by key', async () => (await db.execute<RowDataPacket[]>(`SELECT CONCAT(integration_key,'/',source_table) d, COUNT(*) c FROM integration_call_daily WHERE activity_date >= '2026-09-21' AND activity_date <= '2026-09-29' GROUP BY integration_key, source_table`))[0]);
await run('hrms kpi_score source=dialer rows/day', async () => (await db.execute<RowDataPacket[]>(`SELECT score_date d, COUNT(*) c FROM kpi_score WHERE source='dialer' AND score_date >= ? AND score_date < ? GROUP BY score_date ORDER BY d`, [F, T]))[0]);
process.exit(0);
