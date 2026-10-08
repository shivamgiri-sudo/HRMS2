import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { requisitionClosedReason } from "../meta-campaign/lead-screener.service.js";
import type { RowTag } from "./qualified-followup.policy.js";
import { followupGuardOn } from "../selection/selection-switches.js";
import { decideStop, nextStepDue, OUTCOME_UNKNOWN_ERROR, SENDING_STALE_MIN, type StopReason } from "./qualified-followup.rules.js";

const C = "COLLATE utf8mb4_unicode_ci";

// Collects facts only; every decision is made by decideStop. The collation sits on the qualified_followup side of each comparison so
// the other table's key stays usable and tables with a different collation do not raise ER_CANT_AGGREGATE_2COLLATIONS.
// Only rows that still have a step to run (a finished row has nothing left that a stop could prevent); keyset-paged by id.
function factsSql(limit: number, paged: boolean): string {
  return `SELECT qf.id, qf.mobile10, qf.email, qf.journey_state,
       (SELECT hl.status FROM he_lead hl WHERE hl.mobile10 = qf.mobile10 ${C}
         ORDER BY (hl.status = 'opted_out') DESC, (hl.status = 'joined') DESC LIMIT 1) AS lead_status,
       EXISTS (SELECT 1 FROM he_consent hc JOIN he_lead hl2 ON hl2.id = hc.lead_id
                WHERE hl2.mobile10 = qf.mobile10 ${C} AND hc.consent_type = 'whatsapp_contact' AND hc.revoked_at IS NOT NULL) AS consent_revoked,
       EXISTS (SELECT 1 FROM he_message hm WHERE hm.mobile10 = qf.mobile10 ${C} AND hm.direction = 'in' AND hm.created_at > qf.qualified_at) AS he_replied,
       EXISTS (SELECT 1 FROM meta_lead_messages mm WHERE mm.lead_id = qf.meta_lead_id ${C} AND mm.direction = 'inbound' AND mm.created_at > qf.qualified_at) AS meta_replied,
       ac.current_stage AS ats_stage,
       jr.id AS jr_id, jr.approval_status, jr.active_status, jr.closed_at, jr.requested_headcount, jr.fulfilled_headcount
  FROM qualified_followup qf
  LEFT JOIN job_requisition jr ON jr.id = qf.requisition_id ${C}
  LEFT JOIN ats_candidate ac ON ac.id = qf.ats_candidate_id ${C}
 WHERE qf.stopped_reason IS NULL AND qf.mode_at_enqueue = ?
   AND ((qf.email_status IS NULL AND qf.email_due_at IS NOT NULL) OR qf.email_status = 'sending' OR qf.wa_status IS NULL OR qf.wa_status = 'sending' OR qf.call_state = 'pending'
        OR (qf.call_state = 'in_file' AND qf.call_file_batch_id IS NULL))
   ${paged ? "AND qf.id > ?" : ""}
 ORDER BY qf.id
 LIMIT ${Math.max(1, Math.floor(limit))}`;
}

const MAX_PAGES = 200;

export async function runStopChecks(tag: RowTag, limit = 500): Promise<{ checked: number; stopped: Partial<Record<StopReason, number>> }> {
  const stopped: Partial<Record<StopReason, number>> = {};
  let checked = 0;
  let lastId: string | null = null;
  // Page until a short page comes back so every open row is reached however many there are.
  for (let page = 0; page < MAX_PAGES; page++) {
    const [rows] = await db.execute<RowDataPacket[]>(factsSql(limit, lastId !== null), lastId === null ? [tag] : [tag, lastId]);
    const criteria = followupGuardOn() ? await criteriaFacts(rows.map((r) => String(r.id))) : null;
    for (const r of rows) {
      try {
        const reason = decideRow(r, criteria?.get(String(r.id)));
        if (!reason) {
          // A reply (any channel) ends stage A: no more cadence touches; stage B carries on.
          if ((Number(r.he_replied) === 1 || Number(r.meta_replied) === 1) && (r.journey_state === "enrolled" || r.journey_state === "reach")) {
            await db.execute("UPDATE qualified_followup SET journey_state = 'engaged', stage_a_ended_at = NOW() WHERE id = ? AND journey_state IN ('enrolled','reach')", [r.id]);
          }
          continue;
        }
        await db.execute(
          "UPDATE qualified_followup SET stopped_reason = ?, stopped_at = NOW(), journey_state = 'stopped', call_state = IF(call_state = 'pending', 'skipped', call_state) WHERE id = ? AND stopped_reason IS NULL",
          [reason, r.id]);
        stopped[reason] = (stopped[reason] ?? 0) + 1;
      } catch (err) {
        logger.warn({ rowId: r.id, err: (err as Error).message }, "[qualified-followup] stop check failed for row");
      }
    }
    checked += rows.length;
    if (rows.length < Math.max(1, Math.floor(limit))) break;
    lastId = String(rows[rows.length - 1].id);
    if (page === MAX_PAGES - 1) logger.warn({ tag, checked, maxPages: MAX_PAGES }, "[qualified-followup] stop checks hit the page cap; remaining rows wait for the next tick");
  }
  if (Object.keys(stopped).length) logger.info({ tag, checked, stopped }, "[qualified-followup] stop checks");
  return { checked, stopped };
}

