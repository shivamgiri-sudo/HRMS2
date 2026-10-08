/**
 * STOP from every channel, independent of the Pinbot inbound webhook: Pinbot reply or button, email unsubscribe, a do-not-call call result,
 * HR's button and the web Stop. The person's opt-out is held on followup_person (even when no he_lead exists), every journey of the mobile
 * stops (all requisitions) and the person is released. Idempotent: a second STOP records nothing new. WhatsApp is Pinbot only.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { addEvent, revokeConsent, setLeadStatus } from "./he-lead.service.js";
import { dequeueSuperbotForMatch } from "./he-superbot.service.js";
import { recordResponseSafe } from "./candidate-response.service.js";
import type { ResponseChannel, ResponseMode } from "./response-normalise.js";
import { normaliseMobile10 } from "./qualified-followup.schedule.js";

export type OptOutSource = "pinbot" | "email_unsubscribe" | "call" | "hr" | "web";

const CHANNEL: Record<OptOutSource, [ResponseChannel, ResponseMode]> = {
  pinbot: ["whatsapp", "text"], email_unsubscribe: ["email", "button"], call: ["voice_bot", "call"], hr: ["hr", "manual"], web: ["web", "button"],
};
const ist = (v: unknown): Date | null => (v == null ? null : v instanceof Date ? v : new Date(String(v).replace(" ", "T") + "+05:30"));

/** `viaIngest`: the reply ingest already applied the opt-out plan (lead status, consent, event, response record); only the person and journeys here. */
export async function recordPersonOptOut(mobile: string, o: { source: OptOutSource; actor?: string | null; detail?: string | null; viaIngest?: boolean }): Promise<{ leadId: string | null; journeysStopped: number }> {
  const m = normaliseMobile10(mobile);
  if (!m) return { leadId: null, journeysStopped: 0 };
  const [prev] = await db.execute<RowDataPacket[]>("SELECT opted_out_at FROM followup_person WHERE mobile10 = ? LIMIT 1", [m]);
  const first = !prev[0]?.opted_out_at;
  // ON DUPLICATE assignments run left to right: the source is kept from the first STOP.
  await db.execute(
    `INSERT INTO followup_person (mobile10, opted_out_at, opted_out_source) VALUES (?, NOW(), ?)
     ON DUPLICATE KEY UPDATE opted_out_source = IF(opted_out_at IS NULL, VALUES(opted_out_source), opted_out_source), opted_out_at = COALESCE(opted_out_at, VALUES(opted_out_at))`,
    [m, o.source]);
  const [stopped] = await db.execute<import("mysql2").ResultSetHeader>(
    `UPDATE qualified_followup SET stopped_reason = 'opted_out', stopped_at = NOW(), journey_state = 'stopped', call_state = IF(call_state = 'pending', 'skipped', call_state)
      WHERE mobile10 = ? AND stopped_reason IS NULL`, [m]);
  await db.execute("UPDATE followup_person SET active_followup_id = NULL WHERE mobile10 = ?", [m]);
  const [l] = await db.execute<RowDataPacket[]>("SELECT id, status FROM he_lead WHERE mobile10 = ? LIMIT 1", [m]);
  const leadId = l[0]?.id ? String(l[0].id) : null;
  // A Pinbot STOP (or a web Stop) comes through the reply ingest, which already set the lead, revoked consent, recorded the event and the response.
  const ingested = o.viaIngest || o.source === "pinbot";
  if (leadId && !ingested && first) {
    if (l[0].status !== "opted_out") await setLeadStatus(leadId, "opted_out");
    await revokeConsent(leadId, "whatsapp_contact");
    await addEvent(leadId, "opted_out", { channel: o.source, actor: o.actor ?? null, detail: o.detail ? `${o.source}: ${o.detail}`.slice(0, 200) : o.source });
  }
  if (!ingested && first) {
    const [channel, mode] = CHANNEL[o.source];
    await recordResponseSafe({
      occurredAt: new Date(), channel, mode, answer: "unsubscribe", mobile10: m, leadId, sourceKind: `optout_${o.source}`.slice(0, 16),
      sourceRef: `optout:${m}:${o.source}`, rawText: o.detail ?? null, handledBy: o.actor ?? undefined, applied: true,
    });
  }
  // A bot call still queued must not ring them.
  const [mm] = await db.execute<RowDataPacket[]>("SELECT DISTINCT match_id FROM qualified_followup WHERE mobile10 = ? AND match_id IS NOT NULL", [m]);
  for (const r of mm) void Promise.resolve(dequeueSuperbotForMatch(String(r.match_id))).catch((err: unknown) => logger.warn({ err: (err as Error).message }, "[followup-optout] dequeue failed"));
  return { leadId, journeysStopped: Number(stopped?.affectedRows ?? 0) };
}

/** Pinbot inbound health for the report and the switch card: the last inbound WhatsApp, inbound in 7 days, and the owner's verified flag. */
export async function waInboundHealth(now: Date): Promise<{ lastInboundAt: Date | null; inbound7d: number; verified: boolean }> {
  const [r] = await db.execute<RowDataPacket[]>(
    "SELECT MAX(created_at) AS last_at, SUM(created_at >= DATE_SUB(?, INTERVAL 7 DAY)) AS n7 FROM he_message WHERE direction = 'in' AND channel = 'whatsapp'", [now]);
  const [p] = await db.execute<RowDataPacket[]>("SELECT param_key, value FROM he_model_param WHERE param_key = 'policy.followup.wa_inbound_verified'");
  return { lastInboundAt: ist(r[0]?.last_at), inbound7d: Number(r[0]?.n7 ?? 0), verified: Number(p[0]?.value ?? 0) === 1 };
}
