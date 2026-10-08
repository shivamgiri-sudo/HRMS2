/**
 * Meta lead outreach audit. READ-ONLY.
 *
 * Qualified Meta leads from the last N days (default 7) that have no notification_sent_at,
 * grouped by the reason notifyQualifiedLead would refuse or skip them.
 *
 *   npx tsx scripts/meta-outreach-audit.ts [days]
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { requisitionClosedReason } from "../src/modules/meta-campaign/lead-screener.service.js";
import type { RowDataPacket } from "mysql2";

const DAYS = Number(process.argv[2] ?? 7);
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];

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
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
