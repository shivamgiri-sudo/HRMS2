/**
 * One person's timeline, newest first: Hiring Engine messages (out and in), recorded responses, state events, voice calls, the old Meta
 * flow's WhatsApp messages and invitation, and invite links e-mailed without a match. At most 300 items. The person is found by a
 * response, a match or a lead id (never by a mobile in the URL); a branch user sees the person only when a row of theirs belongs to a
 * requisition in that branch (else null = 404). Text is shown as a scrubbed preview; the mobile is masked.
 * Every statement is keyed: he_message (mobile10, created_at), candidate_response (mobile10, occurred_at), he_lead_event / he_call
 * (lead_id, created_at), meta_lead_messages (lead_id), meta_lead_raw / he_lead by primary key, walkin_invite (mobile10, requisition_id).
 */
import type { RowDataPacket } from "mysql2";
import { limitedDb } from "./he-read-limit.js";
import type { BranchScope } from "../meta-campaign/meta-access.js";
import { maskMobile } from "./qualified-followup.rules.js";
import { preview, shortName } from "./response-read.service.js";

export const TIMELINE_MAX = 300;
export type TimelineKind = "out" | "in" | "response" | "event" | "call";
export interface TimelineItem { at: string; kind: TimelineKind; channel: string | null; label: string; detail: string }
export interface Timeline { person: { name: string; mobileMasked: string }; items: TimelineItem[]; truncated: boolean }
export type TimelineKey = { responseId: number } | { matchId: string } | { leadId: string };

const read = async (sql: string, params: unknown[]): Promise<RowDataPacket[]> => (await limitedDb.execute<RowDataPacket[]>(sql, params))[0];
const missing = (err: unknown): boolean => ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(String((err as { code?: unknown })?.code));
const soft = async (sql: string, params: unknown[]): Promise<RowDataPacket[]> => { try { return await read(sql, params); } catch (err) { if (missing(err)) return []; throw err; } };
const words = (s: unknown): string => String(s ?? "").replace(/[_:]+/g, " ").trim().toLowerCase();
const ph = (n: number): string => Array(n).fill("?").join(",");
const L = TIMELINE_MAX;

interface Person { mobile10: string; leadId: string | null; metaLeadId: string | null; name: unknown; branch?: unknown }

async function resolve(key: TimelineKey): Promise<Person | null> {
  if ("responseId" in key) {
    const [r] = await soft(`SELECT cr.mobile10, cr.lead_id, cr.meta_lead_id, jr.branch_name FROM candidate_response cr LEFT JOIN job_requisition jr ON jr.id = cr.requisition_id WHERE cr.id = ? LIMIT 1`, [key.responseId]);
    return r ? { mobile10: String(r.mobile10), leadId: r.lead_id ? String(r.lead_id) : null, metaLeadId: r.meta_lead_id ? String(r.meta_lead_id) : null, name: null, branch: r.branch_name ?? null } : null;
  }
  if ("matchId" in key) {
    const [r] = await read(`SELECT l.id, l.mobile10, l.meta_lead_id, l.full_name, jr.branch_name FROM he_match m JOIN he_lead l ON l.id = m.lead_id LEFT JOIN job_requisition jr ON jr.id = m.requisition_id WHERE m.id = ? LIMIT 1`, [key.matchId]);
    return r ? { mobile10: String(r.mobile10), leadId: String(r.id), metaLeadId: r.meta_lead_id ? String(r.meta_lead_id) : null, name: r.full_name, branch: r.branch_name ?? null } : null;
  }
  const [r] = await read("SELECT l.id, l.mobile10, l.meta_lead_id, l.full_name FROM he_lead l WHERE l.id = ? LIMIT 1", [key.leadId]);
  return r ? { mobile10: String(r.mobile10), leadId: String(r.id), metaLeadId: r.meta_lead_id ? String(r.meta_lead_id) : null, name: r.full_name } : null;
}

/** A branch user sees a lead only when one of their matches or responses is on a requisition of that branch. */
async function leadInScope(p: Person, branch: string): Promise<boolean> {
  const [r] = await read(`SELECT (EXISTS (SELECT 1 FROM he_match m JOIN job_requisition jr ON jr.id = m.requisition_id WHERE m.lead_id = ? AND jr.branch_name = ?)
      OR EXISTS (SELECT 1 FROM candidate_response cr JOIN job_requisition jr ON jr.id = cr.requisition_id WHERE cr.mobile10 = ? AND jr.branch_name = ?)) AS in_scope`,
  [p.leadId, branch, p.mobile10, branch]).catch(async (err) => {
    if (!missing(err)) throw err; // before 2141: matches only
    return read("SELECT EXISTS (SELECT 1 FROM he_match m JOIN job_requisition jr ON jr.id = m.requisition_id WHERE m.lead_id = ? AND jr.branch_name = ?) AS in_scope", [p.leadId, branch]);
  });
  return Number(r?.in_scope ?? 0) === 1;
}

