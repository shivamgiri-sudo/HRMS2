/**
 * The engine tick. Each step is independent and idempotent (events/states guard against double sends), and
 * every step honours `dryRun`, which reports what would happen without sending or writing.
 *   1 replacement slots  - candidates who asked to reschedule get ONE new slot (second no -> human, see he-state)
 *   2 drive invites      - suggested matches of ACTIVE auto-send drives get slot + invite
 *   3 reminders          - T-1d and T-2h for confirmed candidates
 *   4 arrival sync       - candidates who registered at the branch on the drive day are marked arrived (also late after a no-show,
 *                          or an unplanned walk-in of a suggested / released match at the drive's branch)
 *   5 no-shows           - slot passed with no arrival -> no_show + one recovery message
 *   2b cadence follow-up - email sent an hour ago -> WhatsApp invite (HE_CADENCE_GAP_MIN, default 60)
 *   6 voice calls        - invited, one cadence gap since the WhatsApp invite, no reply -> BRD confirmation call (1 retry after 2h)
 *   8 other roles        - rejected in the last 3 days -> one offer for the best other eligible requisition (different process)
 *   7 bulk calls         - jobs of ACTIVE manual bulk-upload batches (same rules: 09-20 IST, 1 retry after 2h)
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { addEvent, setLeadStatus } from "./he-lead.service.js";
import { recomputeInsight } from "./he-insight.service.js";
import { reserveSlot, suggestMatches } from "./he-drive.service.js";
import { sendTemplateToLead, sendsPaused, type SendResult } from "./he-send.service.js";
import { emailConfigured, sendInviteEmail, INVITE_EMAIL_KEY } from "./he-email.service.js";
import { bestHourWait, cadenceGapMin, nextCadenceStep } from "./he-cadence.js";
import { istHour } from "./he-guardrails.js";
import { cleanName } from "./he-name.js";
import { placeVoiceCall } from "./he-voice.service.js";
import { runBulkCallJobs, type RunSummary } from "./he-bulk-call.service.js";
import { offerOtherRoles, type RerouteSummary } from "./he-reroute.service.js";
import { whatsappRequiresOptIn } from "./he-policy.service.js";
import { planNextDay } from "./he-plan.service.js";
import { streamDriveIds, topUpStreamDrive, type StreamDayPlan } from "./he-stream-plan.service.js";
import { sweepOwnedCampaigns } from "./he-meta-bridge.service.js";
import { sendFollowUpEmail } from "./he-followup-email.service.js";
import { loadEndDateEnforced, requisitionEndedReason } from "./requisition-criteria.js";
import { firstContactHoldSql, followupOwnedExpr, followupSkipSql, followupStoppedSql, LEAD_MOBILE_OF_MATCH } from "./qualified-followup.policy.js";
import { withFollowupSchema } from "./followup-schema-guard.js";

// People the unified follow-up owns (row-based, any mode) get no engine send; marking and hygiene still cover them.
const OWNED_BY_MATCH = { mobileExpr: LEAD_MOBILE_OF_MATCH, requisitionExpr: "m.requisition_id" };

export interface TickSummary {
  dryRun: boolean;
  paused: boolean;
  replacementSlots: Counts;
  invites: Counts;
  reminders: Counts;
  arrivals: number;
  noShows: number;
  recovery: Counts;
  calls: Counts;
  bulkCalls: RunSummary | null;
  otherRoles: RerouteSummary | null;
}
interface Counts { sent: number; blocked: Record<string, number>; failed: number; dryRun: number }
const counts = (): Counts => ({ sent: 0, blocked: {}, failed: 0, dryRun: 0 });
function tally(c: Counts, r: SendResult): void {
  if (r.status === "sent") c.sent++;
  else if (r.status === "dry_run") c.dryRun++;
  else if (r.status === "failed") c.failed++;
  else c.blocked[r.reason] = (c.blocked[r.reason] ?? 0) + 1;
}

async function voiceCalls(dryRun: boolean, c: Counts, max: number): Promise<void> {
  const [rows] = await withFollowupSchema("voice calls", (legacy) => db.execute<RowDataPacket[]>(
    `SELECT m.id, m.slot_at, (SELECT best_hour_ist FROM he_lead_insight i WHERE i.lead_id = m.lead_id) AS best_hour FROM he_match m
      WHERE m.state = 'invited' AND m.slot_at > NOW()
        AND (
          -- normal cadence: one gap after the WhatsApp invite
          EXISTS (SELECT 1 FROM he_message o WHERE o.lead_id = m.lead_id AND o.direction = 'out' AND o.template_key LIKE 'he_walkin_invite:%'
                    AND o.created_at < DATE_SUB(NOW(), INTERVAL ? MINUTE))
          -- WhatsApp could not go out (template not approved / no opt-in): the call follows the email two gaps later
          OR (EXISTS (SELECT 1 FROM he_message e WHERE e.lead_id = m.lead_id AND e.direction = 'out' AND e.template_key = 'he_walkin_invite_email'
                        AND e.delivery_status <> 'failed' AND e.created_at < DATE_SUB(NOW(), INTERVAL ? MINUTE))
              AND NOT EXISTS (SELECT 1 FROM he_message w WHERE w.lead_id = m.lead_id AND w.direction = 'out' AND w.template_key LIKE 'he_walkin_invite:%'))
        )
        AND NOT EXISTS (SELECT 1 FROM he_message i WHERE i.lead_id = m.lead_id AND i.direction = 'in' AND i.created_at > DATE_SUB(NOW(), INTERVAL 2 DAY))${followupSkipSql(OWNED_BY_MATCH, legacy)}
      ORDER BY m.slot_at LIMIT ?`, [cadenceGapMin(), cadenceGapMin() * 2, max]));
  for (const r of rows) {
    if (bestHourWait({ now: new Date(), bestHourIst: r.best_hour == null ? null : Number(r.best_hour), slotAt: r.slot_at ? new Date(String(r.slot_at).replace(" ", "T") + "+05:30") : null })) {
      c.blocked.waiting_best_hour = (c.blocked.waiting_best_hour ?? 0) + 1; continue;
    }
    const res = await placeVoiceCall(r.id as string, { dryRun });
    if (res.status === "placed") c.sent++;
    else if (res.status === "dry_run") c.dryRun++;
    else if (res.status === "failed") c.failed++;
    else c.blocked[res.reason] = (c.blocked[res.reason] ?? 0) + 1;
  }
}

async function eventExists(leadId: string, driveId: string, type: string): Promise<boolean> {
  const [r] = await db.execute<RowDataPacket[]>("SELECT 1 FROM he_lead_event WHERE lead_id = ? AND drive_id = ? AND event_type = ? LIMIT 1", [leadId, driveId, type]);
  return r.length > 0;
}

async function replacementSlots(dryRun: boolean, c: Counts, max: number): Promise<void> {
  // reschedule_requested more recent than the last slot_offered, match released.
  const [rows] = await withFollowupSchema("replacement slots", (legacy) => db.execute<RowDataPacket[]>(
    `SELECT m.id AS match_id, m.lead_id FROM he_match m
      WHERE m.state = 'slot_released' AND m.drive_id IS NOT NULL
        AND (SELECT MAX(id) FROM he_lead_event e WHERE e.lead_id = m.lead_id AND e.event_type = 'reschedule_requested')
          > COALESCE((SELECT MAX(id) FROM he_lead_event e WHERE e.lead_id = m.lead_id AND e.event_type = 'slot_offered'), 0)${followupSkipSql(OWNED_BY_MATCH, legacy)}
      LIMIT ?`, [max]));
  for (const r of rows) {
    if (dryRun) { c.dryRun++; continue; }
    const slot = await reserveSlot(r.match_id as string, true);
    if (!slot) { await addEvent(r.lead_id as string, "needs_human_followup", { detail: "no free slot to reschedule into" }); c.blocked.no_free_slot = (c.blocked.no_free_slot ?? 0) + 1; continue; }
    // Answers the candidate's own "reschedule" request, so the 2-hour spacing / daily cap meant for unprompted messages does not apply.
    const res = await sendTemplateToLead({ leadId: r.lead_id as string, key: "he_reschedule_offer", matchId: r.match_id as string, transactional: true });
    const em = await sendFollowUpEmail("reschedule_offer", r.match_id as string);
    if (res.status === "sent" || em.status === "sent") await db.execute("UPDATE he_match SET state = 'invited' WHERE id = ?", [r.match_id]);
    else await db.execute("UPDATE he_match SET slot_at = NULL WHERE id = ?", [r.match_id]); // not sent on any channel -> do not hold the seat
    tally(c, res); if (em.status === "sent") c.sent++;
  }
}

async function driveInvites(dryRun: boolean, c: Counts, max: number): Promise<void> {
  const [drives] = await db.execute<RowDataPacket[]>(
    "SELECT id FROM he_drive WHERE status = 'active' AND auto_send = 1 AND drive_date >= CURDATE() AND drive_date <= DATE_ADD(CURDATE(), INTERVAL 3 DAY)");
  // Stream-fed drives are topped up per stream (suggestMatches would line up from the drive's own audience and drop other streams' suggestions).
  const streamIds = dryRun ? new Set<string>() : await streamDriveIds(drives.map((d) => d.id as string));
  let budget = max;
  for (const d of drives) {
    if (budget <= 0) return;
    if (!dryRun) await (streamIds.has(d.id as string) ? topUpStreamDrive(d.id as string) : suggestMatches(d.id as string));
    const r = await inviteForDrive(d.id as string, { dryRun, max: budget });
    c.sent += r.sent; c.failed += r.failed; c.dryRun += r.dryRun;
    for (const [k, v] of Object.entries(r.blocked)) c.blocked[k] = (c.blocked[k] ?? 0) + v;
    budget -= r.sent + r.dryRun;
  }
}

export interface PlannedInvite { matchId: string; leadId: string; name: string | null; mobile: string; channel: "email" | "whatsapp" | null; reason: string }
export interface LaunchResult extends Counts { planned: PlannedInvite[]; considered: number }

/**
 * Step 1 for one drive (used by the scheduler for auto-send drives and by HR's "Send invites now" button):
 * suggested matches who can be reached get a slot and their first touch - the EMAIL when they have an address (this needs
 * no WhatsApp template or consent), otherwise the WhatsApp invite. dryRun returns the plan without sending or holding seats.
 */
