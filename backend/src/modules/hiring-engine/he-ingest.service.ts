/**
 * Inbound capture. Every WhatsApp reply, delivery status, email event and voice result lands here:
 * stored raw, mined into signals, applied to lead/match state, mirrored to meta_lead_raw so the existing
 * Meta inbox pages stay correct, then the lead insight is recomputed.
 */
import { refreshLeadHistoryById } from "./he-master.service.js";
import { answerCandidateQuestion } from "./he-bot.service.js";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
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

const isDuplicateKey = (e: unknown) => (e as { code?: string; errno?: number })?.code === "ER_DUP_ENTRY" || (e as { errno?: number })?.errno === 1062;

async function activeMatch(leadId: string): Promise<{ id: string; slotOffers: number } | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM he_match WHERE lead_id = ? AND state IN ('invited','confirmed','slot_released') ORDER BY updated_at DESC LIMIT 1`, [leadId]);
  if (!rows[0]) return null;
  const [o] = await db.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM he_lead_event WHERE lead_id = ? AND event_type = 'slot_offered'", [leadId]);
  return { id: rows[0].id as string, slotOffers: Number(o[0].n) };
}

/** Mirror outcomes onto the Meta lead row so /ats/meta-leads and the WhatsApp inbox stay truthful. */
async function mirrorToMeta(metaLeadId: string | null, plan: TransitionPlan): Promise<void> {
  if (!metaLeadId) return;
  const confirmed = plan.leadStatus === "confirmed" || plan.leadStatus === "rescheduled" ? 1 : null;
  const resched = plan.event === "reschedule_requested" ? 1 : null;
  const declined = plan.leadStatus === "declined" || plan.leadStatus === "opted_out" ? 1 : null;
  if (confirmed == null && resched == null && declined == null) return;
  // meta_lead_raw.walkin_reply is VARCHAR(30) holding the same keywords the Wassenger webhook writes.
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
    if (r.status !== "sent") logger.info({ leadId, key, status: r.status, reason: "reason" in r ? r.reason : undefined }, "[he-ingest] follow-up template not sent");
  } catch (err) { logger.warn({ leadId, key, err: (err as Error).message }, "[he-ingest] follow-up template failed"); }
}

async function applyPlan(leadId: string, current: LeadStatus, plan: TransitionPlan, ctx: { matchId: string | null; channel: string; detail: string | null; metaLeadId: string | null; replyText: string | null }): Promise<void> {
  // T10: acknowledge STOP while the consent still exists (the reply opened a 24h window); suppression follows below.
  if (plan.event === "opted_out") await sendFollowUpTemplate(leadId, "he_optout_ack", ctx.matchId);
  if (plan.leadStatus && plan.leadStatus !== current) await setLeadStatus(leadId, plan.leadStatus);
  if (plan.matchState && ctx.matchId) await db.execute("UPDATE he_match SET state = ? WHERE id = ?", [plan.matchState, ctx.matchId]);
  if (plan.revokeConsent) await revokeConsent(leadId, "whatsapp_contact");
  await addEvent(leadId, plan.event, { channel: ctx.channel, detail: ctx.detail });
  if (plan.humanHandoff) await addEvent(leadId, "needs_human_followup", { channel: ctx.channel, detail: "second decline / declined offered slot" });
  await mirrorToMeta(ctx.metaLeadId, plan);
  // T2: appointment details + reference once the candidate confirms (button, email tap or bot call).
  if (plan.matchState === "confirmed" && ctx.matchId) await sendFollowUpTemplate(leadId, "he_walkin_confirmed", ctx.matchId);
  // T9: the bot could not reach them twice -> ask on WhatsApp instead.
  if (plan.event === "call_no_answer" && ctx.matchId) {
    const [n] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM he_lead_event WHERE lead_id = ? AND event_type = 'call_no_answer' AND created_at >= (SELECT COALESCE(MAX(created_at), '2000-01-01') FROM he_message WHERE lead_id = ? AND direction = 'out' AND template_key = 'he_walkin_invite_email')", [leadId, leadId]);
    if (Number(n[0].n) >= 2) await sendFollowUpTemplate(leadId, "he_missed_call", ctx.matchId);
  }
}

export async function recordInboundReply(p: { mobile: string; text: string; providerMessageId?: string | null; channel?: "whatsapp" | "email" }): Promise<{ leadId: string; intent: string } | null> {
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
  const { intent, signals } = signalsFromReply(p.text, channel);
  const [msg] = await db.execute<RowDataPacket[]>("SELECT UUID() AS id");
  const messageId = msg[0].id as string;
  try {
    await db.execute(
      "INSERT INTO he_message (id, lead_id, mobile10, direction, channel, body, provider_message_id, intent) VALUES (?,?,?,?,?,?,?,?)",
      [messageId, lead.id, mobile10, "in", channel, p.text.slice(0, 2000), p.providerMessageId ?? null, intent]);
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
  const match = await activeMatch(lead.id);
  const plan = planFromReply(lead.status, intent, match?.slotOffers ?? 0);
  await applyPlan(lead.id, lead.status, plan, { matchId: match?.id ?? null, channel, detail: p.text, metaLeadId: lead.meta_lead_id, replyText: p.text });
  await recomputeInsight(lead.id);
  await refreshLeadHistoryById(lead.id);
  // Questions ("office kahan hai?", "kya laana hai?") get an instant answer from the invitation; the rest go to a human.
  if (intent === "unknown" && channel === "whatsapp") {
    try { await answerCandidateQuestion(lead.id, p.text); } catch (err) { logger.warn({ err: (err as Error).message }, "[he-ingest] bot answer failed"); }
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
  const [rows] = await db.execute<RowDataPacket[]>("SELECT id, lead_id FROM he_message WHERE provider_message_id = ? AND channel = 'email' LIMIT 1", [p.providerMessageId]);
  if (!rows[0]) return false;
  const leadId = rows[0].lead_id as string | null;
  const map: Record<EmailEvent, string> = { sent: "sent", delivered: "delivered", opened: "opened", clicked: "clicked", bounced: "bounced", replied: "replied", unsubscribed: "unsubscribed" };
  await db.execute("INSERT INTO he_message_event (message_id, lead_id, channel, event_type, detail) VALUES (?,?,'email',?,?)", [rows[0].id, leadId, map[p.event], p.detail?.slice(0, 300) ?? null]);
  if (leadId) {
    await persistSignals(leadId, signalsFromEmailEvent(p.event, p.detail), String(rows[0].id));
    if (p.event === "unsubscribed") await revokeConsent(leadId, "whatsapp_contact");
    await recomputeInsight(leadId);
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
}

export async function recordVoiceResult(p: VoiceCallbackInput): Promise<{ leadId: string; outcome: string } | null> {
  let lead = p.leadId
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
  const outcomeText = r.failedReason ? `CALL_FAILED:${r.failedReason}` : outcome;
  // get_next_slot already reserved the replacement on the match mid-call; that is the slot that was offered.
  let offeredSlotAt = p.offeredSlotAt ?? null;
  if (!offeredSlotAt && r.offeredSlotAnswer && match) {
    const [cur] = await db.execute<RowDataPacket[]>("SELECT slot_at FROM he_match WHERE id = ? LIMIT 1", [match.id]);
    offeredSlotAt = cur[0]?.slot_at ? String(cur[0].slot_at) : null;
  }
  try { await db.execute(
    `INSERT INTO he_call (lead_id, match_id, provider_call_id, attempt_no, started_at, duration_s, identity_confirmed, language_used, email_received,
                          assessment_done, original_slot_answer, offered_slot_at, offered_slot_answer, outcome, decline_reason, sentiment, handoff_reason,
                          transcript, summary, recording_url)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [l.id, match?.id ?? null, p.providerCallId ?? null, p.attemptNo ?? 1, p.startedAt ?? null, r.durationS ?? null, r.identityConfirmed ?? null, r.language ?? null,
      r.emailReceived ?? null, r.assessmentDone ?? null, r.originalSlotAnswer ?? null, offeredSlotAt, r.offeredSlotAnswer ?? null,
      outcomeText.slice(0, 60), r.declineReason ?? null, r.sentiment ?? null,
      outcome === "WALKIN_DECLINED_NEEDS_FOLLOWUP" ? "declined original and offered slot" : null,
      p.transcript ?? null, p.summary?.slice(0, 1000) ?? null, p.recordingUrl ?? null]);
  } catch (err) {
    if (isDuplicateKey(err)) return { leadId: l.id, outcome: "duplicate" };
    throw err;
  }
  await persistSignals(l.id, signalsFromVoice(r), p.providerCallId ?? null);
  const plan = planFromCallOutcome(l.status, outcome);
  await applyPlan(l.id, l.status, plan, { matchId: match?.id ?? null, channel: "voice", detail: outcomeText, metaLeadId: l.meta_lead_id, replyText: null });
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
export async function recordInviteAnswer(matchId: string, answer: InviteAnswer): Promise<{ state: string } | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.lead_id, m.requisition_id, m.drive_id, l.mobile10, l.status, l.meta_lead_id
       FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE m.id = ? LIMIT 1`, [matchId]);
  const r = rows[0];
  if (!r) return null;
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
  await applyPlan(String(r.lead_id), r.status as LeadStatus, plan, { matchId, channel: "email", detail: ANSWER_TEXT[answer], metaLeadId: r.meta_lead_id ?? null, replyText: null });
  if (answer === "later" && !plan.humanHandoff) await addEvent(String(r.lead_id), "needs_human_followup", { channel: "email", detail: "asked for another walk-in time", driveId: r.drive_id ?? undefined });
  await recomputeInsight(String(r.lead_id));
  await refreshLeadHistoryById(String(r.lead_id));
  const [s] = await db.execute<RowDataPacket[]>("SELECT state FROM he_match WHERE id = ?", [matchId]);
  return { state: String(s[0]?.state ?? "") };
}
