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
  await q("emails by day / status (live)", `SELECT DATE(email_sent_at) d, email_status, COUNT(*) n FROM qualified_followup WHERE mode_at_enqueue='live' AND email_sent_at >= DATE_SUB(CURDATE(), INTERVAL 4 DAY) GROUP BY d, email_status ORDER BY d`);
  await q("enrolled rows: email state (live, open)", `SELECT COALESCE(email_status,'none') es, COALESCE(wa_status,'none') ws, SUM(email_due_at <= NOW()) email_due_now, SUM(email_due_at > NOW()) email_due_later, SUM(email_due_at IS NULL) no_email_due, COUNT(*) n
      FROM qualified_followup WHERE mode_at_enqueue='live' AND stopped_reason IS NULL AND journey_state='enrolled' GROUP BY es, ws ORDER BY n DESC LIMIT 12`);
  await q("earliest email_due among unsent", `SELECT MIN(email_due_at) earliest, MAX(email_due_at) latest, SUM(email_due_at<=NOW()) due_now FROM qualified_followup WHERE mode_at_enqueue='live' AND stopped_reason IS NULL AND email_sent_at IS NULL AND email_status IS NULL`);
  await q("BY SOURCE (live, open rows): email / WhatsApp / call progress", `SELECT source_type,
      COUNT(*) total, SUM(email_sent_at IS NOT NULL) email_sent, SUM(email_sent_at IS NULL AND email_status IS NULL) email_unsent,
      SUM(wa_sent_at IS NOT NULL) wa_sent, SUM(wa_status IS NULL AND wa_due_at IS NOT NULL AND wa_due_at <= NOW()) wa_due_now,
      SUM(wa_status IS NULL AND wa_due_at > NOW()) wa_due_later, SUM(wa_status IS NULL AND wa_due_at IS NULL) wa_no_due,
      SUM(wa_status = 'failed') wa_failed, SUM(wa_status = 'sending') wa_sending,
      MIN(CASE WHEN wa_status IS NULL THEN wa_due_at END) wa_earliest_due, MAX(CASE WHEN wa_status IS NULL THEN wa_due_at END) wa_latest_due
     FROM qualified_followup WHERE mode_at_enqueue='live' AND stopped_reason IS NULL GROUP BY source_type`);
  await q("old-meta journeys: state x wa", `SELECT journey_state, COALESCE(held_reason,'-') held, wa_status IS NOT NULL wa_touched, COUNT(*) n
      FROM qualified_followup WHERE mode_at_enqueue='live' AND source_type='meta_old' AND stopped_reason IS NULL GROUP BY 1,2,3 ORDER BY n DESC LIMIT 12`);
  await q("old-meta enrolled by qualified_at day", `SELECT DATE(qualified_at) d, COUNT(*) n, SUM(email_sent_at IS NOT NULL) emailed FROM qualified_followup
      WHERE mode_at_enqueue='live' AND source_type='meta_old' GROUP BY d ORDER BY d DESC LIMIT 10`);
  await q("guard skips last 2 days (he_lead_event followup_skip) by reason", `SELECT detail, COUNT(*) n FROM he_lead_event WHERE event_type='followup_skip' AND created_at >= DATE_SUB(NOW(), INTERVAL 2 DAY) GROUP BY detail ORDER BY n DESC LIMIT 12`);
  await q("calls stamped by day", `SELECT DATE(called_at) d, COUNT(*) n FROM qualified_followup WHERE called_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) GROUP BY d ORDER BY d`);
  await q("bot-call results by day (he_call)", `SELECT DATE(created_at) d, COUNT(*) n FROM he_call WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) GROUP BY d ORDER BY d`);
  await db.end?.();
})();