export async function inviteForDrive(driveId: string, o: { dryRun: boolean; max: number }): Promise<LaunchResult> {
  const out: LaunchResult = { ...counts(), planned: [], considered: 0 };
  // WS3 E1: no first invites for a requisition past its end date when enforced (env + policy; off issues no statement). Reminders,
  // no-show follow-up and anything for people already booked run elsewhere and are untouched.
  if (await loadEndDateEnforced()) {
    const [dr] = await db.execute<RowDataPacket[]>("SELECT d.requisition_id, jr.requisition_validity FROM he_drive d JOIN job_requisition jr ON jr.id = d.requisition_id WHERE d.id = ? LIMIT 1", [driveId]);
    const ended = dr[0] ? requisitionEndedReason({ validity: dr[0].requisition_validity as string | Date | null }, new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10), true) : null;
    if (ended) { out.blocked[ended] = 1; return out; }
  }
  const optIn = (await whatsappRequiresOptIn()) ? 1 : 0;
  const [ms] = await withFollowupSchema("drive invites", (legacy) => db.execute<RowDataPacket[]>(
    `SELECT m.id, m.lead_id, l.full_name, l.mobile10,
            (l.last_contact_at IS NOT NULL AND l.last_contact_at < DATE_SUB(NOW(), INTERVAL 30 DAY)) AS dormant,
            (l.email IS NOT NULL AND l.email <> '') AS has_email,
            COALESCE((SELECT cfg.email_on FROM he_lead_campaign lc JOIN he_campaign_config cfg ON cfg.campaign_id = lc.campaign_id WHERE lc.lead_id = m.lead_id ORDER BY lc.form_filled_at DESC LIMIT 1), 1) AS email_on,
            COALESCE((SELECT cfg.whatsapp_on FROM he_lead_campaign lc JOIN he_campaign_config cfg ON cfg.campaign_id = lc.campaign_id WHERE lc.lead_id = m.lead_id ORDER BY lc.form_filled_at DESC LIMIT 1), 1) AS whatsapp_on,
            (EXISTS (SELECT 1 FROM he_consent c WHERE c.lead_id = m.lead_id AND c.consent_type = 'whatsapp_contact' AND c.revoked_at IS NULL)
              OR (? = 0 AND NOT EXISTS (SELECT 1 FROM he_consent c2 WHERE c2.lead_id = m.lead_id AND c2.consent_type = 'whatsapp_contact' AND c2.revoked_at IS NOT NULL))) AS has_consent
       FROM he_match m JOIN he_lead l ON l.id = m.lead_id
      WHERE m.drive_id = ? AND m.state = 'suggested' AND l.status <> 'opted_out'${followupSkipSql({ mobileExpr: "l.mobile10", requisitionExpr: "m.requisition_id" }, legacy)}${followupStoppedSql({ mobileExpr: "l.mobile10", requisitionExpr: "m.requisition_id" })}${firstContactHoldSql({ mobileExpr: "l.mobile10" }, legacy)}
      ORDER BY has_email DESC, m.score DESC LIMIT ?`, [optIn, driveId, Math.max(1, Math.min(2000, Math.floor(o.max)))]));
  const [tpl] = await db.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM he_template WHERE template_key LIKE 'he_walkin_invite:%' AND approval_state = 'approved'");
  const waTemplateOk = Number(tpl[0]?.n ?? 0) > 0;
  const quiet = istHour(new Date()) >= 20 || istHour(new Date()) < 9;
  const canEmail = emailConfigured();
  for (const m of ms) {
    out.considered++;
    const step = nextCadenceStep({ now: new Date(), gapMin: cadenceGapMin(), canEmail: Boolean(Number(m.has_email)) && Number(m.email_on) === 1 && canEmail, waConsent: Boolean(Number(m.has_consent)) && Number(m.whatsapp_on) === 1 && waTemplateOk, emailSentAt: null, waSentAt: null, voiceAt: null, repliedAfterFirstTouch: false, quietHours: quiet });
    const reason = step.step ? (step.step === "email" ? "email first" : "WhatsApp first (no email address)")
      : step.reason === "no_channel" ? (Number(m.has_email) && !canEmail ? "email not configured on the server" : Number(m.has_consent) && !waTemplateOk ? "WhatsApp template not approved yet" : "no email and no WhatsApp opt-in")
      : step.reason === "quiet_hours" ? "outside 09:00-20:00 IST" : step.reason;
    if (out.planned.length < 500) out.planned.push({ matchId: m.id, leadId: m.lead_id, name: m.full_name ? cleanName(m.full_name) || String(m.full_name) : null, mobile: String(m.mobile10).slice(0, 2) + "xxxxxx" + String(m.mobile10).slice(-2), channel: step.step === "voice" ? null : step.step, reason });
    if (!step.step) { out.blocked[reason] = (out.blocked[reason] ?? 0) + 1; continue; }
    if (o.dryRun) { out.dryRun++; continue; }
    const slot = await reserveSlot(m.id as string);
    if (!slot) { out.blocked["drive full"] = (out.blocked["drive full"] ?? 0) + 1; break; }
    const res = step.step === "email"
      ? await sendInviteEmail(m.id as string)
      // T8 win-back for someone we have not spoken to in 30+ days (approved as MARKETING), else the T1 invite.
      : await sendTemplateToLead({ leadId: m.lead_id as string, key: Number(m.dormant) ? "he_winback" : "he_walkin_invite", matchId: m.id as string });
    if (res.status === "sent") await db.execute("UPDATE he_match SET state = 'invited' WHERE id = ?", [m.id]);
    else await db.execute("UPDATE he_match SET slot_at = NULL WHERE id = ?", [m.id]); // not sent -> do not hold the seat
    tally(out, res);
  }
  return out;
}

