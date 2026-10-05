/**
 * Unified lead pool: one he_lead row per mobile10, fed by Meta, ATS history, telecalling uploads,
 * portals and walk-ins. Also owns the append-only timeline, consent and signal persistence so every
 * other service writes through one place.
 */
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { normalizeMobile10 } from "./he-phone.js";
import type { Signal } from "./he-signals.js";
import type { LeadStatus } from "./he-state.js";

export interface LeadInput {
  mobile: string;
  fullName?: string | null;
  email?: string | null;
  age?: number | null;
  educationRank?: number | null;
  experienceYears?: number | null;
  nightShiftOk?: boolean | null;
  pincode?: string | null;
  locality?: string | null;
  source: string;
  atsCandidateId?: string | null;
  metaLeadId?: string | null;
}

export interface HeLead {
  id: string;
  mobile10: string;
  full_name: string | null;
  email: string | null;
  status: LeadStatus;
  ats_candidate_id: string | null;
  meta_lead_id: string | null;
}

/** Create or enrich a lead. Existing non-null values are never overwritten by nulls; sources accumulate. */
export async function upsertLead(input: LeadInput): Promise<{ id: string; created: boolean } | null> {
  const mobile10 = normalizeMobile10(input.mobile);
  if (!mobile10) return null;
  const [existing] = await db.execute<RowDataPacket[]>("SELECT id, sources_json FROM he_lead WHERE mobile10 = ? LIMIT 1", [mobile10]);
  if (existing[0]) {
    const id = existing[0].id as string;
    let sources: string[] = [];
    try {
      const raw = existing[0].sources_json;
      sources = Array.isArray(raw) ? raw : raw ? JSON.parse(String(raw)) : [];
    } catch { sources = []; }
    if (!sources.includes(input.source)) sources.push(input.source);
    await db.execute(
      `UPDATE he_lead SET
         full_name = COALESCE(full_name, ?), email = COALESCE(email, ?), age = COALESCE(age, ?),
         education_rank = COALESCE(education_rank, ?), experience_years = COALESCE(experience_years, ?),
         night_shift_ok = COALESCE(night_shift_ok, ?), pincode = COALESCE(pincode, ?), locality = COALESCE(locality, ?),
         ats_candidate_id = COALESCE(ats_candidate_id, ?), meta_lead_id = COALESCE(meta_lead_id, ?),
         sources_json = ?
       WHERE id = ?`,
      [input.fullName ?? null, input.email ?? null, input.age ?? null, input.educationRank ?? null, input.experienceYears ?? null,
        input.nightShiftOk == null ? null : input.nightShiftOk ? 1 : 0, input.pincode ?? null, input.locality ?? null,
        input.atsCandidateId ?? null, input.metaLeadId ?? null, JSON.stringify(sources), id],
    );
    return { id, created: false };
  }
  const [r] = await db.execute<ResultSetHeader>(
    `INSERT INTO he_lead (mobile10, full_name, email, age, education_rank, experience_years, night_shift_ok, pincode, locality,
                          primary_source, sources_json, ats_candidate_id, meta_lead_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE id = id`,
    [mobile10, input.fullName ?? null, input.email ?? null, input.age ?? null, input.educationRank ?? null, input.experienceYears ?? null,
      input.nightShiftOk == null ? null : input.nightShiftOk ? 1 : 0, input.pincode ?? null, input.locality ?? null,
      input.source, JSON.stringify([input.source]), input.atsCandidateId ?? null, input.metaLeadId ?? null],
  );
  const [row] = await db.execute<RowDataPacket[]>("SELECT id FROM he_lead WHERE mobile10 = ? LIMIT 1", [mobile10]);
  return { id: row[0].id as string, created: r.affectedRows === 1 };
}

export async function findLeadByMobile(mobile: string): Promise<HeLead | null> {
  const m = normalizeMobile10(mobile);
  if (!m) return null;
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id, mobile10, full_name, email, status, ats_candidate_id, meta_lead_id FROM he_lead WHERE mobile10 = ? LIMIT 1", [m]);
  return (rows[0] as HeLead | undefined) ?? null;
}

export async function addEvent(leadId: string, eventType: string, o: { driveId?: string | null; channel?: string | null; detail?: string | null; meta?: unknown; actor?: string | null } = {}): Promise<void> {
  await db.execute(
    "INSERT INTO he_lead_event (lead_id, drive_id, event_type, channel, detail, meta_json, actor) VALUES (?,?,?,?,?,?,?)",
    [leadId, o.driveId ?? null, eventType, o.channel ?? null, o.detail ? o.detail.slice(0, 500) : null,
      o.meta === undefined ? null : JSON.stringify(o.meta), o.actor ?? null],
  );
}

export async function persistSignals(leadId: string, signals: Signal[], sourceRef?: string | null): Promise<void> {
  for (const s of signals) {
    await db.execute(
      "INSERT INTO he_signal (lead_id, signal_key, signal_value, confidence, source, source_ref) VALUES (?,?,?,?,?,?)",
      [leadId, s.key, String(s.value).slice(0, 200), s.confidence, s.source, sourceRef ?? null],
    );
  }
}