/**
 * Selection criteria S14 (only with SELECTION_FOLLOWUP_GUARD): the rows' criteria verdicts and whether each person is booked for a
 * walk-in of the same requisition. A separate read, so the pinned facts statement is unchanged; any failure (e.g. before migration
 * 2145) means no criteria facts, i.e. today's behaviour.
 */
async function criteriaFacts(ids: string[]): Promise<Map<string, { verdict: string | null; booked: boolean }> | null> {
  if (!ids.length) return null;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT qf.id, qf.criteria_verdict,
              EXISTS (SELECT 1 FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE l.mobile10 = qf.mobile10 ${C} AND m.requisition_id = qf.requisition_id ${C}
                       AND m.state IN ('invited','confirmed') AND m.slot_at >= NOW()) AS booked
         FROM qualified_followup qf WHERE qf.id IN (${ids.map(() => "?").join(",")}) AND qf.criteria_verdict IN ('fail','review')`, ids);
    return new Map(rows.map((r) => [String(r.id), { verdict: r.criteria_verdict ?? null, booked: Number(r.booked) === 1 }]));
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[qualified-followup] criteria facts not read; criteria guard skipped this page");
    return null;
  }
}

function decideRow(r: RowDataPacket, criteria?: { verdict: string | null; booked: boolean }): StopReason | null {
  const stage = String(r.ats_stage ?? "").toLowerCase();
  return decideStop({
    optedOut: r.lead_status === "opted_out" || Number(r.consent_revoked) === 1,
    repliedSinceQualified: Number(r.he_replied) === 1 || Number(r.meta_replied) === 1,
    requisitionClosed: r.jr_id == null ? "requisition not found" : requisitionClosedReason({
      approvalStatus: r.approval_status ?? null,
      activeStatus: r.active_status ?? null,
      closedAt: r.closed_at ?? null,
      requestedHeadcount: r.requested_headcount != null ? Number(r.requested_headcount) : null,
      fulfilledHeadcount: r.fulfilled_headcount != null ? Number(r.fulfilled_headcount) : null,
    }),
    joined: r.lead_status === "joined" || stage === "joined" || stage === "payroll_validated",
    hasMobile: /^[6-9][0-9]{9}$/.test(String(r.mobile10 ?? "")),
    hasEmail: !!String(r.email ?? "").trim(),
    ...(criteria ? { criteria } : {}),
  });
}

/** Provider text can echo an address or number; neither is stored. */
const scrubError = (m: string) => m.replace(/[^\s@<>"',;:()]+@[^\s@<>"',;()]+/g, "[email]").replace(/\+?\d[\d ]{8,}\d/g, "[number]");

export async function syncWaReceipts(tag: RowTag): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT qf.id, hm.error_message FROM qualified_followup qf JOIN he_message hm ON hm.id = qf.wa_message_id
      WHERE qf.mode_at_enqueue = ? AND qf.wa_status IN ('sent', 'test_sent') AND hm.delivery_status = 'failed' LIMIT 1000`, [tag]);
  let n = 0;
  for (const r of rows) {
    const err = r.error_message ? scrubError(String(r.error_message)).slice(0, 255) : "delivery failed";
    const [res] = await db.execute<any>(
      "UPDATE qualified_followup SET wa_status = 'failed', wa_error = ? WHERE id = ? AND wa_status IN ('sent', 'test_sent')", [err, r.id]);
    n += Number(res?.affectedRows ?? 0);
  }
  return n;
}

// A claim left in 'sending' means the process died between the provider call and the status write; the outcome is unknown,
// so it becomes terminal 'failed' (attempts untouched, never picked up by the retry path).
export async function expireStaleClaims(tag: RowTag, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - SENDING_STALE_MIN * 60_000);
  const err = OUTCOME_UNKNOWN_ERROR;
  let n = 0;
  // A failed WhatsApp claim must not strand the call step: give it a due time too (the email step never blocks WhatsApp, its due time is set at enqueue).
  const next = nextStepDue(now);
  for (const [status, error, extra, extraParams] of [
    ["email_status", "email_error", "", []], ["wa_status", "wa_error", ", call_due_at = COALESCE(call_due_at, ?)", [next]],
  ] as const) {
    const [res] = await db.execute<any>(
      `UPDATE qualified_followup SET ${status} = 'failed', ${error} = ?${extra} WHERE mode_at_enqueue = ? AND ${status} = 'sending' AND COALESCE(step_claimed_at, updated_at) < ?`,
      [err, ...extraParams, tag, cutoff]);
    n += Number(res?.affectedRows ?? 0);
  }
  return n;
}
