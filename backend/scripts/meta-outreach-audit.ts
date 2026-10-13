/**
 * Meta lead outreach audit. READ-ONLY.
 *
 * Qualified Meta leads from the last N days (default 7) that have no notification_sent_at,
 * grouped by the reason notifyQualifiedLead would refuse or skip them, and by the state of
 * their follow-up row (the automatic path enrols them there instead of sending).
 *
 *   npx tsx scripts/meta-outreach-audit.ts [days]
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { requisitionClosedReason } from "../src/modules/meta-campaign/lead-screener.service.js";
import { loadFollowupSwitches } from "../src/modules/hiring-engine/qualified-followup.policy.js";
import type { RowDataPacket } from "mysql2";

const DAYS = Number(process.argv[2] ?? 7);
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const safe = async (label: string, fn: () => Promise<void>) => {
  try { await fn(); } catch (e) { console.log(`${label}: FAILED ${(e as Error).message}`); }
};

(async () => {
  const rows = await q(
    `SELECT ml.id, ml.created_at, ml.parsed_phone, ml.parsed_email, ml.requisition_id, ml.notification_sent_at,
            jr.branch_name, jr.bmi_assessment_url, jr.approval_status, jr.active_status, jr.closed_at,
            jr.requested_headcount, jr.fulfilled_headcount, bm.address AS branch_address
       FROM meta_lead_raw ml
       LEFT JOIN job_requisition jr ON jr.id = ml.requisition_id
       LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
      WHERE ml.screening_result = 'qualified' AND ml.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [DAYS]
  );

  const total = rows.length;
  const notified = (rows as any[]).filter((r) => r.notification_sent_at).length;
  console.log(`qualified leads, last ${DAYS}d: ${total}; notified: ${notified}; not notified: ${total - notified}`);

  const buckets: Record<string, number> = {};
  const oldestPending: Record<string, string> = {};
  for (const r of (rows as any[]).filter((x) => !x.notification_sent_at)) {
    const reasons: string[] = [];
    if (!r.requisition_id) reasons.push("no requisition linked");
    else {
      const closed = requisitionClosedReason({
        approvalStatus: r.approval_status, activeStatus: r.active_status, closedAt: r.closed_at,
        requestedHeadcount: r.requested_headcount !== null ? Number(r.requested_headcount) : null,
        fulfilledHeadcount: r.fulfilled_headcount !== null ? Number(r.fulfilled_headcount) : null,
      });
      if (closed) reasons.push(`requisition closed: ${closed}`);
      if (!r.branch_address) reasons.push("branch has no address");
      if (!r.bmi_assessment_url) reasons.push("requisition has no BMI url");
    }
    if (!r.parsed_phone) reasons.push("no phone");
    if (!r.parsed_email) reasons.push("no email");
    const key = reasons.length ? reasons.join(" + ") : "no data blocker (cron/provider/timing)";
    buckets[key] = (buckets[key] ?? 0) + 1;
    const ts = new Date(r.created_at).toISOString();
    if (!oldestPending[key] || ts < oldestPending[key]) oldestPending[key] = ts;
  }
  console.table(Object.entries(buckets).map(([reason, count]) => ({ reason, count, oldest: oldestPending[reason] })));

  const reqs = await q(
    `SELECT jr.requisition_code, jr.branch_name, jr.designation_name, jr.approval_status, jr.active_status,
            jr.closed_at, jr.requested_headcount, jr.fulfilled_headcount, jr.created_at,
            JSON_EXTRACT(jr.meta_screening_config, '$.auto_notify') AS auto_notify,
            COUNT(*) pending_leads, MIN(ml.created_at) first_lead, MAX(ml.created_at) last_lead
       FROM meta_lead_raw ml JOIN job_requisition jr ON jr.id = ml.requisition_id
      WHERE ml.screening_result = 'qualified' AND ml.notification_sent_at IS NULL
        AND ml.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY jr.id ORDER BY pending_leads DESC`, [DAYS]);
  console.log("\nrequisitions behind the un-notified qualified leads:");
  console.table(reqs);

  const days = await q(
    `SELECT DATE(created_at) d, COUNT(*) qualified, SUM(notification_sent_at IS NOT NULL) notified
       FROM meta_lead_raw WHERE screening_result='qualified' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE(created_at) ORDER BY d`, [DAYS]);
  console.table(days);

  await safe("switches", async () => {
    const s = await loadFollowupSwitches();
    console.log("\nfollow-up switches:", JSON.stringify({
      mode: s.mode, ceiling: s.ceiling, sourceModes: s.sourceModes, paused: [...s.pausedSources], killSwitch: s.killSwitch,
      sendsPaused: s.sendsPaused, waDailyMax: s.waDailyMax, testMode: s.testMode, inboundGate: s.inboundGate,
    }));
  });

  await safe("follow-up state of un-notified leads", async () => {
    const st = await q(
      `SELECT COALESCE(qf.source_type, '(no follow-up row)') source, COALESCE(qf.mode_at_enqueue, '-') mode,
              COALESCE(qf.journey_state, '-') journey, COALESCE(qf.held_reason, '-') held, COALESCE(qf.owner, '-') owner,
              COALESCE(qf.email_status, 'NULL') email, COALESCE(qf.wa_status, 'NULL') wa, COALESCE(qf.call_state, '-') call_state,
              COALESCE(qf.stopped_reason, '-') stopped, COUNT(*) n,
              MIN(qf.email_due_at) min_email_due, MIN(qf.wa_due_at) min_wa_due
         FROM meta_lead_raw ml
         LEFT JOIN qualified_followup qf ON qf.meta_lead_id = ml.id COLLATE utf8mb4_unicode_ci
        WHERE ml.screening_result = 'qualified' AND ml.notification_sent_at IS NULL
          AND ml.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY 1,2,3,4,5,6,7,8,9 ORDER BY n DESC LIMIT 40`, [DAYS]);
    console.log("\nfollow-up state of the un-notified qualified leads:");
    console.table(st);
  });

  await safe("errors", async () => {
    const er = await q(
      `SELECT LEFT(COALESCE(qf.email_error, '-'), 90) email_error, LEFT(COALESCE(qf.wa_error, '-'), 90) wa_error, COUNT(*) n
         FROM meta_lead_raw ml JOIN qualified_followup qf ON qf.meta_lead_id = ml.id COLLATE utf8mb4_unicode_ci
        WHERE ml.screening_result = 'qualified' AND ml.notification_sent_at IS NULL
          AND ml.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY 1,2 ORDER BY n DESC LIMIT 20`, [DAYS]);
    console.log("\nerrors on those follow-up rows:");
    console.table(er);
  });

  await safe("sends per day", async () => {
    const sd = await q(
      `SELECT d, source_type, SUM(kind='email') email_sent, SUM(kind='wa') wa_sent FROM (
          SELECT DATE(email_sent_at) d, source_type, 'email' kind FROM qualified_followup WHERE email_sent_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
          UNION ALL
          SELECT DATE(wa_sent_at) d, source_type, 'wa' kind FROM qualified_followup WHERE wa_sent_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        ) x GROUP BY d, source_type ORDER BY d, source_type`, [DAYS, DAYS]);
    console.log("\nfollow-up sends per day by source (email shares one Gmail quota, WhatsApp one daily budget):");
    console.table(sd);
    const ef = await q(
      `SELECT DATE(updated_at) d, source_type, COUNT(*) n FROM qualified_followup
        WHERE email_error LIKE '%sending limit%' AND updated_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        GROUP BY 1,2 ORDER BY 1,2`, [DAYS]);
    console.log("\nrows whose email hit the Gmail daily sending limit:");
    console.table(ef);
  });

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
