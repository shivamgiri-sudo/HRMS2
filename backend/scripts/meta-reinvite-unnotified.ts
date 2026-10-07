/**
 * Re-invite QUALIFIED Meta leads that never got an invite: notification_sent_at is empty, created on or
 * after the 21 Sep floor (the Sep-20 backlog was handled through another channel), and not already in
 * contact with us. Each lead goes through the normal notifyQualifiedLead flow, so it gets a fresh interview
 * slot and the approved Pinbot `interview_invitation` template (plus the usual email), and every existing
 * guard applies (closed/full requisition, Hiring Engine ownership, already notified).
 *
 *   npx tsx scripts/meta-reinvite-unnotified.ts                    # dry run: who would be invited, who is blocked and why
 *   npx tsx scripts/meta-reinvite-unnotified.ts --apply            # send
 *   npx tsx scripts/meta-reinvite-unnotified.ts --apply --limit 3  # first small batch
 *   npx tsx scripts/meta-reinvite-unnotified.ts --since 2026-09-26 # only leads created on/after this date
 *
 * "In contact" = the lead wrote to us, or an outbound WhatsApp to them was delivered/read: those are left
 * alone so nobody is invited twice. The voice bot is never started from here. Phones are shown as last 4 digits.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { notifyQualifiedLead } from "../src/modules/meta-campaign/lead-outreach.service.js";
import { requisitionClosedReason } from "../src/modules/meta-campaign/lead-screener.service.js";
import { metaOutreachBlockedByEngine } from "../src/modules/hiring-engine/he-campaign-config.service.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const numArg = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const strArg = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const limit = numArg("--limit", Number.POSITIVE_INFINITY);
const since = strArg("--since", "2026-09-21");
if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.log("--since must be YYYY-MM-DD");
  process.exit(1);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const last4 = (p: string | null) => (p ? `***${String(p).replace(/\D/g, "").slice(-4)}` : "none");

interface Row extends RowDataPacket {
  id: string;
  created_at: string;
  parsed_phone: string | null;
  parsed_email: string | null;
  requisition_id: string | null;
  requisition_code: string | null;
  branch_name: string | null;
  bmi_assessment_url: string | null;
  approval_status: string | null;
  active_status: string | number | null;
  closed_at: string | null;
  requested_headcount: number | null;
  fulfilled_headcount: number | null;
  branch_address: string | null;
  inbound: number;
  reached: number;
}

(async () => {
  console.log(`mode=${apply ? "APPLY" : "dry-run"} since=${since} limit=${limit}`);
  const [rows] = await db.execute<Row[]>(
    `SELECT ml.id, ml.created_at, ml.parsed_phone, ml.parsed_email, ml.requisition_id,
            jr.requisition_code, jr.branch_name, jr.bmi_assessment_url, jr.approval_status, jr.active_status,
            jr.closed_at, jr.requested_headcount, jr.fulfilled_headcount, bm.address AS branch_address,
            (SELECT COUNT(*) FROM meta_lead_messages m WHERE m.lead_id = ml.id AND m.direction = 'inbound') AS inbound,
            (SELECT COUNT(*) FROM meta_lead_messages m WHERE m.lead_id = ml.id AND m.direction = 'outbound'
                AND m.delivery_status IN ('delivered', 'read')) AS reached
       FROM meta_lead_raw ml
       LEFT JOIN job_requisition jr ON jr.id = ml.requisition_id
       LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
      WHERE ml.screening_result = 'qualified' AND ml.notification_sent_at IS NULL AND ml.created_at >= ?
      ORDER BY ml.created_at ASC`,
    [`${since} 00:00:00`]
  );

  const eligible: Row[] = [];
  const blocked: Record<string, number> = {};
  const note = (reason: string) => (blocked[reason] = (blocked[reason] ?? 0) + 1);
  for (const r of rows) {
    const reasons: string[] = [];
    if (!r.requisition_id) reasons.push("no requisition");
    else {
      const closed = requisitionClosedReason({
        approvalStatus: r.approval_status as never,
        activeStatus: r.active_status as never,
        closedAt: r.closed_at as never,
        requestedHeadcount: r.requested_headcount !== null ? Number(r.requested_headcount) : null,
        fulfilledHeadcount: r.fulfilled_headcount !== null ? Number(r.fulfilled_headcount) : null,
      });
      if (closed) reasons.push(`requisition closed: ${closed}`);
      if (!r.branch_address) reasons.push("branch has no address");
      if (!r.bmi_assessment_url) reasons.push("requisition has no BMI url");
    }
    if (!r.parsed_phone) reasons.push("no phone");
    if (r.inbound > 0 || r.reached > 0) reasons.push("already in contact");
    const engine = await metaOutreachBlockedByEngine(r.id).catch(() => null);
    if (engine) reasons.push("Hiring Engine owns this lead");
    if (reasons.length) note(reasons.join(" + "));
    else eligible.push(r);
    console.log(
      `LEAD ${r.id.slice(0, 8)} ${String(r.created_at).slice(0, 10)} ${r.requisition_code ?? "-"} ${r.branch_name ?? "-"} ` +
        `phone=${last4(r.parsed_phone)} email=${r.parsed_email ? "yes" : "no"} -> ${reasons.length ? "SKIP: " + reasons.join(" + ") : "INVITE"}`
    );
  }
  console.log(`SUMMARY qualifiedUnnotified=${rows.length} eligible=${eligible.length} blocked=${JSON.stringify(blocked)}`);

  if (!apply) {
    console.log("Dry run: nothing sent.");
    process.exit(0);
  }

  let invited = 0;
  let nothingSent = 0;
  let errored = 0;
  for (const r of eligible.slice(0, limit)) {
    try {
      const out = await notifyQualifiedLead(r.id, { skipVoice: true });
      if (out.succeeded.length) invited++;
      else nothingSent++;
      console.log(
        `RESULT ${r.id.slice(0, 8)} succeeded=[${out.succeeded}] failed=${JSON.stringify(out.failed).slice(0, 160)} skipped=${JSON.stringify(out.skipped).slice(0, 200)}`
      );
    } catch (e) {
      errored++;
      console.log(`ERROR ${r.id.slice(0, 8)} ${(e as Error).message.slice(0, 160)}`);
    }
    await sleep(500);
  }
  console.log(`DONE invited=${invited} nothingSent=${nothingSent} errored=${errored}`);
  process.exit(0);
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