/**
 * Everything the scheduler does every 5 minutes, on demand (HR's "Run follow-ups now"), so the whole flow works while
 * the scheduler is off: WhatsApp step, reminders (T3/T4), bot calls, no-shows + recovery (T6), replacement slots after a
 * reschedule (T5) and other-role offers (T7).
 */
export async function runFollowUps(o: { dryRun: boolean }): Promise<{ whatsapp: Counts; reminders: Counts; calls: Counts; recovery: Counts; replacement: Counts; arrivals: number; noShows: number; otherRoles: RerouteSummary | null }> {
  const out = { whatsapp: counts(), reminders: counts(), calls: counts(), recovery: counts(), replacement: counts(), arrivals: 0, noShows: 0, otherRoles: null as RerouteSummary | null };
  // State hygiene runs even while sends are paused. Arrivals first (as in the tick), so a same-day walk-in is never marked no_show and sent T6.
  out.arrivals = await arrivalSync(o.dryRun);
  out.noShows = await noShows(o.dryRun, out.recovery);
  if (sendsPaused()) return out;
  await replacementSlots(o.dryRun, out.replacement, 50);
  await whatsappFollowUps(o.dryRun, out.whatsapp, 200);
  await reminders(o.dryRun, out.reminders);
  await followUpCatchUp(o.dryRun, out.recovery);
  await voiceCalls(o.dryRun, out.calls, 50);
  out.otherRoles = await offerOtherRoles({ dryRun: o.dryRun, max: 50, scope: "exclude_enrolled" });
  return out;
}

