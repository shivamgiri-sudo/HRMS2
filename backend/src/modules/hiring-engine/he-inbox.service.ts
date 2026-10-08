/**
 * Hiring Engine conversations for the WhatsApp Inbox page: every candidate the engine has written to or heard from, the full thread
 * (WhatsApp and email), and a free-text reply. Messages live in he_message (Pinbot WhatsApp + engine email), separate from the Meta
 * campaign inbox (meta_lead_messages: history, incl. the retired Wassenger gateway's), so this is a second source on the same page. Branch-scoped like the Meta inbox:
 * a branch user only sees candidates whose latest requisition is at their branch.
 *
 * WhatsApp only allows a free-text reply inside 24 hours of the candidate's last message; outside that window only an approved template
 * can be sent, so the reply box is closed and says why.
 */
import type { RowDataPacket } from "mysql2";
import { randomUUID } from "node:crypto";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { PinbotWhatsAppProvider } from "../communication/providers/whatsapp/pinbot.provider.js";
import type { BranchScope } from "../meta-campaign/meta-access.js";
import { addEvent } from "./he-lead.service.js";
import { cleanName } from "./he-name.js";

export interface InboxRow { leadId: string; name: string; mobile: string; branch: string | null; role: string | null; lastText: string; lastDirection: "in" | "out"; lastChannel: string; lastAt: string; lastStatus: string | null; unread: number; windowOpen: boolean }
export interface ThreadMessage { id: string; channel: "whatsapp" | "email"; direction: "in" | "out"; text: string; kind: string | null; status: string | null; error: string | null; at: string }

const scopeSql = (scope: BranchScope) => (scope.all ? { sql: "", args: [] as unknown[] } : { sql: "AND jr.branch_name = ?", args: [scope.branchName] as unknown[] });
const preview = (kind: string | null, channel: string, body: string) => (channel === "email" ? `Email: ${body}` : kind && kind !== "manual_reply" && !/^he_/.test(kind) ? body : body);

