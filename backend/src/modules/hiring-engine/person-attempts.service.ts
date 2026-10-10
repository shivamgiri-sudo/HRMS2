/**
 * Fresh vs repeat approach history of a person (by mobile10), across every requisition and every channel.
 *
 * "Contact" = something we sent or tried (follow-up email/WhatsApp/call, the old Meta notification, a Hiring Engine message or call).
 * "Connected" = the person answered a call, replied on any channel, or confirmed/arrived. The current journey (this requisition, this
 * follow-up row) is excluded, so a person is FRESH when nothing else ever reached them and REPEAT otherwise, with how many earlier
 * approaches there were, for which requisitions, and how many times we actually connected.
 * Read-only; a read error returns an empty map (callers fall back to "unknown", never to a wrong "fresh").
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export type AttemptKind = "email" | "whatsapp" | "call" | "legacy_notify" | "inbound" | "call_connected" | "confirmed";
export interface AttemptEvent { requisitionId: string | null; requisitionCode: string | null; kind: AttemptKind; at: string; journeyId?: string | null }
export interface PriorRequisition { requisitionId: string | null; code: string; contacts: number; connected: number; lastAt: string | null }
export interface PersonAttempts {
  mobile10: string;
  type: "fresh" | "repeat";
  /** 1 for a fresh person, otherwise earlier approaches + 1. */
  approachNo: number;
  priorContacts: number;
  timesConnected: number;
  priorRequisitions: PriorRequisition[];
}
const OUT: ReadonlySet<AttemptKind> = new Set(["email", "whatsapp", "call", "legacy_notify"]);
const CONNECTED: ReadonlySet<AttemptKind> = new Set(["inbound", "call_connected", "confirmed"]);

/** Pure. `current` = the journey being decided: its events (same follow-up row id) are not "prior". */
export function summariseAttempts(mobile10: string, events: AttemptEvent[], current: { journeyId?: string | null }): PersonAttempts {
  const prior = events.filter((e) => !(current.journeyId && e.journeyId === current.journeyId));
  const by = new Map<string, PriorRequisition>();
  let contacts = 0, connected = 0;
  for (const e of prior) {
    const out = OUT.has(e.kind), con = CONNECTED.has(e.kind);
    if (!out && !con) continue;
    const key = e.requisitionId ?? "(none)";
    const row = by.get(key) ?? { requisitionId: e.requisitionId, code: e.requisitionCode ?? "", contacts: 0, connected: 0, lastAt: null };
    if (out) { row.contacts += 1; contacts += 1; }
    if (con) { row.connected += 1; connected += 1; }
    if (!row.lastAt || e.at > row.lastAt) row.lastAt = e.at;
    by.set(key, row);
  }
  const rows = [...by.values()].sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
  return { mobile10, type: contacts === 0 ? "fresh" : "repeat", approachNo: contacts === 0 ? 1 : rows.filter((r) => r.contacts > 0).length + 1, priorContacts: contacts, timesConnected: connected, priorRequisitions: rows };
}

const C = "COLLATE utf8mb4_unicode_ci";
const CHUNK = 400;
const ph = (n: number) => Array.from({ length: n }, () => "?").join(",");
const wall = (v: unknown) => (v == null ? "" : String(v).replace("T", " ").slice(0, 19));

