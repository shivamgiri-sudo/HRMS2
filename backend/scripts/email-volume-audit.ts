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


  await q("dispatch_log email: per event_code x status (period)", `SELECT event_code, status, COUNT(*) envelopes, SUM(COALESCE(recipient_count,1)) recipients
      FROM dispatch_log WHERE channel = 'email' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY event_code, status ORDER BY recipients DESC LIMIT 40`, [DAYS]);
  await q("dispatch_log email: top recipient lists (period)", `SELECT LEFT(recipient_contact, 70) rc, COUNT(*) n FROM dispatch_log
      WHERE channel = 'email' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY rc ORDER BY n DESC LIMIT 15`, [DAYS]);
  await q("dispatch_log email: top subjects (period)", `SELECT LEFT(subject, 70) s, COUNT(*) n FROM dispatch_log
      WHERE channel = 'email' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY s ORDER BY n DESC LIMIT 15`, [DAYS]);
  await q("invite email recipients who also got a WhatsApp (period)", `SELECT
        COUNT(DISTINCT e.lead_id) email_leads,
        COUNT(DISTINCT CASE WHEN w.id IS NOT NULL THEN e.lead_id END) also_wa_sent,
        COUNT(DISTINCT CASE WHEN w.delivery_status IN ('delivered','read') THEN e.lead_id END) wa_delivered_or_read
      FROM he_message e LEFT JOIN he_message w ON w.lead_id = e.lead_id AND w.channel = 'whatsapp' AND w.direction = 'out' AND w.delivery_status <> 'failed'
        AND w.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      WHERE e.channel = 'email' AND e.direction = 'out' AND e.template_key = 'he_walkin_invite_email' AND e.delivery_status = 'sent' AND e.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`, [DAYS, DAYS]);
  await q("invite email: opened/answered link? (leads with an inbound or event after invite)", `SELECT COUNT(DISTINCT e.lead_id) invited, COUNT(DISTINCT i.lead_id) replied_in
      FROM he_message e LEFT JOIN he_message i ON i.lead_id = e.lead_id AND i.direction = 'in' AND i.created_at > e.created_at
      WHERE e.channel = 'email' AND e.direction = 'out' AND e.template_key = 'he_walkin_invite_email' AND e.delivery_status = 'sent' AND e.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`, [DAYS]);
  await q("ats_email_log: recruiter_notification distinct recipients and per candidate", `SELECT COUNT(*) n, COUNT(DISTINCT sent_to) recipients, COUNT(DISTINCT candidate_id) candidates
      FROM ats_email_log WHERE email_type = 'recruiter_notification' AND sent_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`, [DAYS]);
  await q("ats_email_log: empty type per day", `SELECT ${IST("sent_at")} d, status, COUNT(*) n FROM ats_email_log WHERE email_type = '' AND sent_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY d, status ORDER BY d DESC`, [DAYS]);
  await q("ats_email_log: top errors", `SELECT LEFT(error_message, 90) msg, COUNT(*) n FROM ats_email_log WHERE status = 'failed' AND sent_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY msg ORDER BY n DESC LIMIT 8`, [DAYS]);
  await q("report email deliveries (period)", `SELECT status, COUNT(*) n FROM report_request WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY status`, [DAYS]);

  // Which mailbox actually sent: nodemailer builds the Message-ID domain from the From address.
  await q("he_message email out last 24h: Message-ID domain x status", `SELECT SUBSTRING_INDEX(REPLACE(provider_message_id, '>', ''), '@', -1) msgid_domain, delivery_status, COUNT(*) n, MAX(created_at) last_at
      FROM he_message WHERE channel = 'email' AND direction = 'out' AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
      GROUP BY msgid_domain, delivery_status ORDER BY last_at DESC`);
  await q("he_message email out: last 15 (newest first)", `SELECT created_at, template_key, delivery_status, SUBSTRING_INDEX(REPLACE(provider_message_id, '>', ''), '@', -1) msgid_domain, LEFT(error_message, 70) err
      FROM he_message WHERE channel = 'email' AND direction = 'out' ORDER BY created_at DESC LIMIT 15`);
  await q("qualified_followup email, last 3h: status x error", `SELECT email_status, LEFT(email_error, 40) err, COUNT(*) n FROM qualified_followup
      WHERE updated_at >= DATE_SUB(NOW(), INTERVAL 3 HOUR) GROUP BY email_status, err ORDER BY n DESC LIMIT 20`);
  await q("ats_email_log last 24h: status x error", `SELECT status, LEFT(error_message, 60) err, COUNT(*) n, MAX(sent_at) last_at FROM ats_email_log
      WHERE sent_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) GROUP BY status, err ORDER BY last_at DESC LIMIT 10`);

  await db.end?.();
})();