/** Step 2: matches whose invite EMAIL went out a cadence gap ago and have no WhatsApp invite yet get the WhatsApp invite now. */
async function whatsappFollowUps(dryRun: boolean, c: Counts, max: number): Promise<void> {
  const reqOptIn = await whatsappRequiresOptIn();
  const gap = cadenceGapMin();
  const [rows] = await withFollowupSchema("WhatsApp step", (legacy) => { const skip = followupSkipSql({ mobileExpr: "l.mobile10", requisitionExpr: "m.requisition_id" }, legacy); return db.execute<RowDataPacket[]>(
    `SELECT m.id, m.lead_id, m.slot_at, e.created_at AS email_at, (SELECT best_hour_ist FROM he_lead_insight i WHERE i.lead_id = m.lead_id) AS best_hour FROM he_match m
${skip ? "       JOIN he_lead l ON l.id = m.lead_id\n" : ""}       JOIN he_message e ON e.lead_id = m.lead_id AND e.requisition_id = m.requisition_id AND e.template_key = ? AND e.direction = 'out' AND e.delivery_status <> 'failed'
      WHERE m.state = 'invited' AND m.slot_at > NOW() AND e.created_at <= DATE_SUB(NOW(), INTERVAL ? MINUTE)
        AND NOT EXISTS (SELECT 1 FROM he_message w WHERE w.lead_id = m.lead_id AND w.direction = 'out' AND w.template_key LIKE 'he_walkin_invite:%' AND w.created_at >= e.created_at)
        AND NOT EXISTS (SELECT 1 FROM he_message i WHERE i.lead_id = m.lead_id AND i.direction = 'in' AND i.created_at >= e.created_at)
        AND (
          EXISTS (SELECT 1 FROM he_consent k WHERE k.lead_id = m.lead_id AND k.consent_type = 'whatsapp_contact' AND k.revoked_at IS NULL)
          -- owner-approved: people who applied for this role are messaged about it; anyone who revoked or opted out never is
          OR (? = 0 AND NOT EXISTS (SELECT 1 FROM he_consent k2 WHERE k2.lead_id = m.lead_id AND k2.consent_type = 'whatsapp_contact' AND k2.revoked_at IS NOT NULL)
              AND NOT EXISTS (SELECT 1 FROM he_lead lo WHERE lo.id = m.lead_id AND lo.status = 'opted_out'))
        )${skip}
      ORDER BY m.slot_at LIMIT ?`, [INVITE_EMAIL_KEY, gap, reqOptIn ? 1 : 0, max]); });
  for (const r of rows) {
    if (dryRun) { c.dryRun++; continue; }
    const step = nextCadenceStep({ now: new Date(), gapMin: gap, canEmail: true, waConsent: true, emailSentAt: new Date(String(r.email_at).replace(" ", "T") + "+05:30"), waSentAt: null, voiceAt: null, repliedAfterFirstTouch: false, quietHours: false, bestHourIst: r.best_hour == null ? null : Number(r.best_hour), slotAt: r.slot_at ? new Date(String(r.slot_at).replace(" ", "T") + "+05:30") : null });
    if (step.reason === "waiting_best_hour") { c.blocked.waiting_best_hour = (c.blocked.waiting_best_hour ?? 0) + 1; continue; }
    if (step.step !== "whatsapp") continue;
    tally(c, await sendTemplateToLead({ leadId: r.lead_id as string, key: "he_walkin_invite", matchId: r.id as string, minGapMinutes: gap }));
  }
}

