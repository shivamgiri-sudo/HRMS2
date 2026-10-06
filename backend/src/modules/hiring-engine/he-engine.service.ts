/**
 * The engine tick. Each step is independent and idempotent (events/states guard against double sends), and
 * every step honours `dryRun`, which reports what would happen without sending or writing.
 *   1 replacement slots  - candidates who asked to reschedule get ONE new slot (second no -> human, see he-state)
 *   2 drive invites      - suggested matches of ACTIVE auto-send drives get slot + invite
 *   3 reminders          - T-1d and T-2h for confirmed candidates
 *   4 arrival sync       - candidates who registered at the branch on the drive day are marked arrived
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
import { placeVoiceCall } from "./he-voice.service.js";
import { runBulkCallJobs, type RunSummary } from "./he-bulk-call.service.js";
import { offerOtherRoles, type RerouteSummary } from "./he-reroute.service.js";

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
  const [rows] = await db.execute<RowDataPacket[]>(
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
        AND NOT EXISTS (SELECT 1 FROM he_message i WHERE i.lead_id = m.lead_id AND i.direction = 'in' AND i.created_at > DATE_SUB(NOW(), INTERVAL 2 DAY))
      ORDER BY m.slot_at LIMIT ?`, [cadenceGapMin(), cadenceGapMin() * 2, max]);
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
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.id AS match_id, m.lead_id FROM he_match m
      WHERE m.state = 'slot_released' AND m.drive_id IS NOT NULL
        AND (SELECT MAX(id) FROM he_lead_event e WHERE e.lead_id = m.lead_id AND e.event_type = 'reschedule_requested')
          > COALESCE((SELECT MAX(id) FROM he_lead_event e WHERE e.lead_id = m.lead_id AND e.event_type = 'slot_offered'), 0)
      LIMIT ?`, [max]);
  for (const r of rows) {
    if (dryRun) { c.dryRun++; continue; }
    const slot = await reserveSlot(r.match_id as string, true);
    if (!slot) { await addEvent(r.lead_id as string, "needs_human_followup", { detail: "no free slot to reschedule into" }); c.blocked.no_free_slot = (c.blocked.no_free_slot ?? 0) + 1; continue; }
    // Answers the candidate's own "reschedule" request, so the 2-hour spacing / daily cap meant for unprompted messages does not apply.
    const res = await sendTemplateToLead({ leadId: r.lead_id as string, key: "he_reschedule_offer", matchId: r.match_id as string, transactional: true });
    if (res.status === "sent") await db.execute("UPDATE he_match SET state = 'invited' WHERE id = ?", [r.match_id]);
    else await db.execute("UPDATE he_match SET slot_at = NULL WHERE id = ?", [r.match_id]); // not sent -> do not hold the seat
    tally(c, res);
  }
}

async function driveInvites(dryRun: boolean, c: Counts, max: number): Promise<void> {
  const [drives] = await db.execute<RowDataPacket[]>(
    "SELECT id FROM he_drive WHERE status = 'active' AND auto_send = 1 AND drive_date >= CURDATE() AND drive_date <= DATE_ADD(CURDATE(), INTERVAL 3 DAY)");
  let budget = max;
  for (const d of drives) {
    if (budget <= 0) return;
    if (!dryRun) await suggestMatches(d.id as string);
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
  const [ms] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.lead_id, l.full_name, l.mobile10,
            (l.last_contact_at IS NOT NULL AND l.last_contact_at < DATE_SUB(NOW(), INTERVAL 30 DAY)) AS dormant,
            (l.email IS NOT NULL AND l.email <> '') AS has_email,
            EXISTS (SELECT 1 FROM he_consent c WHERE c.lead_id = m.lead_id AND c.consent_type = 'whatsapp_contact' AND c.revoked_at IS NULL) AS has_consent
       FROM he_match m JOIN he_lead l ON l.id = m.lead_id
      WHERE m.drive_id = ? AND m.state = 'suggested' AND l.status <> 'opted_out'
      ORDER BY has_email DESC, m.score DESC LIMIT ?`, [driveId, Math.max(1, Math.min(2000, Math.floor(o.max)))]);
  const [tpl] = await db.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM he_template WHERE template_key LIKE 'he_walkin_invite:%' AND approval_state = 'approved'");
  const waTemplateOk = Number(tpl[0]?.n ?? 0) > 0;
  const quiet = istHour(new Date()) >= 20 || istHour(new Date()) < 9;
  const canEmail = emailConfigured();
  for (const m of ms) {
    out.considered++;
    const step = nextCadenceStep({ now: new Date(), gapMin: cadenceGapMin(), canEmail: Boolean(Number(m.has_email)) && canEmail, waConsent: Boolean(Number(m.has_consent)) && waTemplateOk, emailSentAt: null, waSentAt: null, voiceAt: null, repliedAfterFirstTouch: false, quietHours: quiet });
    const reason = step.step ? (step.step === "email" ? "email first" : "WhatsApp first (no email address)")
      : step.reason === "no_channel" ? (Number(m.has_email) && !canEmail ? "email not configured on the server" : Number(m.has_consent) && !waTemplateOk ? "WhatsApp template not approved yet" : "no email and no WhatsApp opt-in")
      : step.reason === "quiet_hours" ? "outside 09:00-20:00 IST" : step.reason;
    if (out.planned.length < 500) out.planned.push({ matchId: m.id, leadId: m.lead_id, name: m.full_name ?? null, mobile: String(m.mobile10).slice(0, 2) + "xxxxxx" + String(m.mobile10).slice(-2), channel: step.step === "voice" ? null : step.step, reason });
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
export async function runFollowUps(o: { dryRun: boolean }): Promise<{ whatsapp: Counts; reminders: Counts; calls: Counts; recovery: Counts; replacement: Counts; noShows: number; otherRoles: RerouteSummary | null }> {
  const out = { whatsapp: counts(), reminders: counts(), calls: counts(), recovery: counts(), replacement: counts(), noShows: 0, otherRoles: null as RerouteSummary | null };
  out.noShows = await noShows(o.dryRun, out.recovery); // state hygiene runs even while sends are paused
  if (sendsPaused()) return out;
  await replacementSlots(o.dryRun, out.replacement, 50);
  await whatsappFollowUps(o.dryRun, out.whatsapp, 200);
  await reminders(o.dryRun, out.reminders);
  await voiceCalls(o.dryRun, out.calls, 50);
  out.otherRoles = await offerOtherRoles({ dryRun: o.dryRun, max: 50 });
  return out;
}

/** Step 2: matches whose invite EMAIL went out a cadence gap ago and have no WhatsApp invite yet get the WhatsApp invite now. */
async function whatsappFollowUps(dryRun: boolean, c: Counts, max: number): Promise<void> {
  const gap = cadenceGapMin();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.lead_id, m.slot_at, e.created_at AS email_at, (SELECT best_hour_ist FROM he_lead_insight i WHERE i.lead_id = m.lead_id) AS best_hour FROM he_match m
       JOIN he_message e ON e.lead_id = m.lead_id AND e.requisition_id = m.requisition_id AND e.template_key = ? AND e.direction = 'out' AND e.delivery_status <> 'failed'
      WHERE m.state = 'invited' AND m.slot_at > NOW() AND e.created_at <= DATE_SUB(NOW(), INTERVAL ? MINUTE)
        AND NOT EXISTS (SELECT 1 FROM he_message w WHERE w.lead_id = m.lead_id AND w.direction = 'out' AND w.template_key LIKE 'he_walkin_invite:%' AND w.created_at >= e.created_at)
        AND NOT EXISTS (SELECT 1 FROM he_message i WHERE i.lead_id = m.lead_id AND i.direction = 'in' AND i.created_at >= e.created_at)
        AND EXISTS (SELECT 1 FROM he_consent k WHERE k.lead_id = m.lead_id AND k.consent_type = 'whatsapp_contact' AND k.revoked_at IS NULL)
      ORDER BY m.slot_at LIMIT ?`, [INVITE_EMAIL_KEY, gap, max]);
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
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT m.id, m.lead_id, m.drive_id FROM he_match m
        WHERE m.state = 'confirmed' AND m.slot_at BETWEEN DATE_ADD(NOW(), INTERVAL ? MINUTE) AND DATE_ADD(NOW(), INTERVAL ? MINUTE)`, [loMin, hiMin]);
    for (const r of rows) {
      if (await eventExists(r.lead_id as string, r.drive_id as string, evt)) continue;
      const res = await sendTemplateToLead({ leadId: r.lead_id as string, key, matchId: r.id as string, dryRun });
      tally(c, res);
      if (res.status === "sent") await addEvent(r.lead_id as string, evt, { driveId: r.drive_id as string, channel: "whatsapp" });
    }
  }
}

