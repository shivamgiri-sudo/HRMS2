/**
 * Inbound capture. Every WhatsApp reply, delivery status, email event and voice result lands here:
 * stored raw, mined into signals, applied to lead/match state, mirrored to meta_lead_raw so the existing
 * Meta inbox pages stay correct, then the lead insight is recomputed.
 */
import { dequeueSuperbotForMatch } from "./he-superbot.service.js";
import { refreshLeadHistoryById } from "./he-master.service.js";
import { answerCandidateQuestion, isLocationTap, sendLocationLink } from "./he-bot.service.js";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { logText } from "./log-text.js";
import { normalizeMobile10 } from "./he-phone.js";
import {
  callOutcome, signalsFromEmailEvent, signalsFromReply, signalsFromVoice,
  type EmailEvent, type VoiceResult,
} from "./he-signals.js";
import { planFromCallOutcome, planFromReply, type LeadStatus, type TransitionPlan } from "./he-state.js";
import { addEvent, findLeadByMobile, persistSignals, revokeConsent, setLeadStatus, upsertLead } from "./he-lead.service.js";
import { recomputeInsight } from "./he-insight.service.js";
import { sendTemplateToLead } from "./he-send.service.js";
import type { TemplateKey } from "./he-template-catalog.js";
import { markFollowupCalled } from "./qualified-followup.attention.js";
import { callResultCode } from "./qualified-followup.callresult.js";
import { journeyAfterReply, ownedJourneyForMatch, sendTransactionalForJourney } from "./qualified-followup.stageb.js";
import { followupMode } from "./qualified-followup.schedule.js";
import { recordPersonOptOut } from "./followup-optout.service.js";
import { sendFollowUpEmail } from "./he-followup-email.service.js";
import { recordResponseSafe } from "./candidate-response.service.js";
import { classifyReply } from "./response-classifier.js";
import { answerFromCallOutcome, answerFromIntent, answerFromInviteTap, intentFromButtonId, type ResponseChannel } from "./response-normalise.js";

const isDuplicateKey = (e: unknown) => (e as { code?: string; errno?: number })?.code === "ER_DUP_ENTRY" || (e as { errno?: number })?.errno === 1062;