async function reminders(dryRun: boolean, c: Counts): Promise<void> {
  for (const [key, evt, loMin, hiMin] of [["he_reminder_1d", "reminder_1d_sent", 22 * 60, 26 * 60], ["he_reminder_2h_location", "reminder_2h_sent", 90, 150]] as const) {
    const [rows] = await withFollowupSchema("reminders", (legacy) => db.execute<RowDataPacket[]>(
      `SELECT m.id, m.lead_id, m.drive_id FROM he_match m
        WHERE m.state = 'confirmed' AND m.slot_at BETWEEN DATE_ADD(NOW(), INTERVAL ? MINUTE) AND DATE_ADD(NOW(), INTERVAL ? MINUTE)${followupSkipSql(OWNED_BY_MATCH, legacy)}`, [loMin, hiMin]));
    for (const r of rows) {
      if (!(await eventExists(r.lead_id as string, r.drive_id as string, evt))) {
        const res = await sendTemplateToLead({ leadId: r.lead_id as string, key, matchId: r.id as string, dryRun });
        tally(c, res);
        // Sent or rejected by Meta both count as handled (a rejected one must not be retried every five minutes); only a passing block
        // such as quiet hours or message spacing is tried again on the next run.
        if (!dryRun && (res.status === "sent" || res.status === "failed")) await addEvent(r.lead_id as string, evt, { driveId: r.drive_id as string, channel: "whatsapp", detail: res.status });
      }
      // The day-before reminder also goes by email (once per drive; the 2-hour one is WhatsApp-only because it carries the location button).
      if (key === "he_reminder_1d") tally(c, await sendFollowUpEmail("reminder_1d", r.id as string, { dryRun }));
    }
  }
}