/** A candidate who filled the branch walk-in form on the drive day (matched by mobile) has arrived. */
async function arrivalSync(dryRun: boolean): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.lead_id, m.drive_id FROM he_match m
       JOIN he_drive d ON d.id = m.drive_id AND d.drive_date = CURDATE()
       JOIN he_lead l ON l.id = m.lead_id
       JOIN ats_candidate c ON RIGHT(REGEXP_REPLACE(c.mobile, '[^0-9]', ''), 10) = l.mobile10 AND c.walk_in_date = CURDATE()
      WHERE m.state IN ('invited','confirmed')`);
  if (dryRun) return rows.length;
  for (const r of rows) {
    await db.execute("UPDATE he_match SET state = 'arrived' WHERE id = ?", [r.id]);
    await setLeadStatus(r.lead_id as string, "arrived");
    await addEvent(r.lead_id as string, "arrived", { driveId: r.drive_id as string, channel: "branch", detail: "registered at branch" });
    await recomputeInsight(r.lead_id as string);
  }
  return rows.length;
}

async function noShows(dryRun: boolean, c: Counts): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.lead_id, m.drive_id FROM he_match m
      WHERE m.state IN ('invited','confirmed') AND m.slot_at IS NOT NULL AND m.slot_at < DATE_SUB(NOW(), INTERVAL 120 MINUTE)
        AND m.slot_at > DATE_SUB(NOW(), INTERVAL 2 DAY)`);
  for (const r of rows) {
    if (dryRun) continue;
    await db.execute("UPDATE he_match SET state = 'no_show' WHERE id = ?", [r.id]);
    await setLeadStatus(r.lead_id as string, "no_show");
    await addEvent(r.lead_id as string, "no_show", { driveId: r.drive_id as string, channel: "system" });
    await recomputeInsight(r.lead_id as string);
    // One recovery message for a first no-show only; the insight stops it after two.
    const [ns] = await db.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM he_match WHERE lead_id = ? AND state = 'no_show'", [r.lead_id]);
    if (Number(ns[0].n) === 1) tally(c, await sendTemplateToLead({ leadId: r.lead_id as string, key: "he_no_show_recovery", matchId: r.id as string }));
  }
  return rows.length;
}

