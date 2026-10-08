/**
 * An answer on an invite token (a person invited without an he_match). Yes / another time book the person on the requisition's drive
 * and then run the engine's own recordInviteAnswer, so confirmation, T2, the confirmation email, the Meta mirror, reminders and no-show
 * handling are exactly the engine's. Booking and confirming happen while holding the engine tick's named lock, so no tick can see the
 * freshly booked 'invited' match before it is confirmed (it would otherwise send T1 / follow-ups to it). Sends never run inside an open
 * transaction (bookLeadOnDrive commits before recordInviteAnswer runs).
 * Cannot come books nothing; Stop opts the person out. Every answer writes one response record.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { recordResponseSafe } from "./candidate-response.service.js";
import { recordInviteAnswer } from "./he-ingest.service.js";
import { addEvent, findLeadByMobile, revokeConsent, setLeadStatus, upsertLead } from "./he-lead.service.js";
import { bridgeOneMetaLead } from "./he-meta-bridge.service.js";
import { answerFromInviteTap } from "./response-normalise.js";
import { loadResponseSwitches } from "./responses.policy.js";
import { bookLeadOnDrive } from "./walkin-booking.service.js";
import { markInviteAnswered, type WalkinInviteRow } from "./walkin-invite.service.js";

export type InviteTokenAnswer = "yes" | "later" | "no" | "stop";
export interface InviteAnswerResult { state: string; matchToken?: string; booked: boolean; reason?: string; responseId?: number }
export interface InviteAnswerOptions { now: Date; channel: "web" | "hr"; actor?: string | null; note?: string | null }

const ENGINE_LOCK = "he_engine_tick";

async function ensureLead(inv: WalkinInviteRow): Promise<{ id: string; status: string } | null> {
  if (inv.lead_id) return { id: inv.lead_id, status: "new" };
  if (inv.meta_lead_id) await bridgeOneMetaLead(inv.meta_lead_id);
  const found = await findLeadByMobile(inv.mobile10);
  if (found) return { id: found.id, status: String(found.status) };
  const created = await upsertLead({ mobile: inv.mobile10, source: "invite", metaLeadId: inv.meta_lead_id });
  return created ? { id: created.id, status: "new" } : null;
}

/** GET_LOCK on a dedicated connection: 5 s, one retry. Null when the engine tick still holds it. */
async function takeEngineLock(): Promise<PoolConnection | null> {
  const conn = (await db.getConnection()) as unknown as PoolConnection;
  for (let attempt = 0; attempt < 2; attempt++) {
    const [r] = await conn.execute<RowDataPacket[]>(`SELECT GET_LOCK('${ENGINE_LOCK}', 5) AS ok`);
    if (Number(r[0]?.ok) === 1) return conn;
  }
  conn.release();
  return null;
}

async function releaseEngineLock(conn: PoolConnection): Promise<void> {
  try { await conn.execute(`SELECT RELEASE_LOCK('${ENGINE_LOCK}')`); } catch { /* closing the session releases it */ }
  conn.release();
}