async function activeMatch(leadId: string): Promise<{ id: string; slotOffers: number; requisitionId: string | null; driveId: string | null } | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, requisition_id, drive_id FROM he_match WHERE lead_id = ? AND state IN ('invited','confirmed','slot_released') ORDER BY updated_at DESC LIMIT 1`, [leadId]);
  if (!rows[0]) return null;
  const [o] = await db.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM he_lead_event WHERE lead_id = ? AND event_type = 'slot_offered'", [leadId]);
  return { id: rows[0].id as string, slotOffers: Number(o[0].n), requisitionId: (rows[0].requisition_id as string | null) ?? null, driveId: (rows[0].drive_id as string | null) ?? null };
}

/** A plan changed something (lead status, match state or consent): the response is "applied". */
const planApplied = (plan: TransitionPlan) => Boolean(plan.matchState || plan.leadStatus || plan.revokeConsent);

/** Mirror outcomes onto the Meta lead row so /ats/meta-leads and the WhatsApp inbox stay truthful. */
async function mirrorToMeta(metaLeadId: string | null, plan: TransitionPlan): Promise<void> {
  if (!metaLeadId) return;
  const confirmed = plan.leadStatus === "confirmed" || plan.leadStatus === "rescheduled" ? 1 : null;
  const resched = plan.event === "reschedule_requested" ? 1 : null;
  const declined = plan.leadStatus === "declined" || plan.leadStatus === "opted_out" ? 1 : null;
  if (confirmed == null && resched == null && declined == null) return;
  // meta_lead_raw.walkin_reply is VARCHAR(30) holding the same keywords the (retired) Wassenger webhook used to write.
  const keyword = confirmed ? "confirmed" : resched ? "reschedule" : "not_interested";
  await db.execute(
    `UPDATE meta_lead_raw SET
       walkin_confirmed = COALESCE(?, walkin_confirmed),
       walkin_reschedule_requested = COALESCE(?, walkin_reschedule_requested),
       walkin_declined = COALESCE(?, walkin_declined),
       walkin_reply = COALESCE(?, walkin_reply), walkin_reply_at = NOW()
     WHERE id = ?`,
    [confirmed, resched, declined, keyword, metaLeadId]);
}

/** Template follow-ups a state change triggers. Never fails the ingestion: a blocked/failed send is only logged. */
async function sendFollowUpTemplate(leadId: string, key: TemplateKey, matchId: string | null): Promise<void> {
  try {
    // Once per drive (or per lead without a match): a second confirm tap must not send a second T2.
    const [dup] = await db.execute<RowDataPacket[]>(
      `SELECT 1 FROM he_message w WHERE w.lead_id = ? AND w.direction = 'out' AND w.template_key LIKE ? AND w.delivery_status <> 'failed'
          AND (? IS NULL OR w.drive_id <=> (SELECT drive_id FROM he_match WHERE id = ?)) LIMIT 1`, [leadId, `${key}:%`, matchId, matchId]);
    if (dup.length) return;
    const r = await sendTemplateToLead({ leadId, key, matchId, transactional: true });
    if (r.status === "blocked") {
      // Visible to the report and ops reads (a blocked T2 used to be an info log only).
      logger.warn({ leadId, key, status: r.status, reason: r.reason }, "[he-ingest] follow-up template not sent");
      await addEvent(leadId, "followup_template_blocked", { channel: "whatsapp", detail: `${key}: ${r.reason}` });
    } else if (r.status !== "sent") logger.warn({ leadId, key, status: r.status, error: "error" in r ? r.error : undefined }, "[he-ingest] follow-up template not sent");
  } catch (err) { logger.warn({ leadId, key, err: logText(err) }, "[he-ingest] follow-up template failed"); }
}

async function applyPlan(leadId: string, current: LeadStatus, plan: TransitionPlan, ctx: { matchId: string | null; channel: string; detail: string | null; metaLeadId: string | null; replyText: string | null; ackStop?: boolean; defer?: Array<() => Promise<unknown>> }): Promise<void> {
  // A caller holding a lock queues the candidate-facing sends and runs them after releasing it.
  const send = async (fn: () => Promise<unknown>): Promise<void> => { if (ctx.defer) ctx.defer.push(fn); else await fn(); };
  // A journey of the unified follow-up booked on this match answers through it (guards, tagging, journey state). Nothing is read while
  // QUAL_FOLLOWUP_MODE is off, so people without a journey keep exactly today's path.
  const owned = ctx.matchId && followupMode() !== "off" ? await ownedJourneyForMatch(ctx.matchId).catch(() => null) : null;
  // T10: acknowledge STOP while the consent still exists (the reply opened a 24h window); suppression follows below.
  // A Stop tapped on the web page is acknowledged on the page itself, not by a WhatsApp message.
  if (plan.event === "opted_out" && ctx.ackStop !== false) {
    if (owned) await sendTransactionalForJourney(owned, "he_optout_ack", { now: new Date() }).catch((err: unknown) => logger.warn({ leadId, err: logText(err) }, "[he-ingest] STOP acknowledgement failed"));
    else await sendFollowUpTemplate(leadId, "he_optout_ack", ctx.matchId);
  }
  if (plan.leadStatus && plan.leadStatus !== current) await setLeadStatus(leadId, plan.leadStatus);
  if (plan.matchState && ctx.matchId) await db.execute("UPDATE he_match SET state = ? WHERE id = ?", [plan.matchState, ctx.matchId]);
  if (plan.revokeConsent) await revokeConsent(leadId, "whatsapp_contact");
  await addEvent(leadId, plan.event, { channel: ctx.channel, detail: ctx.detail });
  // STOP is held for the person and ends every follow-up journey of the mobile, whatever channel it came on (never needs the webhook verified).
  if (plan.event === "opted_out") {
    try {
      const [ml] = await db.execute<RowDataPacket[]>("SELECT mobile10 FROM he_lead WHERE id = ? LIMIT 1", [leadId]);
      if (ml[0]?.mobile10) await recordPersonOptOut(String(ml[0].mobile10), { source: ctx.channel === "whatsapp" ? "pinbot" : ctx.channel === "voice" ? "call" : "web", viaIngest: true });
    } catch (err) { logger.warn({ leadId, err: logText(err) }, "[he-ingest] person opt-out record failed"); }
  }
  // They answered somewhere else (button, reply, email tap): a call still waiting in Superbot's queue must not ring them. Best effort.
  if (ctx.channel !== "voice" && ctx.matchId && (plan.matchState || plan.event === "opted_out")) void dequeueSuperbotForMatch(ctx.matchId);
  if (plan.humanHandoff) await addEvent(leadId, "needs_human_followup", { channel: ctx.channel, detail: "second decline / declined offered slot" });
  await mirrorToMeta(ctx.metaLeadId, plan);
  // Only an answer moves the journey: a call nobody picked up (or a failed / wrong-person call) is not a reply.
  if (owned && (!plan.event.startsWith("call_") || plan.matchState !== null)) {
    const next = journeyAfterReply(owned.journeyState, plan);
    if (next !== owned.journeyState) {
      await db.execute(
        `UPDATE qualified_followup SET journey_state = ?, stage_a_ended_at = COALESCE(stage_a_ended_at, IF(? IN ('enrolled','reach','held_best_offer'), NOW(), NULL))${next === "stopped" ? ", stopped_reason = COALESCE(stopped_reason, 'opted_out'), stopped_at = COALESCE(stopped_at, NOW())" : ""} WHERE id = ?`,
        [next, owned.journeyState, owned.id]);
    }
  }
  // T2: appointment details + reference once the candidate confirms (button, email tap or bot call).
  if (plan.matchState === "confirmed" && ctx.matchId) {
    const matchId = ctx.matchId;
    if (owned) await send(() => sendTransactionalForJourney(owned, "he_walkin_confirmed", { now: new Date() }).catch((err: unknown) => logger.warn({ leadId, err: logText(err) }, "[he-ingest] confirmation failed")));
    else {
      await send(() => sendFollowUpTemplate(leadId, "he_walkin_confirmed", matchId));
      await send(async () => { try { await sendFollowUpEmail("confirmed", matchId); } catch (err) { logger.warn({ leadId, err: logText(err) }, "[he-ingest] confirmation email failed"); } });
    }
  }
  // T9: the bot could not reach them twice -> ask on WhatsApp instead (a journey gets its T9 from the follow-up worker).
  if (plan.event === "call_no_answer" && ctx.matchId && !owned) {
    const [n] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM he_lead_event WHERE lead_id = ? AND event_type = 'call_no_answer' AND created_at >= (SELECT COALESCE(MAX(created_at), '2000-01-01') FROM he_message WHERE lead_id = ? AND direction = 'out' AND template_key = 'he_walkin_invite_email')", [leadId, leadId]);
    if (Number(n[0].n) >= 2) await sendFollowUpTemplate(leadId, "he_missed_call", ctx.matchId);
  }
}

export async function recordInboundReply(p: { mobile: string; text: string; providerMessageId?: string | null; channel?: "whatsapp" | "email"; buttonId?: string | null }): Promise<{ leadId: string; intent: string } | null> {
  const mobile10 = normalizeMobile10(p.mobile);
  if (!mobile10) return null;
  const channel = p.channel ?? "whatsapp";
  let lead = await findLeadByMobile(mobile10);
  if (!lead) {
    const created = await upsertLead({ mobile: mobile10, source: "inbound" });
    if (!created) return null;
    lead = await findLeadByMobile(mobile10);
    if (!lead) return null;
  }
  // Idempotent on provider retries.
  if (p.providerMessageId) {
    const [dup] = await db.execute<RowDataPacket[]>("SELECT 1 FROM he_message WHERE provider_message_id = ? AND direction = 'in' LIMIT 1", [p.providerMessageId]);
    if (dup.length) return { leadId: lead.id, intent: "duplicate" };
  }
  const parsed = signalsFromReply(p.text, channel);
  // A Pinbot quick-reply payload id we know decides the intent exactly; otherwise the words do (unchanged).
  const buttonIntent = intentFromButtonId(p.buttonId);
  const intent = buttonIntent ?? parsed.intent;
  const signals = parsed.signals;
  const [msg] = await db.execute<RowDataPacket[]>("SELECT UUID() AS id");
  const messageId = msg[0].id as string;
  // The in-row carries the requisition / drive of the match the reply is applied to (same pick as below), so it is never context-less.
  const match = await activeMatch(lead.id);
  try {
    await db.execute(
      "INSERT INTO he_message (id, lead_id, mobile10, direction, channel, body, provider_message_id, intent, requisition_id, drive_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [messageId, lead.id, mobile10, "in", channel, p.text.slice(0, 2000), p.providerMessageId ?? null, intent, match?.requisitionId ?? null, match?.driveId ?? null]);
  } catch (err) {
    // A concurrent retry of the same provider message won the insert (UNIQUE provider_message_id+direction): not an error.
    if (isDuplicateKey(err)) return { leadId: lead.id, intent: "duplicate" };
    throw err;
  }
  // Mark the most recent outbound message as replied (drives reply-rate analysis).
  const [lastOut] = await db.execute<RowDataPacket[]>(
    "SELECT id FROM he_message WHERE lead_id = ? AND direction = 'out' AND channel = ? ORDER BY created_at DESC LIMIT 1", [lead.id, channel]);
  if (lastOut[0]) await db.execute("INSERT INTO he_message_event (message_id, lead_id, channel, event_type) VALUES (?,?,?, 'replied')", [lastOut[0].id, lead.id, channel]);

  await persistSignals(lead.id, signals, messageId);
  const plan = planFromReply(lead.status, intent, match?.slotOffers ?? 0);
  await applyPlan(lead.id, lead.status, plan, { matchId: match?.id ?? null, channel, detail: p.text, metaLeadId: lead.meta_lead_id, replyText: p.text });
  const suggestion = intent === "unknown" ? classifyReply(p.text, { channel }) : null;
  await recordResponseSafe({
    occurredAt: new Date(), channel: channel as ResponseChannel, mode: buttonIntent ? "button" : "text", answer: answerFromIntent(intent), mobile10, leadId: lead.id,
    metaLeadId: lead.meta_lead_id, matchId: match?.id ?? null, sourceKind: "he_message", sourceRef: messageId, rawText: p.text, applied: planApplied(plan),
    // Words the reply rules could not read get a suggested class for the HR review queue (never applied automatically).
    suggested: suggestion ? { answer: suggestion.answer, confidence: suggestion.confidence } : null,
  });
  await recomputeInsight(lead.id);
  await refreshLeadHistoryById(lead.id);
  // Questions ("office kahan hai?", "kya laana hai?") get an instant answer from the invitation; the rest go to a human.
  if (channel === "whatsapp" && isLocationTap(p.text)) {
    try { await sendLocationLink(lead.id); } catch (err) { logger.warn({ err: logText(err) }, "[he-ingest] location link failed"); }
  } else if (intent === "unknown" && channel === "whatsapp") {
    try { await answerCandidateQuestion(lead.id, p.text); } catch (err) { logger.warn({ err: logText(err) }, "[he-ingest] bot answer failed"); }
  }

  return { leadId: lead.id, intent };
}

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";
export async function recordDeliveryStatus(providerMessageId: string, status: DeliveryStatus, error?: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT id, lead_id, channel, delivery_status FROM he_message WHERE provider_message_id = ? AND direction = 'out' LIMIT 1", [providerMessageId]);
  if (!rows[0]) return false;
  // Receipts arrive out of order and can be processed concurrently, so the "never downgrade" rule is ONE atomic
  // conditional UPDATE, not a read-then-write. 'failed' is always recorded.
  const rank = "FIELD(delivery_status, 'queued', 'sent', 'delivered', 'read')";
  const [upd] = await db.execute<ResultSetHeader>(
    `UPDATE he_message SET delivery_status = ?, error_message = ?
      WHERE id = ? AND (? = 'failed' OR delivery_status IS NULL OR ${rank} < FIELD(?, 'queued', 'sent', 'delivered', 'read'))`,
    [status, error ? error.slice(0, 500) : null, rows[0].id, status, status]);
  if (upd.affectedRows === 0) return true; // an equal-or-later status was already recorded
  await db.execute("INSERT INTO he_message_event (message_id, lead_id, channel, event_type, detail) VALUES (?,?,?,?,?)", [rows[0].id, rows[0].lead_id, rows[0].channel, status, error ? error.slice(0, 300) : null]);
  if (rows[0].lead_id) await recomputeInsight(rows[0].lead_id as string);
  return true;
}

export async function recordEmailEvent(p: { providerMessageId: string; event: EmailEvent; detail?: string }): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT id, lead_id, mobile10 FROM he_message WHERE provider_message_id = ? AND channel = 'email' LIMIT 1", [p.providerMessageId]);
  if (!rows[0]) return false;
  const leadId = rows[0].lead_id as string | null;
  const map: Record<EmailEvent, string> = { sent: "sent", delivered: "delivered", opened: "opened", clicked: "clicked", bounced: "bounced", replied: "replied", unsubscribed: "unsubscribed" };
  await db.execute("INSERT INTO he_message_event (message_id, lead_id, channel, event_type, detail) VALUES (?,?,'email',?,?)", [rows[0].id, leadId, map[p.event], p.detail?.slice(0, 300) ?? null]);
  if (leadId) {
    await persistSignals(leadId, signalsFromEmailEvent(p.event, p.detail), String(rows[0].id));
    if (p.event === "unsubscribed") await revokeConsent(leadId, "whatsapp_contact");
    await recomputeInsight(leadId);
  }
  // An unsubscribe is a STOP for the person: every follow-up journey ends (it used to revoke only the WhatsApp consent).
  if (p.event === "unsubscribed" && rows[0].mobile10) {
    try { await recordPersonOptOut(String(rows[0].mobile10), { source: "email_unsubscribe" }); }
    catch (err) { logger.warn({ err: logText(err) }, "[he-ingest] unsubscribe opt-out record failed"); }
  }
  return true;
}

export interface VoiceCallbackInput {
  leadId?: string;
  mobile?: string;
  providerCallId?: string | null;
  attemptNo?: number;
  startedAt?: string | null;
  result: VoiceResult;
  offeredSlotAt?: string | null; // YYYY-MM-DD HH:MM:SS IST, from the slot service
  /** The slot the candidate confirmed when it was not the one already on record (e.g. a re-invite for a new date). */
  confirmedSlotAt?: string | null;
  transcript?: string | null;
  summary?: string | null;
  recordingUrl?: string | null;
  /** The call connected and the person was right, but ended before they answered the walk-in question: recorded, nobody is marked declined. */
  incomplete?: boolean;
  /** A result for a call made more than a day ago (imported file): the call and the answer are recorded, the journey is not changed and nothing is sent. */
  historical?: boolean;
  /** Where the result came from, for the response record (one row per source + call id). */
  source?: "superbot_hook" | "superbot_report" | "vapi" | "call_import" | "voice_hook";
  /** The reference the call carried (HRMS-... match reference, or QF-... for older follow-up rows), so the result finds its journey. */
  reference?: string | null;
}

export async function recordVoiceResult(p: VoiceCallbackInput): Promise<{ leadId: string; outcome: string } | null> {
  const lead = p.leadId
    ? ((await db.execute<RowDataPacket[]>("SELECT id, mobile10, full_name, email, status, ats_candidate_id, meta_lead_id FROM he_lead WHERE id = ? LIMIT 1", [p.leadId]))[0][0] as never)
    : p.mobile ? await findLeadByMobile(p.mobile) : null;
  if (!lead) return null;
  const l = lead as { id: string; status: LeadStatus; meta_lead_id: string | null };
  // Provider retries: one row per provider_call_id.
  if (p.providerCallId) {
    const [dup] = await db.execute<RowDataPacket[]>("SELECT 1 FROM he_call WHERE provider_call_id = ? LIMIT 1", [p.providerCallId]);
    if (dup.length) return { leadId: l.id, outcome: "duplicate" };
  }
  const r = p.result;
  const outcome = callOutcome(r);
  const match = await activeMatch(l.id);
  const outcomeText = p.incomplete ? "CALL_INCOMPLETE" : r.failedReason ? `CALL_FAILED:${r.failedReason}` : outcome;
  // get_next_slot already reserved the replacement on the match mid-call; that is the slot that was offered.
  let offeredSlotAt = p.offeredSlotAt ?? null;
  if (!offeredSlotAt && r.offeredSlotAnswer && match) {
    const [cur] = await db.execute<RowDataPacket[]>("SELECT slot_at FROM he_match WHERE id = ? LIMIT 1", [match.id]);
    offeredSlotAt = cur[0]?.slot_at ? String(cur[0].slot_at) : null;
  }
  try { await db.execute(
    `INSERT INTO he_call (lead_id, match_id, provider_call_id, attempt_no, started_at, duration_s, identity_confirmed, language_used, email_received,
                          assessment_done, original_slot_answer, offered_slot_at, offered_slot_answer, outcome, decline_reason, sentiment, handoff_reason,
                          transcript, summary, recording_url, requisition_id, drive_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [l.id, match?.id ?? null, p.providerCallId ?? null, p.attemptNo ?? 1, p.startedAt ?? null, r.durationS ?? null, r.identityConfirmed ?? null, r.language ?? null,
      r.emailReceived ?? null, r.assessmentDone ?? null, r.originalSlotAnswer ?? null, offeredSlotAt, r.offeredSlotAnswer ?? null,
      outcomeText.slice(0, 60), r.declineReason ?? null, r.sentiment ?? null,
      outcome === "WALKIN_DECLINED_NEEDS_FOLLOWUP" ? "declined original and offered slot" : null,
      p.transcript ?? null, p.summary?.slice(0, 1000) ?? null, p.recordingUrl ?? null, match?.requisitionId ?? null, match?.driveId ?? null]);
  } catch (err) {
    if (isDuplicateKey(err)) return { leadId: l.id, outcome: "duplicate" };
    throw err;
  }
  // A call result for this number stamps the follow-up journey (called, or re-queued once after a miss, then T9; do-not-call stops it).
  // Never blocks the result.
  const callMobile = (lead as { mobile10?: string | null }).mobile10;
  if (callMobile) {
    try { await markFollowupCalled(callMobile, undefined, { result: callResultCode(r, { incomplete: p.incomplete }), reference: p.reference ?? null, at: new Date() }); }
    catch (err) { logger.warn({ leadId: l.id, err: logText(err) }, "[hiring-engine] mark follow-up called failed"); }
  }
  await persistSignals(l.id, signalsFromVoice(r), p.providerCallId ?? null);
  const callResponse = (applied: boolean) => recordResponseSafe({
    occurredAt: new Date(), channel: p.source === "call_import" ? "call_file" : "voice_bot", mode: "call",
    answer: p.incomplete ? "no_answer" : answerFromCallOutcome(outcomeText), mobile10: String((lead as { mobile10?: string | null }).mobile10 ?? ""), leadId: l.id,
    metaLeadId: l.meta_lead_id, matchId: match?.id ?? null, sourceKind: p.source ?? "voice_hook",
    sourceRef: p.providerCallId ?? `call:${l.id}:${p.startedAt ?? Date.now()}`, rawText: p.summary ?? null, applied,
  });
  if (p.incomplete) {
    // No answer to the walk-in question, so no state change (and above all no "declined"): just note it and keep the Meta mirror current.
    await addEvent(l.id, "call_incomplete", { channel: "voice", detail: (p.summary ?? "ended before the walk-in question").slice(0, 200) });
    if (l.meta_lead_id) await db.execute("UPDATE meta_lead_raw SET voice_call_outcome = ?, voice_called_at = COALESCE(?, NOW()) WHERE id = ?", [outcomeText, p.startedAt ?? null, l.meta_lead_id]);
    await callResponse(false);
    await recomputeInsight(l.id);
    await refreshLeadHistoryById(l.id);
    return { leadId: l.id, outcome: outcomeText };
  }
  if (p.historical) {
    // Past interview day: keep the facts (call log, response with the real answer, Meta mirror) without moving the journey or sending anything.
    await callResponse(false);
    if (l.meta_lead_id) await db.execute("UPDATE meta_lead_raw SET voice_call_outcome = ?, voice_called_at = COALESCE(?, voice_called_at) WHERE id = ?", [outcomeText.slice(0, 60), p.startedAt ?? null, l.meta_lead_id]);
    await recomputeInsight(l.id);
    await refreshLeadHistoryById(l.id);
    return { leadId: l.id, outcome: outcomeText };
  }
  const plan = planFromCallOutcome(l.status, outcome);
  await applyPlan(l.id, l.status, plan, { matchId: match?.id ?? null, channel: "voice", detail: outcomeText, metaLeadId: l.meta_lead_id, replyText: null });
  await callResponse(planApplied(plan));
  // A rescheduled call moves the slot to the one the slot service reserved mid-call (never invented here).
  if (outcome === "WALKIN_RESCHEDULED" && offeredSlotAt) {
    if (match) await db.execute("UPDATE he_match SET slot_at = ? WHERE id = ?", [offeredSlotAt, match.id]);
    // Also for results that come back from an external calling tool, which has no he_match to move.
    if (l.meta_lead_id) await db.execute("UPDATE meta_lead_raw SET interview_date = DATE(?), interview_time = TIME(?) WHERE id = ?", [offeredSlotAt, offeredSlotAt, l.meta_lead_id]);
  }
  if (outcome === "WALKIN_CONFIRMED_YES" && p.confirmedSlotAt && l.meta_lead_id) {
    await db.execute("UPDATE meta_lead_raw SET interview_date = DATE(?), interview_time = TIME(?) WHERE id = ?", [p.confirmedSlotAt, p.confirmedSlotAt, l.meta_lead_id]);
  }
  if (l.meta_lead_id) {
    await db.execute("UPDATE meta_lead_raw SET voice_call_outcome = ?, voice_called_at = COALESCE(?, NOW()) WHERE id = ?", [outcomeText.slice(0, 60), p.startedAt ?? null, l.meta_lead_id]);
  }
  await recomputeInsight(l.id);
  logger.info({ leadId: l.id, outcome: outcomeText }, "[hiring-engine] voice result recorded");
  await refreshLeadHistoryById(l.id);
  return { leadId: l.id, outcome: outcomeText };
}

