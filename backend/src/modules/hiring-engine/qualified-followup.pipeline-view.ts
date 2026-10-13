/**
 * The CEO's view of the follow-up pipeline: for each drive (Live Meta, Old Meta data, Hiring Engine) how many qualified people were
 * enrolled, emailed, WhatsApped, called, engaged, confirmed and arrived, what is still queued and why, and what the engine did in the
 * last 24 hours. Counts only; live rows only. Never throws: a failed read leaves that block empty.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { inSendWindow, nextSendWindowOpen } from "./followup-guards.js";
import type { SourceType } from "./qualified-followup.types.js";

export interface PipelineSource {
  sourceType: SourceType; label: string;
  enrolled: number; emailed: number; whatsapped: number; called: number; engaged: number; confirmed: number; arrived: number; stopped: number;
  /** Still to come: people whose first email / WhatsApp / call has not gone yet (open rows only). */
  waiting: { email: number; whatsapp: number; call: number };
  lastEmailAt: string | null; lastWhatsappAt: string | null;
  /** Enrolled since 00:00 IST today (every drive). */
  enrolledToday: number;
  /** Live Meta only: today's Meta form fills and how many the screening qualified, as on the Meta campaign page (IST day). */
  formFillsToday?: { fills: number; qualified: number };
}
export interface PipelineView {
  generatedAt: string; windowOpen: boolean; nextWindowOpen: string;
  last24h: { emails: number; whatsapps: number; callResults: number; replies: number; confirmations: number };
  sources: PipelineSource[];
}

export const SOURCE_LABEL: Record<SourceType, string> = { meta_live: "Live Meta", meta_old: "Old Meta data", he: "Hiring Engine" };
const ORDER: SourceType[] = ["meta_live", "meta_old", "he"];
const n = (v: unknown): number => Number(v ?? 0) || 0;
const iso = (d: Date): string => d.toISOString();
const wall = (v: unknown): string | null => (v == null || v === "" ? null : String(v).replace("T", " ").slice(0, 16));

async function safe<T>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (err) { logger.warn({ label, err: (err as Error).message.slice(0, 120) }, "[pipeline-view] read failed"); return fallback; }
}

export async function getPipelineView(now: Date = new Date()): Promise<PipelineView> {
  const rows = await safe<RowDataPacket[]>("by-source", [], async () => (await db.execute<RowDataPacket[]>(
    `SELECT source_type, COUNT(*) enrolled,
            SUM(email_sent_at IS NOT NULL) emailed, SUM(wa_sent_at IS NOT NULL) whatsapped, SUM(call_state = 'called') called,
            SUM(journey_state = 'engaged') engaged, SUM(journey_state IN ('confirmed','reminded')) confirmed, SUM(journey_state = 'arrived') arrived,
            SUM(stopped_reason IS NOT NULL) stopped,
            SUM(stopped_reason IS NULL AND email_sent_at IS NULL AND (email_status IS NULL OR email_status = 'failed')) w_email,
            SUM(stopped_reason IS NULL AND wa_sent_at IS NULL AND (wa_status IS NULL OR wa_status = 'failed') AND journey_state NOT IN ('held_manual','declined','stopped')) w_wa,
            SUM(stopped_reason IS NULL AND call_state IN ('pending','in_file') AND journey_state NOT IN ('held_manual','declined','stopped')) w_call,
            SUM(created_at >= DATE_SUB(DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE)), INTERVAL 330 MINUTE)) enrolled_today,
            MAX(email_sent_at) last_email, MAX(wa_sent_at) last_wa
       FROM qualified_followup WHERE mode_at_enqueue = 'live' GROUP BY source_type`))[0]);
  const by = new Map(rows.map((r) => [String(r.source_type), r]));
  const sources: PipelineSource[] = ORDER.map((t) => {
    const r = by.get(t);
    return {
      sourceType: t, label: SOURCE_LABEL[t], enrolled: n(r?.enrolled), emailed: n(r?.emailed), whatsapped: n(r?.whatsapped), called: n(r?.called),
      engaged: n(r?.engaged), confirmed: n(r?.confirmed), arrived: n(r?.arrived), stopped: n(r?.stopped),
      waiting: { email: n(r?.w_email), whatsapp: n(r?.w_wa), call: n(r?.w_call) }, lastEmailAt: wall(r?.last_email), lastWhatsappAt: wall(r?.last_wa),
      enrolledToday: n(r?.enrolled_today),
    };
  });
  const fills = await safe<RowDataPacket | null>("fills-today", null, async () => (await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) fills, SUM(screening_result = 'qualified') qualified FROM meta_lead_raw
      WHERE created_at >= DATE_SUB(DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE)), INTERVAL 330 MINUTE)`))[0][0] ?? null);
  const live = sources.find((x) => x.sourceType === "meta_live");
  if (live && fills) live.formFillsToday = { fills: n(fills.fills), qualified: n(fills.qualified) };
  const day = await safe<RowDataPacket | null>("last24h", null, async () => (await db.execute<RowDataPacket[]>(
    `SELECT (SELECT COUNT(*) FROM qualified_followup WHERE mode_at_enqueue = 'live' AND email_sent_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) emails,
            (SELECT COUNT(*) FROM qualified_followup WHERE mode_at_enqueue = 'live' AND wa_sent_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) whatsapps,
            (SELECT COUNT(*) FROM qualified_followup WHERE mode_at_enqueue = 'live' AND called_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) call_results,
            (SELECT COUNT(*) FROM he_message WHERE direction = 'in' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) replies,
            (SELECT COUNT(*) FROM he_match WHERE confirmed_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) confirmations`))[0][0] ?? null);
  return {
    generatedAt: iso(now), windowOpen: inSendWindow(now), nextWindowOpen: iso(nextSendWindowOpen(now)),
    last24h: { emails: n(day?.emails), whatsapps: n(day?.whatsapps), callResults: n(day?.call_results), replies: n(day?.replies), confirmations: n(day?.confirmations) },
    sources,
  };
}