// Driven from he_message (hundreds of rows), not he_lead (tens of thousands, most never messaged): starting from the
// leads ran every per-row subquery for ~38k candidates and took 35 s, so the tab appeared to load forever.
export async function listInbox(scope: BranchScope, search: string | undefined): Promise<{ total: number; unread: number; data: InboxRow[] }> {
  if (!scope.all && !scope.branchName) return { total: 0, unread: 0, data: [] }; // fail closed
  const sc = scopeSql(scope);
  const q = search?.trim() ? "AND (l.full_name LIKE ? OR l.mobile10 LIKE ?)" : "";
  const qa = search?.trim() ? [`%${search.trim()}%`, `%${search.trim()}%`] : [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT l.id AS lead_id, l.full_name, l.mobile10, jr.branch_name, jr.designation_name,
            lm.body, lm.direction, lm.channel, lm.template_key, lm.delivery_status, lm.created_at AS last_at,
            (SELECT COUNT(*) FROM he_message x WHERE x.lead_id = l.id AND x.channel = 'whatsapp' AND x.direction = 'in'
                AND x.created_at > COALESCE((SELECT MAX(e.created_at) FROM he_lead_event e WHERE e.lead_id = l.id AND e.event_type = 'inbox_read'), '2000-01-01')) AS unread,
            (SELECT COUNT(*) FROM he_message w WHERE w.lead_id = l.id AND w.channel = 'whatsapp' AND w.direction = 'in' AND w.created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS in_window
       FROM he_message lm
       JOIN he_lead l ON l.id = lm.lead_id
       LEFT JOIN job_requisition jr ON jr.id = (SELECT m3.requisition_id FROM he_message m3 WHERE m3.lead_id = l.id AND m3.requisition_id IS NOT NULL ORDER BY m3.created_at DESC LIMIT 1)
      WHERE lm.id = (SELECT m2.id FROM he_message m2 WHERE m2.lead_id = lm.lead_id ORDER BY m2.created_at DESC, m2.id DESC LIMIT 1) ${sc.sql} ${q}
      ORDER BY lm.created_at DESC LIMIT 300`, [...sc.args, ...qa]);
  const data: InboxRow[] = rows.map((r) => ({
    leadId: String(r.lead_id), name: cleanName(r.full_name) || String(r.full_name ?? "") || `+91 ${String(r.mobile10).slice(0, 2)}xxxxxx${String(r.mobile10).slice(-2)}`,
    mobile: String(r.mobile10), branch: r.branch_name ?? null, role: r.designation_name ?? null, lastText: preview(r.template_key, String(r.channel), String(r.body ?? "")).slice(0, 140),
    lastDirection: r.direction === "in" ? "in" : "out", lastChannel: String(r.channel), lastAt: new Date(r.last_at).toISOString(), lastStatus: r.delivery_status ?? null, unread: Number(r.unread), windowOpen: Number(r.in_window) > 0,
  }));
  return { total: data.length, unread: data.reduce((s, r) => s + r.unread, 0), data };
}

/** Is this candidate inside the caller's branch scope? Judged by the requisition of their latest engine message. */
async function inScope(leadId: string, scope: BranchScope): Promise<boolean> {
  if (scope.all) return true;
  if (!scope.branchName) return false;
  const [r] = await db.execute<RowDataPacket[]>(
    `SELECT jr.branch_name FROM he_message m JOIN job_requisition jr ON jr.id = m.requisition_id WHERE m.lead_id = ? AND m.requisition_id IS NOT NULL ORDER BY m.created_at DESC LIMIT 1`, [leadId]);
  return r[0]?.branch_name === scope.branchName;
}

export async function getInboxThread(leadId: string, scope: BranchScope, actorId: string | null): Promise<{ lead: { id: string; name: string; mobile: string; status: string; branch: string | null; role: string | null }; window: { open: boolean; lastInboundAt: string | null; closesAt: string | null }; messages: ThreadMessage[] } | null> {
  if (!(await inScope(leadId, scope))) return null;
  const [lr] = await db.execute<RowDataPacket[]>("SELECT id, full_name, mobile10, status FROM he_lead WHERE id = ? LIMIT 1", [leadId]);
  const l = lr[0]; if (!l) return null;
  const [ms] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.channel, m.direction, m.body, m.template_key, m.delivery_status, m.error_message, m.created_at, jr.branch_name, jr.designation_name
       FROM he_message m LEFT JOIN job_requisition jr ON jr.id = m.requisition_id WHERE m.lead_id = ? ORDER BY m.created_at ASC, m.id ASC LIMIT 500`, [leadId]);
  const lastIn = [...ms].reverse().find((m) => m.direction === "in" && m.channel === "whatsapp");
  const lastInIso = lastIn ? new Date(lastIn.created_at).toISOString() : null;
  const closes = lastInIso ? new Date(new Date(lastInIso).getTime() + 24 * 3600_000) : null;
  const ctx = [...ms].reverse().find((m) => m.branch_name);
  await addEvent(leadId, "inbox_read", { actor: actorId, channel: "inbox" }); // clears the unread count
  return {
    lead: { id: leadId, name: cleanName(l.full_name) || String(l.full_name ?? ""), mobile: String(l.mobile10), status: String(l.status), branch: ctx?.branch_name ?? null, role: ctx?.designation_name ?? null },
    window: { open: Boolean(closes && closes.getTime() > Date.now()), lastInboundAt: lastInIso, closesAt: closes ? closes.toISOString() : null },
    messages: ms.map((m) => ({ id: String(m.id), channel: m.channel === "email" ? "email" : "whatsapp", direction: m.direction === "in" ? "in" : "out", text: String(m.body ?? ""), kind: m.template_key ?? null, status: m.delivery_status ?? null, error: m.error_message ?? null, at: new Date(m.created_at).toISOString() })),
  };
}

export async function replyToCandidate(leadId: string, message: string, scope: BranchScope, actorId: string | null): Promise<{ ok: true; messageId: string } | { ok: false; status: number; message: string }> {
  const text = message.trim();
  if (!text) return { ok: false, status: 400, message: "Type a message first." };
  if (text.length > 1000) return { ok: false, status: 400, message: "Keep it under 1,000 characters." };
  if (!(await inScope(leadId, scope))) return { ok: false, status: 403, message: "This candidate is outside your branch." };
  const [lr] = await db.execute<RowDataPacket[]>("SELECT id, mobile10, status FROM he_lead WHERE id = ? LIMIT 1", [leadId]);
  const l = lr[0]; if (!l) return { ok: false, status: 404, message: "Candidate not found." };
  if (l.status === "opted_out") return { ok: false, status: 409, message: "This candidate opted out, so no message can be sent." };
  const [win] = await db.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM he_message WHERE lead_id = ? AND channel = 'whatsapp' AND direction = 'in' AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)", [leadId]);
  if (Number(win[0].n) === 0) return { ok: false, status: 409, message: "WhatsApp only allows a typed reply within 24 hours of the candidate's last message. Outside that window only an approved template can be sent (the automatic follow-ups use those)." };
  const pinbot = new PinbotWhatsAppProvider();
  if (!pinbot.isConfigured()) return { ok: false, status: 409, message: "WhatsApp (Pinbot) is not configured on the server." };
  const [ctx] = await db.execute<RowDataPacket[]>("SELECT requisition_id, drive_id FROM he_message WHERE lead_id = ? AND requisition_id IS NOT NULL ORDER BY created_at DESC LIMIT 1", [leadId]);
  const res = await pinbot.send(String(l.mobile10), "", text);
  const id = randomUUID();
  await db.execute(
    "INSERT INTO he_message (id, lead_id, mobile10, direction, channel, template_key, body, provider_message_id, delivery_status, error_message, requisition_id, drive_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [id, leadId, l.mobile10, "out", "whatsapp", "manual_reply", text.slice(0, 2000), res.success ? res.message_id ?? null : null, res.success ? "sent" : "failed", res.success ? null : String(res.error ?? "").slice(0, 480), ctx[0]?.requisition_id ?? null, ctx[0]?.drive_id ?? null]);
  await addEvent(leadId, "manual_reply", { actor: actorId, channel: "whatsapp", detail: text.slice(0, 200) });
  if (!res.success) { logger.warn({ leadId, error: res.error }, "[he-inbox] reply failed"); return { ok: false, status: 502, message: `WhatsApp did not accept the message: ${String(res.error ?? "unknown error").slice(0, 160)}` }; }
  await db.execute("UPDATE he_lead SET last_contact_at = NOW() WHERE id = ?", [leadId]);
  return { ok: true, messageId: id };
}
