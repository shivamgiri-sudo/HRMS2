/**
 * Calling-file and result audit for the unified follow-up. STRICTLY READ-ONLY: counts only, no names or numbers.
 *   - every calling-file batch of the last 4 days (slot, rows, status, portal outcome)
 *   - live rows by call_state, and why rows that should be called are not in a file yet
 *   - results: rows stamped called, results by day, the last portal pull
 *
 *   npx tsx scripts/followup-callfile-audit.ts
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const q = async (label: string, sql: string, params: unknown[] = []) => {
  try {
    const [r] = await db.execute<RowDataPacket[]>(sql, params as never[]);
    console.log(`\n== ${label}`);
    for (const row of r) console.log(JSON.stringify(row));
    if (!r.length) console.log("(no rows)");
  } catch (e) { console.log(`\n== ${label}: FAILED ${(e as Error).message.slice(0, 160)}`); }
};

(async () => {
  console.log("NOW", new Date().toISOString());
  await q("batches (last 4 days)", `SELECT slot_key, status, row_count, created_at, JSON_EXTRACT(summary,'$.portal.ok') AS portal_ok, JSON_EXTRACT(summary,'$.portal.error') AS portal_err
       FROM qualified_followup_call_batch WHERE created_at >= DATE_SUB(NOW(), INTERVAL 4 DAY) ORDER BY created_at`);
  await q("live rows by call_state", `SELECT call_state, COUNT(*) n, SUM(call_file_batch_id IS NOT NULL) in_batch, SUM(stopped_reason IS NOT NULL) stopped FROM qualified_followup WHERE mode_at_enqueue='live' GROUP BY call_state`);
  await q("live pending rows: why not yet called", `SELECT
      SUM(stopped_reason IS NULL AND call_state='pending') pending_open,
      SUM(stopped_reason IS NULL AND call_state='pending' AND call_due_at IS NULL) no_due,
      SUM(stopped_reason IS NULL AND call_state='pending' AND call_due_at > NOW()) due_future,
      SUM(stopped_reason IS NULL AND call_state='pending' AND call_due_at <= NOW()) due_now,
      SUM(stopped_reason IS NULL AND call_state='pending' AND call_due_at <= NOW() AND wa_status IS NULL) due_now_wa_not_sent,
      SUM(stopped_reason IS NULL AND call_state='pending' AND wa_sent_at IS NOT NULL) wa_sent,
      MIN(CASE WHEN stopped_reason IS NULL AND call_state='pending' THEN call_due_at END) earliest_due,
      MAX(CASE WHEN stopped_reason IS NULL AND call_state='pending' THEN call_due_at END) latest_due
     FROM qualified_followup WHERE mode_at_enqueue='live'`);
  await q("held / stopped reasons (live)", `SELECT COALESCE(stopped_reason, held_reason, '-') reason, journey_state, COUNT(*) n FROM qualified_followup WHERE mode_at_enqueue='live' AND call_state IN ('pending','in_file') GROUP BY 1,2 ORDER BY n DESC LIMIT 15`);
  await q("sends by day (live)", `SELECT DATE(wa_sent_at) d, COUNT(*) wa FROM qualified_followup WHERE mode_at_enqueue='live' AND wa_sent_at >= DATE_SUB(CURDATE(), INTERVAL 4 DAY) GROUP BY d ORDER BY d`);
  await q("calls stamped by day", `SELECT DATE(called_at) d, COUNT(*) n FROM qualified_followup WHERE called_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) GROUP BY d ORDER BY d`);
  await q("bot-call results by day (he_call)", `SELECT DATE(created_at) d, COUNT(*) n FROM he_call WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) GROUP BY d ORDER BY d`);
  await db.end?.();
})();
