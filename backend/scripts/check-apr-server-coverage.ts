/**
 * Read-only: for each active apr_server_* config (the direct ViciDial servers the apr-vicidial-sync worker can read),
 * print daily row counts for a date range. Prints config keys and counts only -- never hosts or credentials.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { db } from '../src/db/mysql.js';

const from = process.argv[2] ?? '2026-09-18';
const to = process.argv[3] ?? '2026-10-01';
for (const v of [from, to]) if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('dates must be YYYY-MM-DD');

const [cfgs] = await db.execute<RowDataPacket[]>(
  `SELECT integration_key, active_status, created_at, updated_at, config_json, encrypted_credentials FROM integration_config WHERE integration_key LIKE 'apr_server_%'`,
);
console.log(`apr_server configs: ${cfgs.length} (${cfgs.filter((c) => c.active_status === 1).length} active)`);
for (const row of cfgs) {
  if (row.active_status !== 1) console.log(`${row.integration_key}: inactive (testing read-only anyway)`);
  try {
    const cfg = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json;
    const cr = typeof row.encrypted_credentials === 'string' ? JSON.parse(row.encrypted_credentials) : row.encrypted_credentials;
    const table = String(cfg.table || 'vicidial_agent_log');
    const col = String(cfg.date_column || 'event_time');
    if (!/^[A-Za-z0-9_]+$/.test(table) || !/^[A-Za-z0-9_]+$/.test(col)) throw new Error('unsafe identifier');
    const conn = await mysql.createConnection({
      host: cfg.host, port: cfg.port || 3306, user: cr.username, password: cr.password,
      database: cfg.database || 'asterisk', connectTimeout: 20000,
    });
    await conn.query('SET SESSION TRANSACTION READ ONLY');
    const [days] = await conn.execute<RowDataPacket[]>(
      `SELECT DATE(${col}) d, COUNT(*) c FROM ${table} WHERE ${col} >= ? AND ${col} < DATE_ADD(?, INTERVAL 1 DAY) GROUP BY DATE(${col}) ORDER BY d`,
      [from, to],
    );
    console.log(`${row.integration_key}: ${days.map((r) => `${String(r.d).slice(4, 10)}:${r.c}`).join(' ') || 'NO ROWS'}`);
    await conn.end();
  } catch (e) { console.log(`${row.integration_key}: ERROR ${(e as Error).message.slice(0, 120)}`); }
}
process.exit(0);