/** Match states that a same-day branch walk-in turns into 'arrived'. Never 'selected' (no step backwards), 'arrived' (done) or 'declined'. */
const BOOKED_STATES = "'invited','confirmed'";
const LATE_STATES = "'no_show','suggested','slot_released'";
// One walk-in credits one match: a lead has one match per requisition and can be lined up for several on the same day. A late match is
// skipped when the lead has a booked / arrived / selected match that day (anywhere), or a better late match at the same branch that the
// walk-in's requisition allows (rank: no_show, slot_released, suggested; then the lowest id). The walk-in form's requisition, when set,
// must be the match's.
const LATE_RANK = "'no_show','slot_released','suggested'";
// From today's drives (idx_he_drive_date) to their matches (idx_he_match_drive) and leads, then today's walk-ins. The phone pass reads only
// the covering (mobile, walk_in_date) index of ats_candidate; the branch is read by primary key for the few rows that match. A match that
// was not booked (late after a no-show, suggested, released) also needs the walk-in at the drive's branch when the form names one, so a
// person lined up for two requisitions on the same day is not marked arrived at both (see LATE_RANK).
const ARRIVAL_SQL = `SELECT /*+ NO_MERGE(w) */ DISTINCT STRAIGHT_JOIN m.id, m.lead_id, m.drive_id, m.state FROM he_drive d
  JOIN he_match m ON m.drive_id = d.id
  JOIN he_lead l ON l.id = m.lead_id
  JOIN (SELECT x.id, RIGHT(REGEXP_REPLACE(x.mobile, '[^0-9]', ''), 10) AS mobile10 FROM ats_candidate x WHERE x.walk_in_date = CURDATE()) w ON w.mobile10 = l.mobile10
  JOIN ats_candidate c ON c.id = w.id
 WHERE d.drive_date = CURDATE()
   AND (m.state IN (${BOOKED_STATES}) OR (m.state IN (${LATE_STATES}) AND (c.applied_for_branch IS NULL OR c.applied_for_branch = d.branch_name)
        AND (c.requisition_id IS NULL OR c.requisition_id = m.requisition_id)
        AND NOT EXISTS (SELECT 1 FROM he_match m2 JOIN he_drive d2 ON d2.id = m2.drive_id AND d2.drive_date = CURDATE()
              WHERE m2.lead_id = m.lead_id AND m2.id <> m.id AND (m2.state IN ('invited','confirmed','arrived','selected')
                 OR (d2.branch_name = d.branch_name AND m2.state IN (${LATE_STATES}) AND (c.requisition_id IS NULL OR c.requisition_id = m2.requisition_id)
                     AND (FIELD(m2.state, ${LATE_RANK}) < FIELD(m.state, ${LATE_RANK}) OR (m2.state = m.state AND m2.id < m.id)))))))`;

const arrivalDetail = (from: string): string =>
  from === "no_show" ? "registered at branch after being marked no-show" : from === "suggested" ? "walked in without a booking" : "registered at branch";

