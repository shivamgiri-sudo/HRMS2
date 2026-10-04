/**
 * Read-only: per-day row counts and last event_time for each dialer APR table, to see which one
 * stopped receiving data. Usage: tsx scripts/check-apr-table-freshness.ts [fromDate=2026-09-01]
 */
import 'dotenv/config';
import type { RowDataPacket } from 'mysql2';
import { dialerQuery } from '../src/db/dialerDb.js';
import { APR_DIALER_AGENT_LOG_TABLES } from '../src/modules/kpi/performance-apr-source-reader.js';

const from = process.argv[2] ?? '2026-09-01';
if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('fromDate must be YYYY-MM-DD');

for (const table of APR_DIALER_AGENT_LOG_TABLES) {
  try {
    const [span] = await dialerQuery<RowDataPacket>(
      `SELECT MIN(event_time) AS first_ts, MAX(event_time) AS last_ts, COUNT(*) AS total FROM ${table}`,
    );
    console.log(`\n== ${table}: first=${span.first_ts} last=${span.last_ts} total=${span.total}`);
    const days = await dialerQuery<RowDataPacket>(
      `SELECT DATE(event_time) AS d, COUNT(*) AS c FROM ${table} WHERE event_time >= ? GROUP BY DATE(event_time) ORDER BY d`,
      [from],
    );
    console.log(days.map((r) => `${String(r.d).slice(0, 10)}:${r.c}`).join(' '));
  } catch (e) {
    console.log(`\n== ${table}: ERROR ${(e as Error).message}`);
  }
}
process.exit(0);