/** mobile10 -> events (outbound + connected signals) from every table that records an approach. */
export async function loadAttemptEvents(mobiles: string[]): Promise<Map<string, AttemptEvent[]>> {
  const out = new Map<string, AttemptEvent[]>();
  const push = (m: string, e: AttemptEvent) => { const a = out.get(m) ?? []; a.push(e); out.set(m, a); };
  const list = [...new Set(mobiles.filter((m) => /^\d{10}$/.test(m)))];
  try {
    for (let i = 0; i < list.length; i += CHUNK) {
      const part = list.slice(i, i + CHUNK), p = ph(part.length);
      const [fu] = await db.execute<RowDataPacket[]>(
        `SELECT qf.id, qf.mobile10, qf.requisition_id, jr.requisition_code, qf.email_sent_at, qf.wa_sent_at, qf.called_at
           FROM qualified_followup qf LEFT JOIN job_requisition jr ON jr.id ${C} = qf.requisition_id ${C}
          WHERE qf.mobile10 IN (${p}) AND qf.mode_at_enqueue = 'live'`, part).catch(() => [[] as RowDataPacket[]] as const);
      for (const r of fu) {
        const base = { requisitionId: r.requisition_id ? String(r.requisition_id) : null, requisitionCode: r.requisition_code ? String(r.requisition_code) : null, journeyId: String(r.id) };
        if (r.email_sent_at) push(String(r.mobile10), { ...base, kind: "email", at: wall(r.email_sent_at) });
        if (r.wa_sent_at) push(String(r.mobile10), { ...base, kind: "whatsapp", at: wall(r.wa_sent_at) });
        if (r.called_at) push(String(r.mobile10), { ...base, kind: "call", at: wall(r.called_at) });
      }
      const [calls] = await db.execute<RowDataPacket[]>(
        `SELECT l.mobile10, c.requisition_id, jr.requisition_code, c.outcome, c.created_at
           FROM he_call c JOIN he_lead l ON l.id = c.lead_id LEFT JOIN job_requisition jr ON jr.id ${C} = c.requisition_id ${C}
          WHERE l.mobile10 IN (${p})`, part);
      for (const r of calls) {
        const base = { requisitionId: r.requisition_id ? String(r.requisition_id) : null, requisitionCode: r.requisition_code ? String(r.requisition_code) : null };
        push(String(r.mobile10), { ...base, kind: "call", at: wall(r.created_at) });
        const o = String(r.outcome ?? "");
        if (o && o !== "NO_ANSWER" && !o.startsWith("CALL_FAILED")) push(String(r.mobile10), { ...base, kind: "call_connected", at: wall(r.created_at) });
      }
      const [msgs] = await db.execute<RowDataPacket[]>(
        `SELECT m.mobile10, m.direction, m.channel, m.requisition_id, jr.requisition_code, m.created_at
           FROM he_message m LEFT JOIN job_requisition jr ON jr.id ${C} = m.requisition_id ${C}
          WHERE m.mobile10 IN (${p}) AND m.delivery_status <> 'failed'`, part);
      for (const r of msgs) {
        const base = { requisitionId: r.requisition_id ? String(r.requisition_id) : null, requisitionCode: r.requisition_code ? String(r.requisition_code) : null, at: wall(r.created_at) };
        if (r.direction === "in") push(String(r.mobile10), { ...base, kind: "inbound" });
        else push(String(r.mobile10), { ...base, kind: /mail/i.test(String(r.channel)) ? "email" : "whatsapp" });
      }
      const [legacy] = await db.execute<RowDataPacket[]>(
        `SELECT RIGHT(REGEXP_REPLACE(r.parsed_phone, '[^0-9]', ''), 10) AS mobile10, r.requisition_id, jr.requisition_code, r.notification_sent_at
           FROM meta_lead_raw r LEFT JOIN job_requisition jr ON jr.id ${C} = r.requisition_id ${C}
          WHERE r.notification_sent_at IS NOT NULL AND RIGHT(REGEXP_REPLACE(r.parsed_phone, '[^0-9]', ''), 10) IN (${p})`, part);
      for (const r of legacy) push(String(r.mobile10), { requisitionId: r.requisition_id ? String(r.requisition_id) : null, requisitionCode: r.requisition_code ? String(r.requisition_code) : null, kind: "legacy_notify", at: wall(r.notification_sent_at) });
      const [match] = await db.execute<RowDataPacket[]>(
        `SELECT l.mobile10, m.requisition_id, jr.requisition_code, COALESCE(m.confirmed_at, m.created_at) AS at
           FROM he_match m JOIN he_lead l ON l.id = m.lead_id LEFT JOIN job_requisition jr ON jr.id ${C} = m.requisition_id ${C}
          WHERE l.mobile10 IN (${p}) AND m.state IN ('confirmed','arrived','selected')`, part);
      for (const r of match) push(String(r.mobile10), { requisitionId: r.requisition_id ? String(r.requisition_id) : null, requisitionCode: r.requisition_code ? String(r.requisition_code) : null, kind: "confirmed", at: wall(r.at) });
    }
  } catch { return new Map(); }
  return out;
}

/** The one-line text for the calling file / HR views, e.g. "REPEAT #3 | 5 contacts, 1 connected | NOIDA-Onfido-17 (2/0), NOIDA-Onfido-20 (3/1)". */
export function attemptLabel(a: PersonAttempts | undefined): string {
  if (!a) return "";
  if (a.type === "fresh") return "FRESH";
  const jrs = a.priorRequisitions.filter((r) => r.contacts > 0).map((r) => `${r.code || "?"} (${r.contacts}/${r.connected})`).join(", ");
  return `REPEAT #${a.approachNo} | ${a.priorContacts} contacts, ${a.timesConnected} connected | ${jrs}`;
}