/**
 * A candidate who filled the branch walk-in form on the drive day (matched by mobile) has arrived, whatever the match said before: booked,
 * already marked no_show (came after the 2-hour mark), only suggested (an unplanned walk-in) or released. Idempotent: the state-guarded
 * UPDATE makes a second pass (or a match that moved on meanwhile) a no-op with no event. A corrected no_show stops the no-show follow-ups
 * (they all read state 'no_show') and its no_show event is no longer counted (countedNoShow).
 */
async function arrivalSync(dryRun: boolean): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(ARRIVAL_SQL);
  if (dryRun) return rows.length;
  let n = 0;
  for (const r of rows) {
    const [u] = await db.execute<import("mysql2").ResultSetHeader>(
      `UPDATE he_match SET state = 'arrived' WHERE id = ? AND state IN (${BOOKED_STATES},${LATE_STATES})`, [r.id]);
    if (!u.affectedRows) continue;
    n++;
    const from = String(r.state ?? "");
    // An opt-out or a join is never overwritten by an arrival.
    await db.execute("UPDATE he_lead SET status = 'arrived', status_at = NOW() WHERE id = ? AND status NOT IN ('opted_out','joined')", [r.lead_id]);
    const booked = from === "invited" || from === "confirmed";
    await addEvent(r.lead_id as string, "arrived", { driveId: r.drive_id as string, channel: "branch", detail: arrivalDetail(from), ...(booked ? {} : { meta: { from } }) });
    await recomputeInsight(r.lead_id as string);
  }
  return n;
}

async function noShows(dryRun: boolean, c: Counts): Promise<number> {
  const [rows] = await withFollowupSchema("no-shows", (legacy) => db.execute<RowDataPacket[]>(
    `SELECT m.id, m.lead_id, m.drive_id, ${followupOwnedExpr(OWNED_BY_MATCH, legacy)} AS followup_owned FROM he_match m
      WHERE m.state IN ('invited','confirmed') AND m.slot_at IS NOT NULL AND m.slot_at < DATE_SUB(NOW(), INTERVAL 120 MINUTE)
        AND m.slot_at > DATE_SUB(NOW(), INTERVAL 2 DAY)`));
  for (const r of rows) {
    if (dryRun) continue;
    await db.execute("UPDATE he_match SET state = 'no_show' WHERE id = ?", [r.id]);
    await setLeadStatus(r.lead_id as string, "no_show");
    await addEvent(r.lead_id as string, "no_show", { driveId: r.drive_id as string, channel: "system" });
    await recomputeInsight(r.lead_id as string);
    // One recovery message for a first no-show only; the insight stops it after two.
    const [ns] = await db.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM he_match WHERE lead_id = ? AND state = 'no_show'", [r.lead_id]);
    // The follow-up method sends its own recovery (confirmed people only, D5) to the people it owns.
    if (Number(ns[0].n) === 1 && !Number(r.followup_owned)) {
      tally(c, await sendTemplateToLead({ leadId: r.lead_id as string, key: "he_no_show_recovery", matchId: r.id as string }));
      tally(c, await sendFollowUpEmail("no_show", r.id as string));
    }
  }
  return rows.length;
}

/** A no-show email that could not go out when the no-show was marked (it was after 20:00) is sent the next morning, within two days. */
async function followUpCatchUp(dryRun: boolean, c: Counts): Promise<void> {
  const [rows] = await withFollowupSchema("no-show catch-up", (legacy) => db.execute<RowDataPacket[]>(
    `SELECT m.id FROM he_match m JOIN he_lead l ON l.id = m.lead_id
      WHERE m.state = 'no_show' AND m.slot_at > DATE_SUB(NOW(), INTERVAL 2 DAY) AND l.email IS NOT NULL AND l.email <> ''
        AND (SELECT COUNT(*) FROM he_match x WHERE x.lead_id = m.lead_id AND x.state = 'no_show') = 1
        AND NOT EXISTS (SELECT 1 FROM he_message e WHERE e.lead_id = m.lead_id AND e.requisition_id = m.requisition_id AND e.template_key = 'he_email_no_show' AND e.direction = 'out' AND e.delivery_status <> 'failed' AND (e.drive_id <=> m.drive_id))${followupSkipSql({ mobileExpr: "l.mobile10", requisitionExpr: "m.requisition_id" }, legacy)}
      LIMIT 100`));
  for (const r of rows) tally(c, await sendFollowUpEmail("no_show", r.id as string, { dryRun }));
}

