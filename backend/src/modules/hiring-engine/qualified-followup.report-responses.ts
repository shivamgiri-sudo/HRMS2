/**
 * "Responses" section of the follow-up daily report: per channel how many answers came in and how many were confirms, the HR review
 * queue (size, oldest age), inbound health over 7 days (WhatsApp replies, e-mail replies and when the mailbox poller last ran) and the
 * conflicts of the window. Counts and times only, never a phone number or a message text. Statements are keyed on candidate_response
 * (occurred_at) / (status, occurred_at); a missing ledger (before migration 2141) or a failed read gives null ("unavailable").
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";

export interface ResponsesSection {
  byChannel: Array<{ channel: string; responses: number; confirms: number }>;
  conflicts: number;
  queue: { size: number; oldestHours: number | null };
  whatsappInbound: { lastAt: string | null; count7d: number };
  emailInbound: { lastAt: string | null; count7d: number; pollerAt: string | null };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const minusDays = (wall: string, n: number): string => new Date(Date.parse(`${wall.replace(" ", "T")}Z`) - n * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
const hoursBetween = (from: string, to: string): number => Math.max(0, Math.floor((Date.parse(`${to.replace(" ", "T")}Z`) - Date.parse(`${from.replace(" ", "T")}Z`)) / 3_600_000));

/** f / t: the report window as IST wall clock ('YYYY-MM-DD HH:MM:SS'). */
export async function collectResponsesSection(f: string, t: string, _now: Date = new Date()): Promise<ResponsesSection | null> {
  try {
    const week = minusDays(t, 7);
    const [[byCh], [queue], [inbound]] = await Promise.all([
      db.execute<RowDataPacket[]>(`SELECT cr.channel, COUNT(*) AS responses, SUM(cr.answer = 'confirm') AS confirms, SUM(cr.conflict = 1) AS conflicts
         FROM candidate_response cr WHERE cr.occurred_at >= ? AND cr.occurred_at < ? GROUP BY cr.channel ORDER BY responses DESC`, [f, t]),
      db.execute<RowDataPacket[]>("SELECT COUNT(*) AS n, MIN(cr.occurred_at) AS oldest FROM candidate_response cr WHERE cr.status = 'needs_review'"),
      db.execute<RowDataPacket[]>(`SELECT cr.channel, MAX(cr.occurred_at) AS last_at, COUNT(*) AS n FROM candidate_response cr
         WHERE cr.occurred_at >= ? AND cr.source_kind IN ('he_message','meta_message','inbound_email','email_thread','email_sender') GROUP BY cr.channel`, [week]),
    ]);
    let pollerAt: string | null = null;
    try { pollerAt = str((await db.execute<RowDataPacket[]>("SELECT MAX(updated_at) AS at FROM inbound_email_cursor"))[0][0]?.at); } catch { /* poller table absent */ }
    const inb = (ch: string) => inbound.find((r) => r.channel === ch);
    const oldest = str(queue[0]?.oldest);
    return {
      byChannel: byCh.filter((r) => r.channel != null).map((r) => ({ channel: String(r.channel), responses: Number(r.responses ?? 0), confirms: Number(r.confirms ?? 0) })),
      conflicts: byCh.reduce((a, r) => a + Number(r.conflicts ?? 0), 0),
      queue: { size: Number(queue[0]?.n ?? 0), oldestHours: oldest ? hoursBetween(oldest, t) : null },
      whatsappInbound: { lastAt: str(inb("whatsapp")?.last_at), count7d: Number(inb("whatsapp")?.n ?? 0) },
      emailInbound: { lastAt: str(inb("email")?.last_at), count7d: Number(inb("email")?.n ?? 0), pollerAt },
    };
  } catch (err) {
    logger.warn({ code: (err as { code?: unknown })?.code ?? "unknown" }, "[qualified-followup] daily report: responses unavailable");
    return null;
  }
}

/** The section as HTML and text lines (heading included). */
export function responsesLines(s: ResponsesSection | null): { html: string; text: string[] } {
  if (!s) return { html: "<h3>Responses</h3><p>unavailable</p>", text: ["Responses", "unavailable"] };
  const lines = [
    ...(s.byChannel.length ? s.byChannel.map((c) => `${c.channel}: ${c.responses} responses, ${c.confirms} confirmed`) : ["No responses in this window."]),
    `Waiting for HR review: ${s.queue.size}${s.queue.oldestHours != null ? ` (oldest ${s.queue.oldestHours} h)` : ""}`,
    s.whatsappInbound.count7d > 0 ? `WhatsApp inbound: ${s.whatsappInbound.count7d} in 7 days, last ${s.whatsappInbound.lastAt}` : "WARNING WhatsApp inbound: none in 7 days",
    s.emailInbound.count7d > 0 ? `Email inbound: ${s.emailInbound.count7d} in 7 days, last ${s.emailInbound.lastAt}`
      : `Email inbound: none in 7 days${s.emailInbound.pollerAt ? ` (mailbox last read ${s.emailInbound.pollerAt})` : " (mailbox poller not running)"}`,
    `Conflicts (a later answer against a confirm): ${s.conflicts}`,
  ];
  return { html: `<h3>Responses</h3><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`, text: ["Responses", ...lines] };
}