export async function setLeadStatus(leadId: string, status: LeadStatus): Promise<void> {
  await db.execute("UPDATE he_lead SET status = ?, status_at = NOW() WHERE id = ?", [status, leadId]);
}

/** Active consent = granted and not revoked. */
export async function hasConsent(leadId: string, type: "whatsapp_contact" | "location"): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT 1 FROM he_consent WHERE lead_id = ? AND consent_type = ? AND revoked_at IS NULL LIMIT 1", [leadId, type]);
  return rows.length > 0;
}

export async function grantConsent(leadId: string, type: "whatsapp_contact" | "location", textVersion: string, source: string): Promise<void> {
  if (await hasConsent(leadId, type)) return;
  await db.execute("INSERT INTO he_consent (lead_id, consent_type, text_version, source) VALUES (?,?,?,?)", [leadId, type, textVersion, source]);
}

export async function revokeConsent(leadId: string, type: "whatsapp_contact" | "location"): Promise<void> {
  await db.execute("UPDATE he_consent SET revoked_at = NOW() WHERE lead_id = ? AND consent_type = ? AND revoked_at IS NULL", [leadId, type]);
}

const M10 = (col: string) => `RIGHT(REGEXP_REPLACE(${col}, '[^0-9]', ''), 10)`;

/**
 * Backfill the pool from ATS history and Meta leads. Idempotent (UNIQUE mobile10). dryRun only counts.
 * Meta leads get a whatsapp_contact consent row with source 'meta_form' ONLY when asked via
 * `grantMetaFormConsent` (the form's consent wording must be confirmed first).
 */
export async function backfillLeadPool(opts: { dryRun?: boolean; grantMetaFormConsent?: boolean } = {}): Promise<{ atsCandidates: number; metaLeads: number; consentGranted: number }> {
  const atsWhere = `${M10("mobile")} REGEXP '^[6-9][0-9]{9}$'`;
  const metaWhere = `${M10("parsed_phone")} REGEXP '^[6-9][0-9]{9}$'`;
  const [[a]] = (await db.execute<RowDataPacket[]>(`SELECT COUNT(DISTINCT ${M10("mobile")}) AS n FROM ats_candidate WHERE ${atsWhere}`)) as unknown as [RowDataPacket[]];
  const [[m]] = (await db.execute<RowDataPacket[]>(`SELECT COUNT(DISTINCT ${M10("parsed_phone")}) AS n FROM meta_lead_raw WHERE ${metaWhere}`)) as unknown as [RowDataPacket[]];
  const out = { atsCandidates: Number(a.n), metaLeads: Number(m.n), consentGranted: 0 };
  if (opts.dryRun) return out;

  await db.execute(
    `INSERT INTO he_lead (mobile10, full_name, email, primary_source, sources_json, ats_candidate_id)
     SELECT mob, name, email, 'ats_past', JSON_ARRAY('ats_past'), cid FROM (
       SELECT ${M10("mobile")} AS mob, MAX(full_name) AS name, MAX(email) AS email, MAX(id) AS cid
         FROM ats_candidate WHERE ${atsWhere} GROUP BY ${M10("mobile")}) t
     ON DUPLICATE KEY UPDATE ats_candidate_id = COALESCE(he_lead.ats_candidate_id, VALUES(ats_candidate_id)),
                             full_name = COALESCE(he_lead.full_name, VALUES(full_name))`);
  await db.execute(
    `INSERT INTO he_lead (mobile10, full_name, email, age, pincode, primary_source, sources_json, meta_lead_id)
     SELECT mob, name, email, age, NULL, 'meta', JSON_ARRAY('meta'), lid FROM (
       SELECT ${M10("parsed_phone")} AS mob, MAX(parsed_name) AS name, MAX(parsed_email) AS email, MAX(parsed_age) AS age, MAX(id) AS lid
         FROM meta_lead_raw WHERE ${metaWhere} GROUP BY ${M10("parsed_phone")}) t
     ON DUPLICATE KEY UPDATE meta_lead_id = COALESCE(he_lead.meta_lead_id, VALUES(meta_lead_id)),
                             age = COALESCE(he_lead.age, VALUES(age)),
                             email = COALESCE(he_lead.email, VALUES(email))`);
  if (opts.grantMetaFormConsent) {
    const [r] = await db.execute<ResultSetHeader>(
      `INSERT INTO he_consent (lead_id, consent_type, text_version, source)
       SELECT l.id, 'whatsapp_contact', 'meta_lead_form_v1', 'meta_form' FROM he_lead l
        WHERE l.meta_lead_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM he_consent c WHERE c.lead_id = l.id AND c.consent_type = 'whatsapp_contact')`);
    out.consentGranted = r.affectedRows;
  }
  return out;
}