export type InviteAnswer = "yes" | "no" | "later";
const ANSWER_INTENT = { yes: "confirm", no: "decline", later: "reschedule" } as const;
const ANSWER_TEXT: Record<InviteAnswer, string> = { yes: "Tapped: Yes, I will come", no: "Tapped: Cannot come", later: "Tapped: Need another time" };

/**
 * The candidate tapped a button on their invitation page (linked from the email). Recorded like a reply on the
 * email channel, so the shortlist's Reply / Status columns, the cadence stop rule and the 360 view all see it.
 * "later" releases the slot and asks a recruiter to call with a new time.
 */
export interface InviteAnswerOptions {
  channel?: "web" | "hr"; actor?: string | null; inviteId?: string | null; /** HR's note, kept on the response record. */ note?: string | null;
  /** When given, the candidate-facing sends (T2, confirmation email, STOP ack) are queued here for the caller to run after it releases a lock. */
  defer?: Array<() => Promise<unknown>>;
}
// A repeated answer that would not change the match (a second Yes on a confirmed match) is recorded but never re-sends T2 / emails (M4).
const ANSWER_ALREADY: Record<string, readonly string[]> = { yes: ["confirmed", "arrived", "selected"], later: ["slot_released"], no: ["declined"] };
export async function recordInviteAnswer(matchId: string, answer: InviteAnswer, opts: InviteAnswerOptions = {}): Promise<{ state: string; responseId?: number } | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.lead_id, m.requisition_id, m.drive_id, m.state, l.mobile10, l.status, l.meta_lead_id
       FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE m.id = ? LIMIT 1`, [matchId]);
  const r = rows[0];
  if (!r) return null;
  if ((ANSWER_ALREADY[answer] ?? []).includes(String(r.state ?? ""))) {
    const dup = await recordResponseSafe({
      occurredAt: new Date(), channel: opts.channel ?? "web", mode: opts.channel === "hr" ? "manual" : "button", answer: answerFromInviteTap(answer),
      mobile10: String(r.mobile10), leadId: String(r.lead_id), metaLeadId: r.meta_lead_id ?? null, matchId, inviteId: opts.inviteId ?? null,
      sourceKind: opts.channel === "hr" ? "hr_action" : "public_answer", sourceRef: `repeat:${matchId}:${answer}:${Date.now()}`, handledBy: opts.actor ?? undefined, applied: false,
      rawText: opts.note ?? null,
    });
    return dup.id ? { state: String(r.state), responseId: dup.id } : { state: String(r.state) };
  }
  const intent = ANSWER_INTENT[answer];
  const [msg] = await db.execute<RowDataPacket[]>("SELECT UUID() AS id");
  const messageId = msg[0].id as string;
  await db.execute(
    "INSERT INTO he_message (id, lead_id, mobile10, direction, channel, body, intent, requisition_id, drive_id) VALUES (?,?,?,?,?,?,?,?,?)",
    [messageId, r.lead_id, r.mobile10, "in", "email", ANSWER_TEXT[answer], intent, r.requisition_id, r.drive_id ?? null]);
  const [lastOut] = await db.execute<RowDataPacket[]>(
    "SELECT id FROM he_message WHERE lead_id = ? AND direction = 'out' AND channel = 'email' ORDER BY created_at DESC LIMIT 1", [r.lead_id]);
  if (lastOut[0]) await db.execute("INSERT INTO he_message_event (message_id, lead_id, channel, event_type) VALUES (?,?,?, 'replied')", [lastOut[0].id, r.lead_id, "email"]);
  const [o] = await db.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM he_lead_event WHERE lead_id = ? AND event_type = 'slot_offered'", [r.lead_id]);
  const plan = planFromReply(r.status as LeadStatus, intent, Number(o[0].n));
  await applyPlan(String(r.lead_id), r.status as LeadStatus, plan, { matchId, channel: "email", detail: ANSWER_TEXT[answer], metaLeadId: r.meta_lead_id ?? null, replyText: null, defer: opts.defer });
  // The tap is recorded as web (the page), not email; an HR answer as hr / manual. The he_message row above is unchanged.
  const resp = await recordResponseSafe({
    occurredAt: new Date(), channel: opts.channel ?? "web", mode: opts.channel === "hr" ? "manual" : "button", answer: answerFromInviteTap(answer),
    mobile10: String(r.mobile10), leadId: String(r.lead_id), metaLeadId: r.meta_lead_id ?? null, matchId, inviteId: opts.inviteId ?? null,
    sourceKind: opts.channel === "hr" ? "hr_action" : "public_answer", sourceRef: messageId, handledBy: opts.actor ?? undefined, applied: planApplied(plan),
    rawText: opts.note ?? null,
  });
  if (answer === "later" && !plan.humanHandoff) await addEvent(String(r.lead_id), "needs_human_followup", { channel: "email", detail: "asked for another walk-in time", driveId: r.drive_id ?? undefined });
  await recomputeInsight(String(r.lead_id));
  await refreshLeadHistoryById(String(r.lead_id));
  const [s] = await db.execute<RowDataPacket[]>("SELECT state FROM he_match WHERE id = ?", [matchId]);
  return resp.id ? { state: String(s[0]?.state ?? ""), responseId: resp.id } : { state: String(s[0]?.state ?? "") };
}

/** "Stop messages" tapped on the invitation page of a match: the same opt-out plan as a STOP reply, without the WhatsApp acknowledgement. */
export async function recordInviteStop(matchId: string): Promise<{ state: string } | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.lead_id, m.requisition_id, m.drive_id, l.mobile10, l.status, l.meta_lead_id
       FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE m.id = ? LIMIT 1`, [matchId]);
  const r = rows[0];
  if (!r) return null;
  const [msg] = await db.execute<RowDataPacket[]>("SELECT UUID() AS id");
  await db.execute(
    "INSERT INTO he_message (id, lead_id, mobile10, direction, channel, body, intent, requisition_id, drive_id) VALUES (?,?,?,?,?,?,?,?,?)",
    [msg[0].id, r.lead_id, r.mobile10, "in", "email", "Tapped: Stop messages", "opt_out", r.requisition_id, r.drive_id ?? null]);
  const plan = planFromReply(r.status as LeadStatus, "opt_out", 0);
  await applyPlan(String(r.lead_id), r.status as LeadStatus, plan, { matchId, channel: "web", detail: "Stop messages on the invitation page", metaLeadId: r.meta_lead_id ?? null, replyText: null, ackStop: false });
  await recomputeInsight(String(r.lead_id));
  await refreshLeadHistoryById(String(r.lead_id));
  return { state: "stopped" };
}
