/**
 * Stage B of the unified follow-up, for every source: what happens around a booking the person already has. Journeys are found by
 * qf.match_id joined to he_match (the booking truth). Answers (T2 confirmation, T5 new slot, T10 STOP acknowledgement) are transactional;
 * reminders (T3 + D-1 email, T4) and the no-show recovery (T6 + email, confirmed people only, first no-show only) are unprompted and use
 * the shared budget before stage A. Never-confirmed people after their slot get no message and wait for a re-invite (D5), which re-enters
 * stage A after 7 days within the D7 limits.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { checkFollowupGuards, type GuardStep } from "./followup-guards.js";
import { recordGuardSkip } from "./followup-guards.service.js";
import { loadGuardFacts } from "./followup-guard-facts.service.js";
import { personFacts, releasePerson } from "./followup-person.service.js";
import { reserveSlot } from "./he-drive.service.js";
import { sendFollowUpEmail } from "./he-followup-email.service.js";
import { addEvent } from "./he-lead.service.js";
import { offerOtherRoles } from "./he-reroute.service.js";
import { sendTemplateToLead, type SendResult } from "./he-send.service.js";
import type { TemplateKey } from "./he-template-catalog.js";
import type { TransitionPlan } from "./he-state.js";
import { d1SendAt, noShowDueAt, reinviteAllowed, t4SendAt } from "./qualified-followup.cadence.js";
import { emptyCounts, ROW_COLUMNS, toFollowupRow, type FollowupRow, type StepCounts } from "./qualified-followup.context.js";
import { readSwitches, type FollowupSwitches } from "./qualified-followup.policy.js";
import { recordShadow } from "./qualified-followup.shadow.js";
import { dueTimes } from "./qualified-followup.schedule.js";
import type { StepScope } from "./qualified-followup.stagea.js";
import type { JourneyState, RowTag } from "./qualified-followup.types.js";

export interface StageBCounts { confirm: StepCounts; reschedule: StepCounts; d1: StepCounts; t4: StepCounts; noShow: StepCounts; reinvite: StepCounts; otherRole: StepCounts }
export type TransactionalKey = "he_walkin_confirmed" | "he_reschedule_offer" | "he_optout_ack";

const OWNED = "qf.mode_at_enqueue IN ('live','canary','test')";
const ist = (v: unknown): Date => new Date(String(v).replace(" ", "T").slice(0, 19) + "+05:30");
const HOUR = 3600_000;

/** Any reply ends stage A (no more cadence touches); a confirm / decline / STOP sets its own state; later stage B states are kept. */
export function journeyAfterReply(current: JourneyState, plan: TransitionPlan): JourneyState {
  if (plan.event === "opted_out") return "stopped";
  if (plan.matchState === "confirmed") return "confirmed";
  if (plan.matchState === "declined") return "declined";
  return current === "enrolled" || current === "reach" || current === "held_best_offer" ? "engaged" : current;
}

/** The live / canary / test journey booked on this match (dry_run rows never own anyone). */
export async function ownedJourneyForMatch(matchId: string): Promise<FollowupRow | null> {
  const [r] = await db.execute<RowDataPacket[]>(`SELECT ${ROW_COLUMNS} FROM qualified_followup qf WHERE qf.match_id = ? AND ${OWNED} AND qf.owner = 'pipeline' LIMIT 1`, [matchId]);
  return r[0] ? toFollowupRow(r[0]) : null;
}

export async function ownedJourneysForMobile(mobile10: string): Promise<FollowupRow[]> {
  const [r] = await db.execute<RowDataPacket[]>(`SELECT ${ROW_COLUMNS} FROM qualified_followup qf WHERE qf.mobile10 = ? AND ${OWNED} AND qf.owner = 'pipeline'`, [mobile10]);
  return r.map(toFollowupRow);
}

async function guardB(s: { killSwitch: boolean; pausedSources: ReadonlySet<string>; uploadWa: boolean }, row: FollowupRow, now: Date, step: GuardStep, o: { transactional: boolean; waBudgetLeft: number; optOutAck?: boolean }) {
  const f = await loadGuardFacts({
    row, step, now, transactional: o.transactional, firstContact: false, cadenceStep: false, stage: "B",
    killSwitch: s.killSwitch, sourcePaused: s.pausedSources.has(row.sourceType), waBudgetLeft: o.waBudgetLeft, branchCapLeft: null, uploadWaAllowed: s.uploadWa,
  });
  // The STOP acknowledgement answers the STOP itself: the opt-out it confirms must not block it.
  const v = checkFollowupGuards(o.optOutAck ? { ...f, optedOut: false } : f);
  if (!v.ok) await recordGuardSkip(row.id, row.heLeadId, step, v.reason, now).catch(() => false);
  return v;
}

