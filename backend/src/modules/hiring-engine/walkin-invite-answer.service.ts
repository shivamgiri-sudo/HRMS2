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
export interface InviteAnswerResult { state: string; matchToken?: string; booked: boolean; reason?: string }
export interface InviteAnswerOptions { now: Date; channel: "web" | "hr"; actor?: string | null; responseId?: number | null }

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
  });

  if (answer === "no") {
    await markInviteAnswered(inv.id, "declined", null);
    if (inv.meta_lead_id) {
      await db.execute("UPDATE meta_lead_raw SET walkin_declined = 1, walkin_reply = 'not_interested', walkin_reply_at = NOW() WHERE id = ?", [inv.meta_lead_id]);
    }
    await respond(true);
    return { state: "declined", booked: false };
  }

  const lead = await ensureLead(inv);
  if (!lead) {
    logger.warn({ inviteId: inv.id }, "[walkin-invite] no lead for the answer");
    await respond(false);
    return { state: "unavailable", booked: false, reason: "no_lead" };
  }

  if (answer === "stop") {
    await setLeadStatus(lead.id, "opted_out");
    await revokeConsent(lead.id, "whatsapp_contact");
    await addEvent(lead.id, "opted_out", { channel: o.channel, detail: "Stop messages on the invitation page", actor: o.actor ?? null });
    await markInviteAnswered(inv.id, "stopped", null);
    await respond(true, { leadId: lead.id });
    return { state: "stopped", booked: false };
  }

  const human = (detail: string) => addEvent(lead.id, "needs_human_followup", { channel: o.channel, detail, actor: o.actor ?? null });
  if (!(await loadResponseSwitches()).bookOnYes) {
    await markInviteAnswered(inv.id, answer === "yes" ? "answered_yes" : "answered_later", null);
    await human(answer === "yes" ? "said yes on the invitation link: book a slot" : "asked for another time on the invitation link");
    await respond(false, { leadId: lead.id });
    return { state: "recorded", booked: false, reason: "booking_off" };
  }

  const lock = await takeEngineLock();
  if (!lock) {
    await human(`answered ${answer} on the invitation link while the engine was busy: book by hand`);
    await respond(false, { leadId: lead.id });
    return { state: "pending", booked: false, reason: "busy" };
  }
  let booked: Awaited<ReturnType<typeof bookLeadOnDrive>>;
  let state = "";
  try {
    let branch = inv.branch_name;
    if (!branch) {
      const [jr] = await db.execute<RowDataPacket[]>("SELECT branch_name FROM job_requisition WHERE id = ? LIMIT 1", [inv.requisition_id]);
      branch = jr[0]?.branch_name ? String(jr[0].branch_name) : "";
    }
    booked = await bookLeadOnDrive({ leadId: lead.id, requisitionId: inv.requisition_id, branchName: branch, preferredSlotAt: inv.slot_at, now: o.now, state: "invited" });
    if (booked.status === "booked") state = (await recordInviteAnswer(booked.matchId, answer, { channel: o.channel, actor: o.actor ?? null }))?.state ?? "";
  } finally {
    await releaseEngineLock(lock);
  }
  if (booked.status !== "booked") {
    await markInviteAnswered(inv.id, answer === "yes" ? "answered_yes" : "answered_later", null);
    await human(`answered ${answer} on the invitation link but no slot could be booked (${booked.reason}): call to fix a time`);
    await respond(false, { leadId: lead.id });
    return { state: "unavailable", booked: false, reason: booked.reason };
  }
  await markInviteAnswered(inv.id, answer === "yes" ? "answered_yes" : "answered_later", booked.matchId);
  if (inv.meta_lead_id && booked.slotAt !== (inv.slot_at ? String(inv.slot_at).slice(0, 19) : null)) {
    await db.execute("UPDATE meta_lead_raw SET interview_date = DATE(?), interview_time = TIME(?) WHERE id = ?", [booked.slotAt, booked.slotAt, inv.meta_lead_id]);
  }
  return { state, matchToken: booked.token, booked: true };
}
