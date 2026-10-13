/** Why is a new backend not becoming healthy? READ-ONLY: migration lock, last applied migrations, long-running queries (first 160 chars, no parameters). */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const show = async (tag: string, sql: string) => {
  try { const [rows] = await db.execute<RowDataPacket[]>(sql); for (const r of rows) console.log(`${tag} ${JSON.stringify(r)}`); if (!rows.length) console.log(`${tag} (no rows)`); }
  catch (e) { console.log(`${tag} ERROR ${e instanceof Error ? e.message : String(e)}`); }
};
(async () => {
  await show("BOOT_LOCK", "SELECT * FROM migration_lock LIMIT 5");
  await show("BOOT_LAST_MIGRATIONS", "SELECT filename, applied_at, environment, git_sha FROM schema_migrations ORDER BY applied_at DESC LIMIT 8");
  await show("BOOT_PENDING_CANDIDATES", "SELECT filename FROM schema_migrations WHERE filename IN ('migrations/2187_absconder_pay_release.sql','migrations/2188_absconder_pay_hold_placed.sql','migrations/2189_absconder_pay_hold_request_release.sql','migrations/2190_absconder_pay_release_event_seq.sql','migrations/2195_email_ticket_source.sql')");
  await show("BOOT_LONG_QUERIES", "SELECT ID id, USER user, TIME secs, STATE state, LEFT(INFO, 160) q FROM information_schema.PROCESSLIST WHERE COMMAND <> 'Sleep' AND TIME > 20 ORDER BY TIME DESC LIMIT 12");
  await show("BOOT_LOCK_WAITS", "SELECT COUNT(*) AS waiting FROM information_schema.PROCESSLIST WHERE STATE LIKE '%metadata lock%' OR STATE LIKE '%Waiting for%'");
  await show("BOOT_CONN", "SELECT COUNT(*) AS connections, SUM(COMMAND <> 'Sleep') AS active FROM information_schema.PROCESSLIST");
  // What exactly is waiting, and who holds what (sys.innodb_lock_waits and the metadata-lock wait states).
  await show("BOOT_WAITERS", "SELECT ID id, HOST host, TIME secs, STATE state, LEFT(REGEXP_REPLACE(INFO, '[[:space:]]+', ' '), 150) q FROM information_schema.PROCESSLIST WHERE STATE LIKE '%metadata lock%' OR STATE LIKE '%Waiting for%' OR STATE LIKE '%lock%' ORDER BY TIME DESC LIMIT 10");
  await show("BOOT_ROW_LOCK_WAITS", "SELECT waiting_pid, waiting_query_secs, LEFT(waiting_query, 100) AS waiting_query, blocking_pid, LEFT(blocking_query, 100) AS blocking_query, wait_age_secs FROM sys.innodb_lock_waits LIMIT 5");
  await show("BOOT_MDL", "SELECT object_schema, object_name, lock_type, lock_status, owner_thread_id FROM performance_schema.metadata_locks WHERE lock_status = 'PENDING' LIMIT 10");
  // The queries that have run longest: who runs them (client host:port), for how long, and the statement text with every literal masked.
  const [long] = await db.execute<RowDataPacket[]>("SELECT ID id, HOST host, DB db, TIME secs, STATE state, INFO FROM information_schema.PROCESSLIST WHERE COMMAND <> 'Sleep' AND TIME > 120 AND ID <> CONNECTION_ID() ORDER BY TIME DESC LIMIT 6");
  for (const r of long) {
    const text = String(r.INFO ?? r.info ?? "").replace(/'[^']*'/g, "'?'").replace(/\b\d{4,}\b/g, "N").replace(/\s+/g, " ");
    const from = text.search(/\bFROM\b/i);
    console.log("BOOT_LONG_FULL " + JSON.stringify({ id: r.id, host: String(r.host).replace(/:\d+$/, ""), secs: r.secs, state: r.state, selectCols: text.slice(0, 140), fromAndJoins: text.slice(from, from + 420), orderBy: (text.match(/ORDER BY .{0,80}/i) ?? [""])[0] }));
  }
  await new Promise((resolve) => process.stdout.write("BOOT_DONE\n", resolve));
  process.exit(0);
})();
