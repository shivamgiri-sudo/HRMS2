/**
 * Outbound email volume audit. STRICTLY READ-ONLY.
 *
 * Gmail's daily sending limit is shared by every sender on the one SMTP account, so the question is
 * "which sender / template burns the quota". Counts per IST day and per sender over the last N days
 * (default 7) from every log table that records an email send, plus the failure and retry shape.
 *
 *   npx tsx scripts/email-volume-audit.ts [days]
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const DAYS = Number(process.argv[2] ?? 7);
const IST = (col: string) => `DATE(DATE_ADD(${col}, INTERVAL 330 MINUTE))`;
const q = async (label: string, sql: string, p: unknown[] = []) => {
  try {
    const [r] = await db.execute<RowDataPacket[]>(sql, p);
    console.log(`\n== ${label} (${r.length})`);
    for (const row of r.slice(0, 60)) console.log(JSON.stringify(row));
  } catch (e) { console.log(`\n== ${label}: FAILED ${(e as Error).message.slice(0, 200)}`); }
};

(async () => {
  console.log(`email volume audit, last ${DAYS} days (IST days)`);

  await q("he_message email out: per day x status", `SELECT ${IST("created_at")} d, delivery_status, COUNT(*) n
      FROM he_message WHERE channel = 'email' AND direction = 'out' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY d, delivery_status ORDER BY d DESC, n DESC`, [DAYS]);
  await q("he_message email out: per template_key x status (period)", `SELECT template_key, delivery_status, COUNT(*) n, COUNT(DISTINCT lead_id) leads
      FROM he_message WHERE channel = 'email' AND direction = 'out' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY template_key, delivery_status ORDER BY n DESC`, [DAYS]);
  await q("he_message email: top error messages", `SELECT LEFT(error_message, 90) msg, COUNT(*) n FROM he_message
      WHERE channel = 'email' AND delivery_status = 'failed' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY msg ORDER BY n DESC`, [DAYS]);
  await q("he_message email: leads mailed more than 3 times in the period", `SELECT n, COUNT(*) leads FROM (
        SELECT lead_id, COUNT(*) n FROM he_message WHERE channel = 'email' AND direction = 'out' AND delivery_status <> 'failed'
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY lead_id HAVING n > 3) t GROUP BY n ORDER BY n DESC`, [DAYS]);
  await q("he_message email: same lead+template sent more than once (duplicates)", `SELECT template_key, COUNT(*) dup_leads, SUM(n - 1) extra_mails FROM (
        SELECT lead_id, template_key, COUNT(*) n FROM he_message WHERE channel = 'email' AND direction = 'out' AND delivery_status <> 'failed'
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY lead_id, template_key HAVING n > 1) t GROUP BY template_key ORDER BY extra_mails DESC`, [DAYS]);
  await q("he_message email: per hour of IST day (period)", `SELECT HOUR(DATE_ADD(created_at, INTERVAL 330 MINUTE)) h, COUNT(*) n
      FROM he_message WHERE channel = 'email' AND direction = 'out' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY h ORDER BY h`, [DAYS]);

  await q("qualified_followup email_status (period, by enqueue)", `SELECT email_status, mode_at_enqueue, source_type, COUNT(*) n
      FROM qualified_followup WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY email_status, mode_at_enqueue, source_type ORDER BY n DESC`, [DAYS]);
  await q("qualified_followup email errors", `SELECT LEFT(email_error, 80) msg, COUNT(*) n FROM qualified_followup
      WHERE email_error IS NOT NULL AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY msg ORDER BY n DESC LIMIT 20`, [DAYS]);

  await q("dispatch_log email: per day x status", `SELECT ${IST("created_at")} d, status, COUNT(*) n, SUM(COALESCE(recipient_count,1)) recipients
      FROM dispatch_log WHERE channel = 'email' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY d, status ORDER BY d DESC, n DESC`, [DAYS]);
  await q("dispatch_log email: per template (period)", `SELECT template_name, status, COUNT(*) n FROM dispatch_log
      WHERE channel = 'email' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY template_name, status ORDER BY n DESC LIMIT 40`, [DAYS]);
  await q("dispatch_log email: top errors", `SELECT LEFT(error_message, 90) msg, COUNT(*) n FROM dispatch_log
      WHERE channel = 'email' AND status = 'failed' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY msg ORDER BY n DESC LIMIT 10`, [DAYS]);

  await q("notification_log email: per day x status", `SELECT ${IST("created_at")} d, status, COUNT(*) n FROM notification_log
      WHERE channel = 'email' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY d, status ORDER BY d DESC, n DESC`, [DAYS]);
  await q("notification_log email: per template (period)", `SELECT template_code, status, COUNT(*) n FROM notification_log
      WHERE channel = 'email' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY template_code, status ORDER BY n DESC LIMIT 40`, [DAYS]);

  await q("ats_email_log: per type x status (period)", `SELECT email_type, status, COUNT(*) n FROM ats_email_log
      WHERE sent_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY email_type, status ORDER BY n DESC`, [DAYS]);
  await q("ats_command_email_log: per type x status (period)", `SELECT email_type, status, COUNT(*) n FROM ats_command_email_log
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY email_type, status ORDER BY n DESC`, [DAYS]);

  await q("mis_email_schedule: active schedules", `SELECT dashboard_key, frequency, COUNT(*) n FROM mis_email_schedule GROUP BY dashboard_key, frequency ORDER BY n DESC LIMIT 40`);
  await q("wfm_roster_notification_log (period)", `SELECT ${IST("created_at")} d, COUNT(*) n FROM wfm_roster_notification_log
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY d ORDER BY d DESC`, [DAYS]);

  await db.end?.();
})();