export async function personTimeline(key: TimelineKey, scope: BranchScope): Promise<Timeline | null> {
  if (!scope.all && !scope.branchName) return null;
  const p = await resolve(key);
  if (!p) return null;
  if (!p.leadId || p.name == null) { // a response without a lead: the person's lead (uq mobile) for name and events, when there is one
    const [l] = await read("SELECT l.id, l.mobile10, l.meta_lead_id, l.full_name FROM he_lead l WHERE l.mobile10 = ? LIMIT 1", [p.mobile10]);
    if (l) { p.leadId = p.leadId ?? String(l.id); p.metaLeadId = p.metaLeadId ?? (l.meta_lead_id ? String(l.meta_lead_id) : null); p.name = l.full_name; }
  }
  if (!scope.all) {
    if ("leadId" in key ? !(await leadInScope(p, scope.branchName as string)) : String(p.branch ?? "") !== scope.branchName) return null;
  }
  const metaIdRows = await soft(`SELECT DISTINCT cr.meta_lead_id FROM candidate_response cr WHERE cr.mobile10 = ? AND cr.meta_lead_id IS NOT NULL
                                  UNION SELECT wi.meta_lead_id FROM walkin_invite wi WHERE wi.mobile10 = ? AND wi.meta_lead_id IS NOT NULL LIMIT 20`, [p.mobile10, p.mobile10]);
  const metaIds = [...new Set([p.metaLeadId, ...metaIdRows.map((r) => r.meta_lead_id)].filter((x): x is string => typeof x === "string" && !!x))].slice(0, 20);
  const lead = p.leadId;
  const [messages, responses, events, calls, metaMessages, metaFills, invites] = await Promise.all([
    read(`SELECT hm.created_at, hm.direction, hm.channel, hm.template_key, LEFT(hm.body, 400) AS body, hm.delivery_status FROM he_message hm WHERE hm.mobile10 = ? ORDER BY hm.created_at DESC LIMIT ${L + 1}`, [p.mobile10]),
    soft(`SELECT cr.occurred_at, cr.channel, cr.mode, cr.answer, cr.status, cr.conflict FROM candidate_response cr WHERE cr.mobile10 = ? ORDER BY cr.occurred_at DESC LIMIT ${L + 1}`, [p.mobile10]),
    lead ? read(`SELECT ev.created_at, ev.event_type, ev.channel, ev.detail FROM he_lead_event ev WHERE ev.lead_id = ? ORDER BY ev.created_at DESC LIMIT ${L + 1}`, [lead]) : Promise.resolve([]),
    lead ? read(`SELECT hc.created_at, hc.outcome, hc.summary FROM he_call hc WHERE hc.lead_id = ? ORDER BY hc.created_at DESC LIMIT ${L + 1}`, [lead]) : Promise.resolve([]),
    metaIds.length ? read(`SELECT mm.created_at, mm.direction, LEFT(mm.message_text, 400) AS message_text FROM meta_lead_messages mm WHERE mm.lead_id IN (${ph(metaIds.length)}) ORDER BY mm.created_at DESC LIMIT ${L + 1}`, metaIds) : Promise.resolve([]),
    metaIds.length ? read(`SELECT ml.id, ml.notification_sent_at, ml.notification_channels FROM meta_lead_raw ml WHERE ml.id IN (${ph(metaIds.length)}) AND ml.notification_sent_at IS NOT NULL`, metaIds) : Promise.resolve([]),
    soft(`SELECT wi.last_sent_at, wi.source_path, wi.send_count, wi.state FROM walkin_invite wi WHERE wi.mobile10 = ? ORDER BY wi.last_sent_at DESC LIMIT 50`, [p.mobile10]),
  ]);
  const items: TimelineItem[] = [];
  for (const m of messages) items.push({ at: String(m.created_at), kind: m.direction === "in" ? "in" : "out", channel: m.channel ?? null,
    label: m.direction === "in" ? "Reply" : m.template_key ? `Sent: ${words(m.template_key)}` : "Message sent", detail: [preview(m.body), m.delivery_status ? `(${m.delivery_status})` : ""].filter(Boolean).join(" ") });
  for (const r of responses) items.push({ at: String(r.occurred_at), kind: "response", channel: r.channel ?? null,
    label: `Answer: ${words(r.answer)}${r.status === "needs_review" ? " (needs review)" : ""}`, detail: [words(r.mode), Number(r.conflict) === 1 ? "conflicts with an earlier confirm" : ""].filter(Boolean).join(" · ") });
  for (const e of events) items.push({ at: String(e.created_at), kind: "event", channel: e.channel ?? null, label: words(e.event_type), detail: preview(e.detail) });
  for (const c of calls) items.push({ at: String(c.created_at), kind: "call", channel: "voice_bot", label: `Call: ${words(c.outcome) || "no result yet"}`, detail: preview(c.summary) });
  for (const m of metaMessages) items.push({ at: String(m.created_at), kind: m.direction === "inbound" ? "in" : "out", channel: "whatsapp", label: m.direction === "inbound" ? "Reply (Meta flow)" : "Meta flow message", detail: preview(m.message_text) });
  for (const f of metaFills) {
    let ch: string[] = [];
    try { const v = typeof f.notification_channels === "string" ? JSON.parse(f.notification_channels) : f.notification_channels; ch = Array.isArray(v) ? v.map(String) : []; } catch { /* unreadable list */ }
    items.push({ at: String(f.notification_sent_at), kind: "out", channel: ch[0] ?? null, label: "Meta invitation sent", detail: ch.map(words).join(", ") });
  }
  for (const w of invites) items.push({ at: String(w.last_sent_at), kind: "out", channel: "email", label: "Answer link e-mailed", detail: `${words(w.source_path)} · sent ${Number(w.send_count ?? 1)} time(s) · ${words(w.state)}` });
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { person: { name: shortName(p.name), mobileMasked: maskMobile(p.mobile10) }, items: items.slice(0, L), truncated: items.length > L };
}
