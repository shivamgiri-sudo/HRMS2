/** Rebuilds he_lead_insight for one lead from the raw capture tables. Safe to call after any write. */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { computeInsight, type InsightInput } from "./he-insight.js";
import type { DeclineReason } from "./he-signals.js";

const istHour = (s: string) => new Date(new Date(s.replace(" ", "T") + "+05:30").getTime() + 330 * 60_000).getUTCHours();

export async function recomputeInsight(leadId: string): Promise<void> {
  const [leadRows] = await db.execute<RowDataPacket[]>("SELECT status FROM he_lead WHERE id = ? LIMIT 1", [leadId]);
  if (!leadRows[0]) return;

  const [msgs] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.channel, m.created_at, m.direction, m.delivery_status,
            EXISTS(SELECT 1 FROM he_message_event e WHERE e.message_id = m.id AND e.event_type IN ('delivered','opened','read')) AS ev_delivered,
            EXISTS(SELECT 1 FROM he_message_event e WHERE e.message_id = m.id AND e.event_type IN ('read','opened','clicked')) AS ev_read,
            EXISTS(SELECT 1 FROM he_message_event e WHERE e.message_id = m.id AND e.event_type = 'replied') AS ev_replied
       FROM he_message m WHERE m.lead_id = ? ORDER BY m.created_at`, [leadId]);
  const [calls] = await db.execute<RowDataPacket[]>(
    "SELECT outcome, started_at FROM he_call WHERE lead_id = ? ORDER BY created_at", [leadId]);
  const [sigs] = await db.execute<RowDataPacket[]>(
    "SELECT signal_key, signal_value, observed_at FROM he_signal WHERE lead_id = ? ORDER BY observed_at", [leadId]);
  const [cons] = await db.execute<RowDataPacket[]>(
    "SELECT consent_type, revoked_at FROM he_consent WHERE lead_id = ?", [leadId]);
  const [matches] = await db.execute<RowDataPacket[]>(
    "SELECT state FROM he_match WHERE lead_id = ?", [leadId]);

  const outbound = msgs.filter((m) => m.direction === "out").map((m) => {
    const dv = Number(m.ev_delivered) === 1 || ["delivered", "read"].includes(String(m.delivery_status));
    const rd = Number(m.ev_read) === 1 || m.delivery_status === "read";
    return { channel: m.channel as "whatsapp" | "email", at: new Date(String(m.created_at).replace(" ", "T") + "+05:30"), delivered: dv, read: rd, replied: Number(m.ev_replied) === 1 };
  });
  const inboundHours = [
    ...msgs.filter((m) => m.direction === "in").map((m) => istHour(String(m.created_at))),
    ...calls.filter((c) => c.outcome && c.outcome !== "NO_ANSWER" && c.outcome !== "CALL_FAILED" && c.started_at).map((c) => istHour(String(c.started_at))),
  ];
  const last = (key: string) => [...sigs].reverse().find((s) => s.signal_key === key)?.signal_value as string | undefined;
  const callsAnswered = calls.filter((c) => c.outcome && !["NO_ANSWER", "CALL_FAILED"].includes(String(c.outcome))).length;

  const input: InsightInput = {
    now: new Date(),
    status: String(leadRows[0].status),
    outbound,
    inboundHoursIst: inboundHours,
    callAttempts: calls.length,
    callsAnswered,
    emailBounced: last("email_valid") === "no",
    phoneInvalid: last("phone_valid") === "no",
    optedOut: cons.some((c) => c.consent_type === "whatsapp_contact" && c.revoked_at) && !cons.some((c) => c.consent_type === "whatsapp_contact" && !c.revoked_at),
    confirmedCount: matches.filter((m) => ["confirmed", "arrived", "no_show", "selected"].includes(String(m.state))).length,
    arrivedCount: matches.filter((m) => ["arrived", "selected"].includes(String(m.state))).length,
    noShowCount: matches.filter((m) => m.state === "no_show").length,
    lastDeclineReason: (last("decline_reason") as DeclineReason | undefined) ?? null,
    language: last("language") ?? null,
    hasLiveLocationConsent: cons.some((c) => c.consent_type === "location" && !c.revoked_at),
  };
  const r = computeInsight(input);
  const objections = sigs.filter((s) => s.signal_key === "decline_reason").map((s) => s.signal_value);
  await db.execute(
    `INSERT INTO he_lead_insight (lead_id, engagement_score, reliability_score, best_channel, best_hour_ist, language_pref, email_valid, wa_reachable,
                                  touches_total, replies_total, no_show_count, objections_json, next_action, next_action_reason, computed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())
     ON DUPLICATE KEY UPDATE engagement_score=VALUES(engagement_score), reliability_score=VALUES(reliability_score), best_channel=VALUES(best_channel),
       best_hour_ist=VALUES(best_hour_ist), language_pref=VALUES(language_pref), email_valid=VALUES(email_valid), wa_reachable=VALUES(wa_reachable),
       touches_total=VALUES(touches_total), replies_total=VALUES(replies_total), no_show_count=VALUES(no_show_count), objections_json=VALUES(objections_json),
       next_action=VALUES(next_action), next_action_reason=VALUES(next_action_reason), computed_at=NOW()`,
    [leadId, r.engagementScore, r.reliabilityScore, r.bestChannel, r.bestHourIst, input.language ?? null,
      r.emailValid == null ? null : r.emailValid ? 1 : 0, r.waReachable == null ? null : r.waReachable ? 1 : 0,
      r.touches, r.replies, input.noShowCount, JSON.stringify(objections), r.nextAction, r.nextActionReason],
  );
}