const redirectFor = (s: FollowupSwitches | ReturnType<typeof readSwitches>, row: FollowupRow) => (row.modeAtEnqueue === "test" ? (s.testPhone ?? "") : undefined);

/** T2 / T5 / T10 for an owned journey: guarded as transactional (any hour, no caps), once per drive, tagged as the follow-up worker's. */
export async function sendTransactionalForJourney(row: FollowupRow, key: TransactionalKey, o: { now: Date; switches?: FollowupSwitches }): Promise<SendResult> {
  const s = o.switches ?? readSwitches();
  if (!row.heLeadId || !row.matchId) return { status: "blocked", reason: "no_booking" };
  const v = await guardB(s, row, o.now, "whatsapp", { transactional: true, waBudgetLeft: 1, optOutAck: key === "he_optout_ack" });
  if (!v.ok) return { status: "blocked", reason: v.reason };
  const [dup] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM he_message w WHERE w.lead_id = ? AND w.direction = 'out' AND w.template_key LIKE ? AND w.delivery_status <> 'failed'
        AND w.drive_id <=> (SELECT drive_id FROM he_match WHERE id = ?) LIMIT 1`, [row.heLeadId, `${key}:%`, row.matchId]);
  if (dup.length && key !== "he_reschedule_offer") return { status: "blocked", reason: "already_sent" };
  const r = await sendTemplateToLead({ leadId: row.heLeadId, key, matchId: row.matchId, transactional: true, sentBy: "followup", redirectTo: redirectFor(s, row) });
  // Test rows: the person never sees anything (the WhatsApp went to the owner); no email to the person either.
  if (key === "he_walkin_confirmed" && row.modeAtEnqueue !== "test") await sendFollowUpEmail("confirmed", row.matchId, { sentBy: "followup" }).catch((err: unknown) => logger.warn({ rowId: row.id, err: (err as Error).message }, "[qualified-followup] confirmation email failed"));
  return r;
}

const tally = (c: StepCounts, r: SendResult) => {
  c.processed++;
  if (r.status === "sent") c.sent++; else if (r.status === "failed") c.failed++; else if (r.status === "dry_run") c.dryRun++; else c.blocked++;
};

type JRow = FollowupRow & { mState: string; slotAt: Date | null; driveId: string | null; leadId: string; extra: RowDataPacket };
const J = (r: RowDataPacket): JRow => ({ ...toFollowupRow(r), mState: String(r.m_state ?? ""), slotAt: r.m_slot ? ist(r.m_slot) : null, driveId: r.m_drive ?? r.drive_id ?? null, leadId: String(r.m_lead ?? r.he_lead_id ?? ""), extra: r });

async function selectJourneys(marker: string, where: string, tag: RowTag, o: StepScope, extraCols = ""): Promise<JRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `/* stageb:${marker} */ SELECT ${ROW_COLUMNS}, hm.state AS m_state, hm.slot_at AS m_slot, hm.drive_id AS m_drive, hm.lead_id AS m_lead${extraCols}
       FROM qualified_followup qf JOIN he_match hm ON hm.id = qf.match_id
      WHERE qf.mode_at_enqueue = ? AND qf.source_type IN (${o.sources.map(() => "?").join(",")}) AND qf.stopped_reason IS NULL AND qf.owner = 'pipeline' AND ${where}
      ORDER BY hm.slot_at LIMIT ${Math.max(1, Math.floor(o.limit ?? 200))}`, [tag, ...o.sources]);
  return rows.map(J);
}

/** One unprompted stage B WhatsApp (T3 / T4 / T6): guarded, from the shared budget, tagged; dry_run writes a shadow row instead. */
async function unprompted(s: FollowupSwitches, tag: RowTag, row: JRow, key: TemplateKey, now: Date, o: StepScope, c: StepCounts): Promise<boolean> {
  if (tag === "dry_run") { await recordShadow(row, key, "would_send", key, now); c.dryRun++; return true; }
  const v = await guardB(s, row, now, "whatsapp", { transactional: false, waBudgetLeft: o.budget.waLeft });
  if (!v.ok) { c.held++; return false; }
  const r = await sendTemplateToLead({ leadId: row.leadId, key, matchId: row.matchId, followupStep: true, sentBy: "followup", redirectTo: redirectFor(s, row) });
  tally(c, r);
  if (r.status === "sent") o.budget.waLeft--;
  return r.status === "sent" || r.status === "failed"; // a failed send is not retried every 5 minutes (as the engine does)
}

async function reminders(s: FollowupSwitches, tag: RowTag, now: Date, o: StepScope, out: StageBCounts): Promise<void> {
  const rows = await selectJourneys("reminders", "hm.state = 'confirmed' AND qf.journey_state IN ('confirmed','reminded','engaged') AND hm.slot_at > NOW() AND hm.slot_at < DATE_ADD(NOW(), INTERVAL 3 DAY)", tag, o,
    `, EXISTS (SELECT 1 FROM he_lead_event e WHERE e.lead_id = hm.lead_id AND e.drive_id = hm.drive_id AND e.event_type = 'reminder_1d_sent') AS d1_done,
       EXISTS (SELECT 1 FROM he_lead_event e WHERE e.lead_id = hm.lead_id AND e.drive_id = hm.drive_id AND e.event_type = 'reminder_2h_sent') AS d2_done`);
  for (const row of rows) {
    if (row.mState !== "confirmed" || !row.slotAt || row.slotAt.getTime() <= now.getTime()) continue;
    try {
      const slot = row.slotAt.getTime();
      if (!Number(row.extra.d1_done) && now.getTime() >= d1SendAt(row.slotAt).getTime() && now.getTime() < slot - 12 * HOUR) {
        if (await unprompted(s, tag, row, "he_reminder_1d", now, o, out.d1) && tag !== "dry_run") {
          await addEvent(row.leadId, "reminder_1d_sent", { driveId: row.driveId, channel: "whatsapp", detail: "followup" });
          if (row.modeAtEnqueue !== "test") await sendFollowUpEmail("reminder_1d", row.matchId as string, { sentBy: "followup" });
          await db.execute("UPDATE qualified_followup SET journey_state = 'reminded' WHERE id = ? AND journey_state IN ('confirmed','engaged')", [row.id]);
        }
      } else if (!Number(row.extra.d2_done) && now.getTime() >= t4SendAt(row.slotAt).getTime()) {
        if (await unprompted(s, tag, row, "he_reminder_2h_location", now, o, out.t4) && tag !== "dry_run") {
          await addEvent(row.leadId, "reminder_2h_sent", { driveId: row.driveId, channel: "whatsapp", detail: "followup" });
        }
      }
    } catch (err) { logger.warn({ rowId: row.id, err: (err as Error).message }, "[qualified-followup] reminder failed for row"); }
  }
}

async function noShows(s: FollowupSwitches, tag: RowTag, now: Date, o: StepScope, out: StageBCounts): Promise<void> {
  const rows = await selectJourneys("noshow", "hm.state = 'no_show' AND qf.journey_state NOT IN ('reinvite_wait','arrived','declined','stopped','no_show')", tag, o,
    `, (SELECT COUNT(*) FROM he_match x WHERE x.lead_id = hm.lead_id AND x.state = 'no_show') AS no_shows,
       EXISTS (SELECT 1 FROM he_lead_event e WHERE e.lead_id = hm.lead_id AND e.drive_id = hm.drive_id AND e.event_type = 'no_show_recovery_sent') AS t6_done`);
  for (const row of rows) {
    try {
      const confirmed = row.journeyState === "confirmed" || row.journeyState === "reminded";
      // D5: T6 only for someone who said yes and did not come, once, for a first no-show; never-confirmed people get no message.
      if (confirmed && Number(row.extra.no_shows) === 1 && !Number(row.extra.t6_done) && row.slotAt) {
        if (now.getTime() < noShowDueAt(row.slotAt).getTime()) continue;
        const sent = await unprompted(s, tag, row, "he_no_show_recovery", now, o, out.noShow);
        if (!sent) continue;
        if (tag === "dry_run") continue;
        await addEvent(row.leadId, "no_show_recovery_sent", { driveId: row.driveId, channel: "whatsapp", detail: "followup" });
        if (row.modeAtEnqueue !== "test") await sendFollowUpEmail("no_show", row.matchId as string, { sentBy: "followup" });
      }
      if (tag === "dry_run") continue;
      await db.execute("UPDATE qualified_followup SET journey_state = 'reinvite_wait' WHERE id = ? AND journey_state NOT IN ('arrived','declined','stopped')", [row.id]);
      await releasePerson(row.mobile10, row.id);
    } catch (err) { logger.warn({ rowId: row.id, err: (err as Error).message }, "[qualified-followup] no-show step failed for row"); }
  }
}

/** Journeys whose booking ended (arrived / selected / declined) end too, and their person is free for other requisitions. */
async function endedBookings(tag: RowTag): Promise<void> {
  if (tag === "dry_run") return;
  await db.execute(
    `UPDATE qualified_followup qf JOIN he_match m ON m.id = qf.match_id
        SET qf.journey_state = 'arrived' WHERE qf.mode_at_enqueue = ? AND m.state IN ('arrived','selected') AND qf.journey_state NOT IN ('arrived','stopped')`, [tag]);
  await db.execute(
    `UPDATE qualified_followup qf JOIN he_match m ON m.id = qf.match_id
        SET qf.journey_state = 'declined' WHERE qf.mode_at_enqueue = ? AND m.state = 'declined' AND qf.journey_state NOT IN ('declined','arrived','stopped')`, [tag]);
  await db.execute(
    `UPDATE followup_person fp JOIN qualified_followup qf ON qf.id = fp.active_followup_id
        SET fp.active_followup_id = NULL WHERE qf.mode_at_enqueue = ? AND (qf.journey_state IN ('arrived','declined','stopped','reinvite_wait') OR qf.stopped_reason IS NOT NULL)`, [tag]);
}

async function reschedules(s: FollowupSwitches, tag: RowTag, now: Date, o: StepScope, out: StageBCounts): Promise<void> {
  const rows = await selectJourneys("reschedule",
    `hm.state = 'slot_released' AND hm.drive_id IS NOT NULL
      AND (SELECT MAX(id) FROM he_lead_event e WHERE e.lead_id = hm.lead_id AND e.event_type = 'reschedule_requested')
        > GREATEST(COALESCE((SELECT MAX(id) FROM he_lead_event e WHERE e.lead_id = hm.lead_id AND e.event_type = 'slot_offered'), 0),
                   COALESCE((SELECT MAX(id) FROM he_lead_event e WHERE e.lead_id = hm.lead_id AND e.event_type = 'needs_human_followup'), 0))`, tag, o,
    ", (SELECT COUNT(*) FROM he_lead_event e WHERE e.lead_id = hm.lead_id AND e.event_type = 'reschedule_requested') AS requests");
  for (const row of rows) {
    try {
      if (tag === "dry_run") { await recordShadow(row, "reschedule", "would_send", "he_reschedule_offer", now); out.reschedule.dryRun++; continue; }
      if (Number(row.extra.requests) > 1) { await addEvent(row.leadId, "needs_human_followup", { channel: "system", detail: "second reschedule request" }); out.reschedule.blocked++; continue; }
      const slot = await reserveSlot(row.matchId as string, true);
      if (!slot) { await addEvent(row.leadId, "needs_human_followup", { channel: "system", detail: "no free slot to reschedule into" }); out.reschedule.blocked++; continue; }
      const r = await sendTransactionalForJourney(row, "he_reschedule_offer", { now, switches: s });
      const em = row.modeAtEnqueue === "test" ? { status: "blocked" as const } : await sendFollowUpEmail("reschedule_offer", row.matchId as string, { sentBy: "followup" });
      tally(out.reschedule, r);
      if (r.status === "sent" || em.status === "sent") await db.execute("UPDATE he_match SET state = 'invited' WHERE id = ?", [row.matchId]);
      else await db.execute("UPDATE he_match SET slot_at = NULL WHERE id = ?", [row.matchId]); // not sent on any channel: do not hold the seat
    } catch (err) { logger.warn({ rowId: row.id, err: (err as Error).message }, "[qualified-followup] reschedule failed for row"); }
  }
}

async function reinvites(tag: RowTag, now: Date, o: StepScope, out: StageBCounts): Promise<void> {
  const rows = await selectJourneys("reinvite", "qf.journey_state = 'reinvite_wait'", tag, o);
  for (const row of rows) {
    try {
      const p = await personFacts(row.mobile10);
      const [f] = await db.execute<RowDataPacket[]>(
        // D7 approaches = invitations only (owner ruling 2026-10-09): one invitation run (email / WhatsApp of a requisition on a day) counts
        // once; answers and reminders (T2-T6, T10, confirmation emails) never count. The line-up gate keeps he_attempt_v.
        `SELECT (SELECT COUNT(DISTINCT a.requisition_id, DATE(a.created_at)) FROM he_message a WHERE a.mobile10 = ? AND a.direction = 'out' AND a.delivery_status <> 'failed'
                   AND a.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                   AND (a.template_key = 'he_walkin_invite_email' OR a.template_key LIKE 'he_walkin_invite:%' OR a.template_key LIKE 'he_winback:%'
                        OR a.template_key LIKE 'he_reinvite:%' OR a.template_key LIKE 'he_other_role_offer:%')) AS approaches,
                (SELECT COUNT(*) FROM he_lead_event e JOIN he_drive d ON d.id = e.drive_id WHERE e.lead_id = ? AND e.event_type = 'no_show' AND d.requisition_id = ?) AS no_shows,
                (SELECT status FROM he_lead WHERE id = ?) AS lead_status`, [row.mobile10, row.leadId, row.requisitionId, row.leadId]);
      const ok = reinviteAllowed({
        now, lastFirstContactAt: p.lastFirstContactAt, reinvites30d: p.reinvites30d, approaches30d: Number(f[0]?.approaches ?? 0),
        noShowsForRequisition: Number(f[0]?.no_shows ?? 0), declined: row.mState === "declined", optedOut: p.optedOutAt != null || f[0]?.lead_status === "opted_out", hrOverride: false,
      });
      if (!ok.ok) continue;
      if (tag === "dry_run") { await recordShadow(row, "reinvite", "would_send", null, now); out.reinvite.dryRun++; continue; }
      const due = dueTimes({ enrolledAt: now, hasEmail: !!row.email });
      // Stage A again from the start (T12 / T8 by the chooser, a new booking by the stage A prelude).
      await db.execute(
        `UPDATE qualified_followup SET reinvite_no = reinvite_no + 1, journey_state = 'enrolled', stage_a_ended_at = NULL,
                email_due_at = ?, email_sent_at = NULL, email_status = NULL, email_error = NULL, email_attempts = 0,
                wa_due_at = ?, wa_sent_at = NULL, wa_status = NULL, wa_error = NULL, wa_attempts = 0, wa_template_key = NULL, wa_message_id = NULL,
                call_due_at = NULL, call_state = 'pending', call_attempts = 0, call_error = NULL, call_file_batch_id = NULL, called_at = NULL, call_result = NULL,
                missed_call_due_at = NULL, missing_details = NULL
          WHERE id = ? AND journey_state = 'reinvite_wait'`, [due.emailDueAt, due.waDueAt, row.id]);
      out.reinvite.processed++;
    } catch (err) { logger.warn({ rowId: row.id, err: (err as Error).message }, "[qualified-followup] re-invite failed for row"); }
  }
}

export async function runStageB(s: FollowupSwitches, tag: RowTag, now: Date, o: StepScope): Promise<StageBCounts> {
  const out: StageBCounts = { confirm: emptyCounts(), reschedule: emptyCounts(), d1: emptyCounts(), t4: emptyCounts(), noShow: emptyCounts(), reinvite: emptyCounts(), otherRole: emptyCounts() };
  const step = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (err) { logger.warn({ step: name, err: (err as Error).message }, "[qualified-followup] stage B step failed"); } };
  await step("ended", () => endedBookings(tag));
  await step("reschedule", () => reschedules(s, tag, now, o, out));
  await step("reminders", () => reminders(s, tag, now, o, out));
  await step("no-show", () => noShows(s, tag, now, o, out));
  await step("reinvite", () => reinvites(tag, now, o, out));
  if (tag === "live" || tag === "canary") {
    await step("other-role", async () => {
      const r = await offerOtherRoles({ max: 50, scope: "enrolled_only" });
      out.otherRole.sent += r.offered; out.otherRole.processed += r.considered;
    });
  }
  return out;
}
