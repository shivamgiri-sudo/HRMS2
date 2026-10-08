/**
 * Response records for the legacy Meta voice-bot callbacks (/voice-callback, /vapi-callback). These calls carry no walk-in
 * answer the engine can apply, so nothing is applied here: a decline or an unclear result waits for HR in the review queue,
 * a missed call is recorded. WhatsApp replies come only through the Pinbot webhook (Wassenger is retired, owner decision O7).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { recordResponseSafe } from "../hiring-engine/candidate-response.service.js";
import { normalizeMobile10 } from "../hiring-engine/he-phone.js";
import type { ResponseAnswer } from "../hiring-engine/response-normalise.js";

export function answerFromMetaVoice(status: string): ResponseAnswer {
  const s = String(status ?? "").toLowerCase();
  if (s.includes("not_interested")) return "decline";
  if (s.includes("no_answer") || s.includes("busy") || s.includes("failed")) return "no_answer";
  return "other";
}

const istDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export async function recordMetaVoiceResponse(a: { metaLeadId: string; status: string; outcome: string | null; callId: string | null; source: "vapi" | "meta_voice"; at: Date }): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT parsed_phone FROM meta_lead_raw WHERE id = ? LIMIT 1", [a.metaLeadId]);
  const mobile10 = normalizeMobile10(rows[0]?.parsed_phone);
  if (!mobile10) return;
  const answer = answerFromMetaVoice(a.status);
  await recordResponseSafe({
    occurredAt: a.at, channel: "voice_bot", mode: "call", answer, mobile10, metaLeadId: a.metaLeadId,
    sourceKind: a.source, sourceRef: a.callId ?? `meta:${a.metaLeadId}:${a.status}:${istDay(a.at)}`, rawText: a.outcome,
    applied: false, status: answer === "no_answer" ? "recorded" : "needs_review",
  });
}