export async function answerInviteToken(inv: WalkinInviteRow, answer: InviteTokenAnswer, o: InviteAnswerOptions): Promise<InviteAnswerResult> {
  const respond = (applied: boolean, extra: { leadId?: string | null; matchId?: string | null } = {}) => recordResponseSafe({
    occurredAt: o.now, channel: o.channel, mode: o.channel === "hr" ? "manual" : "button", answer: answerFromInviteTap(answer), mobile10: inv.mobile10,
    leadId: extra.leadId ?? inv.lead_id, metaLeadId: inv.meta_lead_id, matchId: extra.matchId ?? null, inviteId: inv.id, followupId: inv.followup_id,
    sourceKind: o.channel === "hr" ? "hr_action" : "public_answer", sourceRef: `wi:${inv.id}:${answer}:${o.now.getTime()}`, handledBy: o.actor ?? undefined, applied,
    rawText: o.note ?? null,
  }).then((r) => (r.id ? { responseId: r.id } : {}));

  if (answer === "no") {
    await markInviteAnswered(inv.id, "declined", null);
    if (inv.meta_lead_id) {
      await db.execute("UPDATE meta_lead_raw SET walkin_declined = 1, walkin_reply = 'not_interested', walkin_reply_at = NOW() WHERE id = ?", [inv.meta_lead_id]);
    }
    return { state: "declined", booked: false, ...(await respond(true)) };
  }

  const lead = await ensureLead(inv);
  if (!lead) {
    logger.warn({ inviteId: inv.id }, "[walkin-invite] no lead for the answer");
    return { state: "unavailable", booked: false, reason: "no_lead", ...(await respond(false)) };
  }

  if (answer === "stop") {
    await setLeadStatus(lead.id, "opted_out");
    await revokeConsent(lead.id, "whatsapp_contact");
    await addEvent(lead.id, "opted_out", { channel: o.channel, detail: "Stop messages on the invitation page", actor: o.actor ?? null });
    await markInviteAnswered(inv.id, "stopped", null);
    return { state: "stopped", booked: false, ...(await respond(true, { leadId: lead.id })) };
  }

  const human = (detail: string) => addEvent(lead.id, "needs_human_followup", { channel: o.channel, detail, actor: o.actor ?? null });
  if (!(await loadResponseSwitches()).bookOnYes) {
    await markInviteAnswered(inv.id, answer === "yes" ? "answered_yes" : "answered_later", null);
    await human(answer === "yes" ? "said yes on the invitation link: book a slot" : "asked for another time on the invitation link");
    return { state: "recorded", booked: false, reason: "booking_off", ...(await respond(false, { leadId: lead.id })) };
  }

  const lock = await takeEngineLock();
  if (!lock) {
    await human(`answered ${answer} on the invitation link while the engine was busy: book by hand`);
    return { state: "pending", booked: false, reason: "busy", ...(await respond(false, { leadId: lead.id })) };
  }
  let booked: Awaited<ReturnType<typeof bookLeadOnDrive>>;
  let state = "";
  let responseId: number | undefined;
  try {
    let branch = inv.branch_name;
    if (!branch) {
      const [jr] = await db.execute<RowDataPacket[]>("SELECT branch_name FROM job_requisition WHERE id = ? LIMIT 1", [inv.requisition_id]);
      branch = jr[0]?.branch_name ? String(jr[0].branch_name) : "";
    }
    booked = await bookLeadOnDrive({ leadId: lead.id, requisitionId: inv.requisition_id, branchName: branch, preferredSlotAt: inv.slot_at, now: o.now, state: "invited" });
    if (booked.status === "booked") {
      const ra = await recordInviteAnswer(booked.matchId, answer, { channel: o.channel, actor: o.actor ?? null, inviteId: inv.id, note: o.note ?? null });
      state = ra?.state ?? "";
      responseId = ra?.responseId;
    }
  } finally {
    await releaseEngineLock(lock);
  }
  if (booked.status !== "booked") {
    await markInviteAnswered(inv.id, answer === "yes" ? "answered_yes" : "answered_later", null);
    await human(`answered ${answer} on the invitation link but no slot could be booked (${booked.reason}): call to fix a time`);
    return { state: "unavailable", booked: false, reason: booked.reason, ...(await respond(false, { leadId: lead.id })) };
  }
  await markInviteAnswered(inv.id, answer === "yes" ? "answered_yes" : "answered_later", booked.matchId);
  if (inv.meta_lead_id && booked.slotAt !== (inv.slot_at ? String(inv.slot_at).slice(0, 19) : null)) {
    await db.execute("UPDATE meta_lead_raw SET interview_date = DATE(?), interview_time = TIME(?) WHERE id = ?", [booked.slotAt, booked.slotAt, inv.meta_lead_id]);
  }
  return { state, matchToken: booked.token, booked: true, ...(responseId ? { responseId } : {}) };
}

/**
 * HR's Yes / another time for a person whose match has no slot yet (only suggested, or released without a new time): book them on the
 * requisition's drive first, then answer, under the engine lock (same path as a Yes on an invite link). Unavailable booking = HR follow-up.
 */
export async function bookAndAnswerMatch(a: { leadId: string; requisitionId: string; answer: "yes" | "later"; now: Date; actor: string; note: string }):
  Promise<{ state: string; booked: boolean; reason?: string; responseId?: number; matchId?: string }> {
  const lock = await takeEngineLock();
  if (!lock) {
    await addEvent(a.leadId, "needs_human_followup", { channel: "hr", detail: `HR recorded ${a.answer} while the engine was busy: book by hand`, actor: a.actor });
    return { state: "pending", booked: false, reason: "busy" };
  }
  try {
    const [jr] = await db.execute<RowDataPacket[]>("SELECT branch_name FROM job_requisition WHERE id = ? LIMIT 1", [a.requisitionId]);
    const booked = await bookLeadOnDrive({ leadId: a.leadId, requisitionId: a.requisitionId, branchName: String(jr[0]?.branch_name ?? ""), preferredSlotAt: null, now: a.now, state: "invited" });
    if (booked.status !== "booked") {
      await addEvent(a.leadId, "needs_human_followup", { channel: "hr", detail: `HR recorded ${a.answer} but no slot could be booked (${booked.reason}): fix a time`, actor: a.actor });
      return { state: "unavailable", booked: false, reason: booked.reason };
    }
    const ra = await recordInviteAnswer(booked.matchId, a.answer, { channel: "hr", actor: a.actor, note: a.note });
    return { state: ra?.state ?? "", booked: true, responseId: ra?.responseId, matchId: booked.matchId };
  } finally {
    await releaseEngineLock(lock);
  }
}
