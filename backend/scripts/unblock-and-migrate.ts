/**
 * Applies the pending startup migrations once, outside a boot. First stops the long reads (SELECT, 60 s or more) that touch the tables those
 * migrations alter, which otherwise make them fail with "Lock wait timeout" and keep every new build from starting (2026-10-13: 2187 and
 * 2189 on exit_request behind 15 to 30 minute employee-report reads). Reads only are stopped, never writes. Dry run unless APPLY=1.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { runPendingMigrations } from "../src/db/runPendingMigrations.js";

const TABLES = ["exit_request", "absconder_pay_release_event", "molecular_email_ticket"];
(async () => {
  const apply = process.env.APPLY === "1";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ID, USER, TIME, LEFT(REGEXP_REPLACE(INFO, '\\\\s+', ' '), 120) q FROM information_schema.PROCESSLIST
      WHERE COMMAND = 'Query' AND TIME >= 60 AND ID <> CONNECTION_ID() AND (INFO LIKE 'SELECT%' OR INFO LIKE '(SELECT%' OR INFO LIKE 'WITH%')
        AND (${TABLES.map(() => "INFO LIKE ?").join(" OR ")})`, TABLES.map((t) => `%${t}%`));
  console.log(`== long reads on ${TABLES.join(", ")}: ${rows.length}`);
  try {
    const [t] = await db.execute<RowDataPacket[]>(
      `SELECT t.trx_mysql_thread_id id, TIMESTAMPDIFF(SECOND, t.trx_started, NOW()) age_s, t.trx_state, t.trx_tables_locked, t.trx_rows_locked, p.USER, p.COMMAND, p.TIME,
              LEFT(COALESCE(t.trx_query, p.INFO, ''), 120) q
         FROM information_schema.INNODB_TRX t LEFT JOIN information_schema.PROCESSLIST p ON p.ID = t.trx_mysql_thread_id ORDER BY t.trx_started LIMIT 15`);
    console.log(`== open transactions: ${t.length}`);
    for (const x of t) console.log(JSON.stringify(x));
  } catch (e) { console.log("open transactions unavailable:", (e as Error).message.slice(0, 120)); }
  for (const r of rows) console.log(`${r.ID} ${r.USER} ${r.TIME}s | ${r.q}`);
  if (!apply) { console.log("DRY RUN: nothing stopped, no migration run"); await db.end?.(); return; }
  for (const r of rows) {
    try { await db.query(`KILL QUERY ${Number(r.ID)}`); console.log("stopped", r.ID); } catch (e) { console.log("could not stop", r.ID, (e as Error).message.slice(0, 120)); }
  }
  const health = await runPendingMigrations();
  console.log("migrations:", JSON.stringify({ status: health.status, applied: health.applied, failed: health.failed }).slice(0, 900));
  const [c] = await db.execute<RowDataPacket[]>("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_request' AND COLUMN_NAME = 'pay_release_route'");
  console.log("exit_request.pay_release_route present:", Number(c[0].n) === 1);
  await db.end?.();
  process.exit(0);
})();
