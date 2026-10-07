import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { requisitionClosedReason } from "../meta-campaign/lead-screener.service.js";
import type { RowTag } from "./qualified-followup.policy.js";
import { decideStop, SENDING_STALE_MIN, type StopReason } from "./qualified-followup.rules.js";

const C = "COLLATE utf8mb4_unicode_ci";

// Collects facts only; every decision is made by decideStop.
function factsSql(limit: number): string {
  return `SELECT qf.id, qf.mobile10, qf.email,
       (SELECT hl.status FROM he_lead hl WHERE hl.mobile10 = qf.mobile10 ${C}
         ORDER BY (hl.status = 'opted_out') DESC, (hl.status = 'joined') DESC LIMIT 1) AS lead_status,
       EXISTS (SELECT 1 FROM he_consent hc JOIN he_lead hl2 ON hl2.id = hc.lead_id
                WHERE hl2.mobile10 = qf.mobile10 ${C} AND hc.consent_type = 'whatsapp_contact' AND hc.revoked_at IS NOT NULL) AS consent_revoked,
       EXISTS (SELECT 1 FROM he_message hm WHERE hm.mobile10 = qf.mobile10 ${C} AND hm.direction = 'in' AND hm.created_at > qf.qualified_at) AS he_replied,
       EXISTS (SELECT 1 FROM meta_lead_messages mm WHERE mm.lead_id = qf.meta_lead_id AND mm.direction = 'inbound' AND mm.created_at > qf.qualified_at) AS meta_replied,
       ac.current_stage AS ats_stage,
       jr.id AS jr_id, jr.approval_status, jr.active_status, jr.closed_at, jr.requested_headcount, jr.fulfilled_headcount
  FROM qualified_followup qf
  LEFT JOIN job_requisition jr ON jr.id = qf.requisition_id
  LEFT JOIN ats_candidate ac ON ac.id = qf.ats_candidate_id
 WHERE qf.stopped_reason IS NULL AND qf.mode_at_enqueue = ?
 ORDER BY qf.qualified_at
 LIMIT ${Math.max(1, Math.floor(limit))}`;
}

export async function runStopChecks(tag: RowTag, limit = 500): Promise<{ checked: number; stopped: Partial<Record<StopReason, number>> }> {
  const [rows] = await db.execute<RowDataPacket[]>(factsSql(limit), [tag]);
  const stopped: Partial<Record<StopReason, number>> = {};
  for (const r of rows) {
    const stage = String(r.ats_stage ?? "").toLowerCase();
    const reason = decideStop({
      optedOut: r.lead_status === "opted_out" || Number(r.consent_revoked) === 1,
      repliedSinceQualified: Number(r.he_replied) === 1 || Number(r.meta_replied) === 1,
      requisitionClosed: r.jr_id == null ? null : requisitionClosedReason({
        approvalStatus: r.approval_status ?? null,
        activeStatus: r.active_status ?? null,
        closedAt: r.closed_at ?? null,
        requestedHeadcount: r.requested_headcount != null ? Number(r.requested_headcount) : null,
        fulfilledHeadcount: r.fulfilled_headcount != null ? Number(r.fulfilled_headcount) : null,
      }),
      joined: r.lead_status === "joined" || stage === "joined" || stage === "payroll_validated",
      hasMobile: /^[6-9][0-9]{9}$/.test(String(r.mobile10 ?? "")),
      hasEmail: !!String(r.email ?? "").trim(),
    });
    if (!reason) continue;
    await db.execute(
      "UPDATE qualified_followup SET stopped_reason = ?, stopped_at = NOW(), call_state = IF(call_state = 'pending', 'skipped', call_state) WHERE id = ? AND stopped_reason IS NULL",
      [reason, r.id]);
    stopped[reason] = (stopped[reason] ?? 0) + 1;
  }
  if (Object.keys(stopped).length) logger.info({ tag, checked: rows.length, stopped }, "[qualified-followup] stop checks");
  return { checked: rows.length, stopped };
}

export async function syncWaReceipts(tag: RowTag): Promise<number> {
  const [res] = await db.execute<any>(
    `UPDATE qualified_followup qf JOIN he_message hm ON hm.id = qf.wa_message_id
        SET qf.wa_status = 'failed', qf.wa_error = COALESCE(LEFT(hm.error_message, 255), 'delivery failed')
      WHERE qf.mode_at_enqueue = ? AND qf.wa_status IN ('sent', 'test_sent') AND hm.delivery_status = 'failed'`,
    [tag]);
  return Number(res?.affectedRows ?? 0);
}

// A claim left in 'sending' means the process died between the provider call and the status write; the outcome is unknown,
// so it becomes terminal 'failed' (attempts untouched, never picked up by the retry path).
export async function expireStaleClaims(tag: RowTag, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - SENDING_STALE_MIN * 60_000);
  const err = "outcome unknown (process stopped mid-send)";
  let n = 0;
  for (const [status, error] of [["email_status", "email_error"], ["wa_status", "wa_error"]] as const) {
    const [res] = await db.execute<any>(
      `UPDATE qualified_followup SET ${status} = 'failed', ${error} = ? WHERE mode_at_enqueue = ? AND ${status} = 'sending' AND step_claimed_at < ?`,
      [err, tag, cutoff]);
    n += Number(res?.affectedRows ?? 0);
  }
  return n;
}
