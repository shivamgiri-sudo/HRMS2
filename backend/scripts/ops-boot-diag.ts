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
  await new Promise((resolve) => process.stdout.write("BOOT_DONE\n", resolve));
  process.exit(0);
})();