export async function runEngineTick(o: { dryRun?: boolean; maxInvites?: number } = {}): Promise<TickSummary> {
  const dryRun = o.dryRun !== false; // safe default: only an explicit false sends
  const s: TickSummary = { dryRun, paused: sendsPaused(), replacementSlots: counts(), invites: counts(), reminders: counts(), arrivals: 0, noShows: 0, recovery: counts(), calls: counts(), bulkCalls: null, otherRoles: null };
  const guard = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (err) { logger.error({ err: (err as Error).message, step: name }, "[he-engine] step failed"); } };
  // Arrival + no-show bookkeeping is state hygiene, not outreach, so it runs even while sends are paused.
  await guard("arrival", async () => { s.arrivals = await arrivalSync(dryRun); });
  await guard("noshow", async () => { s.noShows = await noShows(dryRun, s.recovery); });
  if (!s.paused) {
    await guard("replacement", () => replacementSlots(dryRun, s.replacementSlots, 50));
    await guard("invites", () => driveInvites(dryRun, s.invites, o.maxInvites ?? 100));
    await guard("whatsapp-follow-ups", () => whatsappFollowUps(dryRun, s.invites, o.maxInvites ?? 100));
    await guard("reminders", () => reminders(dryRun, s.reminders));
    await guard("voice", () => voiceCalls(dryRun, s.calls, 20));
    await guard("bulk-calls", async () => { s.bulkCalls = await runBulkCallJobs({ dryRun, max: 20 }); });
    await guard("other-role-offers", async () => { s.otherRoles = await offerOtherRoles({ dryRun, max: 50 }); });
  }
  return s;
}
