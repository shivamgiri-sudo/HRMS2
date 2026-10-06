/**
 * Drive shortlist: every candidate matched to a drive with WHY they fit (score, confidence, reasons from the
 * requisition's requirements), WHERE they are in the outreach (email -> WhatsApp -> bot call -> reply/slot), and
 * WHICH other open requisitions they also fit (cross-matching). Read-only.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { loadOpenRequisitionsForMatching } from "./he-drive.service.js";
import { rankRequisitions } from "./he-matcher.js";
import { ratingFor } from "./he-jd-doc.js";
import { loadProfiles } from "./he-profile.service.js";
import { cleanName } from "./he-name.js";

export const SHORTLIST_FILTERS = ["all", "not_contacted", "emailed", "whatsapp", "called", "replied", "confirmed", "declined"] as const;
export type ShortlistFilter = (typeof SHORTLIST_FILTERS)[number];

const parse = (v: unknown) => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } };

export async function getDriveShortlist(driveId: string, o: { filter?: ShortlistFilter; page?: number; size?: number; q?: string } = {}) {
  const size = Math.min(100, Math.max(10, o.size ?? 50));
  const page = Math.max(1, o.page ?? 1);
  const [dr] = await db.execute<RowDataPacket[]>("SELECT requisition_id FROM he_drive WHERE id = ? LIMIT 1", [driveId]);
  if (!dr[0]) return null;
  const reqId = String(dr[0].requisition_id);
  // Latest touch per channel for each match's lead (requisition-attributed messages first, else any for the lead).
  const touch = `
    (SELECT CONCAT(msg.delivery_status, '|', DATE_FORMAT(msg.created_at, '%Y-%m-%d %H:%i')) FROM he_message msg
      WHERE msg.lead_id = m.lead_id AND msg.direction = 'out' AND msg.channel = ? AND (msg.requisition_id = m.requisition_id OR msg.requisition_id IS NULL)
      ORDER BY msg.created_at DESC LIMIT 1)`;
  const where: string[] = ["m.drive_id = ?"];
  const args: unknown[] = [];
  if (o.q?.trim()) { where.push("(l.full_name LIKE ? OR l.mobile10 LIKE ?)"); args.push(`%${o.q.trim()}%`, `%${o.q.trim()}%`); }
  const f = o.filter ?? "all";
  const has = (ch: string) => `EXISTS (SELECT 1 FROM he_message x WHERE x.lead_id = m.lead_id AND x.direction = 'out' AND x.channel = '${ch}' AND x.delivery_status <> 'failed')`;
  if (f === "not_contacted") where.push(`m.state = 'suggested' AND NOT ${has("email")} AND NOT ${has("whatsapp")}`);
  if (f === "emailed") where.push(has("email"));
  if (f === "whatsapp") where.push(has("whatsapp"));
  if (f === "called") where.push("EXISTS (SELECT 1 FROM he_call c WHERE c.lead_id = m.lead_id)");
  if (f === "replied") where.push("EXISTS (SELECT 1 FROM he_message i WHERE i.lead_id = m.lead_id AND i.direction = 'in')");
  if (f === "confirmed") where.push("m.state IN ('confirmed','arrived')");
  if (f === "declined") where.push("m.state IN ('declined','no_show') OR l.status IN ('declined','opted_out')");
  const w = where.join(" AND ");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.lead_id, m.state, m.score, m.reasons_json, m.slot_at, l.full_name, l.mobile10, l.email, l.status AS lead_status, l.primary_source,
            l.age, l.education_rank, l.experience_years, l.night_shift_ok, l.lat, l.lng, l.locality, l.effort_tier, l.walkin_count,
            EXISTS (SELECT 1 FROM he_consent k WHERE k.lead_id = m.lead_id AND k.consent_type = 'whatsapp_contact' AND k.revoked_at IS NULL) AS wa_consent,
            ${touch} AS email_touch, ${touch} AS wa_touch,
            (SELECT CONCAT(COALESCE(c.outcome, 'placed'), '|', DATE_FORMAT(COALESCE(c.started_at, c.created_at), '%Y-%m-%d %H:%i')) FROM he_call c WHERE c.lead_id = m.lead_id ORDER BY c.created_at DESC LIMIT 1) AS call_touch,
            (SELECT CONCAT(COALESCE(i.intent, 'reply'), '|', DATE_FORMAT(i.created_at, '%Y-%m-%d %H:%i')) FROM he_message i WHERE i.lead_id = m.lead_id AND i.direction = 'in' ORDER BY i.created_at DESC LIMIT 1) AS reply
       FROM he_match m JOIN he_lead l ON l.id = m.lead_id
      WHERE ${w}
      ORDER BY FIELD(m.state, 'confirmed', 'invited', 'suggested', 'slot_released', 'arrived', 'no_show', 'declined', 'selected'), m.score DESC
      LIMIT ${size} OFFSET ${(page - 1) * size}`,
    ["email", "whatsapp", driveId, ...args]);
  const [cnt] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE ${w}`, [driveId, ...args]);
  const [states] = await db.execute<RowDataPacket[]>("SELECT state, COUNT(*) AS n FROM he_match WHERE drive_id = ? GROUP BY state", [driveId]);

  // Cross-matching: the other open requisitions each person fits, ranked by the same matcher.
  const reqs = (await loadOpenRequisitionsForMatching()).filter((r) => r.id !== reqId);
  const profiles = await loadProfiles(rows.map((r) => String(r.lead_id)));
  const split = (v: unknown) => { const s = String(v ?? ""); if (!s) return null; const [a, b] = s.split("|"); return { status: a, at: b ?? null }; };
  const data = rows.map((r) => {
    const rj = parse(r.reasons_json) as { reasons?: string[]; unknown?: string[]; confidence?: number; priority?: number } | null;
    const lead = { age: r.age, educationRank: r.education_rank, experienceYears: r.experience_years == null ? null : Number(r.experience_years), nightShiftOk: r.night_shift_ok == null ? null : Boolean(r.night_shift_ok), lat: r.lat == null ? null : Number(r.lat), lng: r.lng == null ? null : Number(r.lng), city: r.locality ?? null, ...profiles.get(String(r.lead_id)) };
    const also = rankRequisitions(lead, reqs, 3).map((x) => ({ code: x.req.code, role: x.req.role, process: x.req.process, branch: x.req.branch, score: x.result.score }));
    return {
      matchId: r.id, leadId: r.lead_id, name: cleanName(r.full_name) || r.full_name, mobile: String(r.mobile10).slice(0, 2) + "xxxxxx" + String(r.mobile10).slice(-2),
      hasEmail: Boolean(r.email), waConsent: Number(r.wa_consent) === 1, source: r.primary_source, effort: r.effort_tier, walkins: Number(r.walkin_count ?? 0),
      state: r.state, leadStatus: r.lead_status, slotAt: r.slot_at ? String(r.slot_at).slice(0, 16) : null,
      fit: { score: Number(r.score), rating: ratingFor(Number(r.score)), confidence: rj?.confidence ?? null, reasons: rj?.reasons ?? [], unknown: rj?.unknown ?? [], priority: rj?.priority ?? null },
      email: split(r.email_touch), whatsapp: split(r.wa_touch), call: split(r.call_touch), reply: split(r.reply),
      alsoFits: also,
    };
  });
  return { total: Number(cnt[0]?.n ?? 0), page, size, byState: Object.fromEntries(states.map((s) => [s.state, Number(s.n)])), data };
}