/**
 * A lead left at invited / confirmed / rescheduled with no live booking (the engine was off, a drive was closed, the date passed) would never be lined
 * up again, because the shortlist only takes new / contacted / interested / declined / no_show. After 3 days with no live booking they go back to
 * 'contacted' (a passed slot that was never marked becomes 'no_show').
 */
export async function expireStaleLeadStatus(dryRun: boolean): Promise<number> {
  const live = `EXISTS (SELECT 1 FROM he_match m WHERE m.lead_id = l.id AND m.state IN ('invited','confirmed','slot_released') AND (m.slot_at IS NULL OR m.slot_at >= DATE_SUB(NOW(), INTERVAL 3 HOUR)))`;
  const stale = `l.status IN ('invited','confirmed','rescheduled') AND COALESCE(l.status_at, l.updated_at) < DATE_SUB(NOW(), INTERVAL 3 DAY) AND NOT ${live}`;
  if (dryRun) { const [r] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM he_lead l WHERE ${stale}`); return Number(r[0].n); }
  const [u] = await db.execute<import("mysql2").ResultSetHeader>(
    `UPDATE he_lead l SET l.status = IF(EXISTS (SELECT 1 FROM he_match x WHERE x.lead_id = l.id AND x.state IN ('no_show')), 'no_show', 'contacted'), l.status_at = NOW() WHERE ${stale}`);
  return u.affectedRows;
}

/** Stream days the evening pass did not plan (or streams it skipped): ids, dates and reasons only. */
function logStreamGaps(date: string, plans: StreamDayPlan[]): void {
  const gaps = plans
    .map((p) => ({ requisitionId: p.requisitionId, date: p.date, reason: p.reason ?? null, skipped: p.streams.filter((s) => s.skipped).map((s) => ({ streamId: s.streamId, skipped: s.skipped })) }))
    .filter((g) => g.reason || g.skipped.length);
  if (gaps.length) logger.warn({ date, streams: gaps }, "[he-engine] daily plan: stream days not planned");
}

export async function runEngineTick(o: { dryRun?: boolean; maxInvites?: number } = {}): Promise<TickSummary> {
  const dryRun = o.dryRun !== false; // safe default: only an explicit false sends
  const s: TickSummary = { dryRun, paused: sendsPaused(), replacementSlots: counts(), invites: counts(), reminders: counts(), arrivals: 0, noShows: 0, recovery: counts(), calls: counts(), bulkCalls: null, otherRoles: null };
  const guard = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (err) { logger.error({ err: (err as Error).message, step: name }, "[he-engine] step failed"); } };
  // Arrival + no-show bookkeeping is state hygiene, not outreach, so it runs even while sends are paused.
  await guard("arrival", async () => { s.arrivals = await arrivalSync(dryRun); });
  await guard("noshow", async () => { s.noShows = await noShows(dryRun, s.recovery); });
  await guard("stale-status", async () => { await expireStaleLeadStatus(dryRun); });
  if (!s.paused) {
    await guard("meta-bridge", async () => { if (!dryRun) await sweepOwnedCampaigns(); });
    // Evening (17:00-20:00 IST): make sure the next working day has its drive, sized to the owner's daily plan. Idempotent.
    if (!dryRun && istHour(new Date()) >= 17 && istHour(new Date()) < 20) await guard("daily-plan", async () => { const r = await planNextDay(); const made = r.days.filter((d) => d.status === "created"); if (made.length) logger.info({ date: r.date, made: made.map((d) => `${d.code}:${d.lined}`) }, "[he-engine] daily plan created drives"); logStreamGaps(r.date, r.streams); });
    await guard("replacement", () => replacementSlots(dryRun, s.replacementSlots, 50));
    await guard("invites", () => driveInvites(dryRun, s.invites, o.maxInvites ?? 100));
    await guard("whatsapp-follow-ups", () => whatsappFollowUps(dryRun, s.invites, o.maxInvites ?? 100));
    await guard("reminders", () => reminders(dryRun, s.reminders));
    await guard("followup-email-catch-up", () => followUpCatchUp(dryRun, s.recovery));
    await guard("voice", () => voiceCalls(dryRun, s.calls, 20));
    await guard("bulk-calls", async () => { s.bulkCalls = await runBulkCallJobs({ dryRun, max: 20 }); });
    await guard("other-role-offers", async () => { s.otherRoles = await offerOtherRoles({ dryRun, max: 50, scope: "exclude_enrolled" }); });
  }
  return s;
}
