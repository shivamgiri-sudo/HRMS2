// Facts loader (plan 2026-10-09, S9): the raw records behind CandidateFacts, read in bounded chunks with keyset cursors and
// one statement per fact family (people, contact, journey/booked, DRA; eligibility through the engine's own loader).
// Reads only. Facts are person-level: requisition-specific blocks (selected/booked here, cooling in this process) are applied
// when a requisition is previewed (S10).
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { evaluateEligibility } from "../hiring-engine/he-eligibility.js";
import { loadEligibilityFacts, type LeadFactsRow } from "../hiring-engine/he-eligibility.service.js";
import { normalizeMobile10 } from "../hiring-engine/he-phone.js";
import { fillTypeSql } from "../hiring-engine/he-source-attribution.js";
import { loadLiveFrom } from "../hiring-engine/he-source-attribution.service.js";
import type { RawPerson } from "./facts-normalise.js";
import type { CandidateFacts, SourceKind, SubSource } from "./selection-types.js";

export const HE_RECORD_TYPES = ["candidate", "naukri_import", "workindia_import"] as const;
/** liveFrom: the Live Meta cutoff day (meta.live_from); read from he_model_param when not given. */
export interface LoadScope { sourceKind: SourceKind; subSources?: SubSource[]; afterKey?: string; limit: number; liveFrom?: string }
export interface Loaded { people: Array<{ person: RawPerson; sourceRef: string }>; nextKey: string | null; skippedInvalidMobile: number }

const ph = (n: number) => Array.from({ length: n }, () => "?").join(",");
/** DATETIME text in IST (the DB clock), like created_at. */
export const istText = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 19).replace("T", " ");

const LEAD_COLS = `l.id, l.mobile10, l.age, l.full_name, l.education_rank, l.experience_years, l.night_shift_ok, l.locality, l.lat, l.lng, l.email, l.updated_at, l.primary_source,
       l.ats_candidate_id, l.status, l.final_status, l.is_employee, l.walkin_count, l.last_attempt_date, l.last_outcome`;
const ATS_COLS = `ac.record_type, ac.sourcing_channel, ac.full_name AS ac_full_name, ac.source_details AS ac_source_details, ac.education AS ac_education, ac.date_of_birth AS ac_date_of_birth,
       ac.experience AS ac_experience, ac.email AS ac_email, ac.gender AS ac_gender, ac.current_address AS ac_current_address, ac.address AS ac_address,
       ac.permanent_address AS ac_permanent_address, ac.preferred_locations AS ac_preferred_locations, ac.hometown AS ac_hometown, ac.annual_salary AS ac_annual_salary,
       ac.notice_period AS ac_notice_period, ac.current_employer AS ac_current_employer, ac.last_active_naukri AS ac_last_active_naukri, ac.night_shift_ok AS ac_night_shift_ok,
       ac.night_shift_comfortable AS ac_night_shift_comfortable, ac.rotational_shift AS ac_rotational_shift, ac.rotational_shift_comfort AS ac_rotational_shift_comfort,
       ac.typing_speed AS ac_typing_speed, ac.role_applied AS ac_role_applied, ac.created_at AS ac_created_at, ac.updated_at AS ac_updated_at`;
const PROFILE_COLS = `lp.gender AS p_gender, lp.languages AS p_languages, lp.certifications AS p_certifications, lp.typing_wpm AS p_typing_wpm, lp.english_level AS p_english_level,
       lp.salary_expectation AS p_salary_expectation, lp.last_employer AS p_last_employer, lp.education_status AS p_education_status, lp.stream AS p_stream,
       lp.last_salary AS p_last_salary, lp.prev_industry AS p_prev_industry, lp.state AS p_state, lp.address AS p_address, lp.dob AS p_dob, lp.skills_text AS p_skills_text`;
const RT = HE_RECORD_TYPES.map((t) => `'${t}'`).join(",");

/** Pool people: he_lead + its ATS record (candidate / Naukri / WorkIndia only) + profile, keyset on he_lead.mobile10 (unique). */
export function heBaseSql(subSources?: SubSource[], byMobiles = 0): { sql: string; args: unknown[] } {
  const conds: string[] = [];
  const args: unknown[] = [];
  if (subSources?.length) {
    const rts = subSources.filter((s) => s === "naukri_import" || s === "workindia_import" || s === "candidate");
    if (rts.length) { conds.push(`(ac.record_type IN (${ph(rts.length)})${subSources.includes("candidate") ? " AND NOT (ac.record_type = 'candidate' AND ac.sourcing_channel LIKE 'walk%')" : ""})`); args.push(...rts); }
    if (subSources.includes("walk_in")) conds.push("(ac.record_type = 'candidate' AND ac.sourcing_channel LIKE 'walk%')");
    if (subSources.includes("pool_other") || subSources.includes("intake_upload")) conds.push("ac.id IS NULL");
  }
  return {
    sql: `SELECT ${LEAD_COLS},
       ${ATS_COLS},
       ${PROFILE_COLS}
  FROM he_lead l FORCE INDEX (uq_he_lead_mobile)
  LEFT JOIN ats_candidate ac ON ac.id = l.ats_candidate_id
  LEFT JOIN he_lead_profile lp ON lp.lead_id = l.id
 WHERE ${byMobiles ? `l.mobile10 IN (${ph(byMobiles)})` : "l.mobile10 > ?"} AND (ac.id IS NULL OR ac.record_type IN (${RT}))${conds.length ? ` AND (${conds.join(" OR ")})` : ""}
 ORDER BY l.mobile10 LIMIT ?`,
    args,
  };
}

/** Live vs Old Meta is the shared attribution rule (he-source-attribution fillTypeSql): the person's first Meta fill on or after the cutoff. */
export const META_BASE_SQL = (liveFrom: string) => `SELECT m.id, m.parsed_phone, m.raw_payload, m.parsed_education, m.parsed_location, m.parsed_experience_yr, m.created_at, m.requisition_id
  FROM meta_lead_raw m WHERE m.id > ? AND ${fillTypeSql("m", liveFrom)} = ? ORDER BY m.id LIMIT ?`;
export const LEADS_BY_MOBILE_SQL = (n: number) => `SELECT l.id, l.mobile10, l.ats_candidate_id, l.status, l.full_name, l.final_status, l.is_employee, l.walkin_count, l.last_attempt_date, l.last_outcome,
       l.age, l.education_rank, l.experience_years, l.night_shift_ok, l.locality, l.lat, l.lng, l.email, l.updated_at
  FROM he_lead l WHERE l.mobile10 IN (${ph(n)})`;
export const CONTACT_SQL = (n: number) => `SELECT mobile10, MAX(t) AS t FROM (
    SELECT mobile10, created_at AS t FROM he_message WHERE direction = 'out' AND mobile10 IN (${ph(n)})
    UNION ALL
    SELECT mobile10, COALESCE(email_sent_at, wa_sent_at) AS t FROM qualified_followup WHERE mobile10 IN (${ph(n)}) AND COALESCE(email_sent_at, wa_sent_at) IS NOT NULL
  ) x GROUP BY mobile10`;
export const JOURNEY_SQL = (n: number) => `SELECT 'journey' AS k, mobile10, requisition_id FROM qualified_followup WHERE mobile10 IN (${ph(n)}) AND stopped_at IS NULL
  UNION ALL
  SELECT 'booked' AS k, l.mobile10, m.requisition_id FROM he_match m JOIN he_lead l ON l.id = m.lead_id
   WHERE l.mobile10 IN (${ph(n)}) AND m.state IN ('invited','confirmed') AND m.slot_at >= ?`;
export const DRA_SQL = (n: number) => `SELECT candidate_id, status FROM candidate_dra_certificate WHERE is_current = 1 AND candidate_id IN (${ph(n)})`;

const pick = (r: Record<string, unknown>, prefix: string) =>
  Object.fromEntries(Object.entries(r).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));

function heSubSource(r: Record<string, unknown>): SubSource {
  if (!r.record_type) return "pool_other";
  if (r.record_type === "naukri_import" || r.record_type === "workindia_import") return r.record_type;
  return /^walk/i.test(String(r.sourcing_channel ?? "")) ? "walk_in" : "candidate";
}

/** Person-level system facts: requisition-agnostic eligibility, ex-employee, rejected anywhere, other journey, booked. */
async function systemFacts(leads: Array<Record<string, unknown>>, mobiles: string[], now: Date) {
  const elig = leads.length ? await loadEligibilityFacts(leads as unknown as LeadFactsRow[], { id: "-", processName: null }, now) : new Map();
  const journey = new Map<string, string>(), booked = new Map<string, string>(), contact = new Map<string, string>();
  if (mobiles.length) {
    const [j] = await db.execute<RowDataPacket[]>(JOURNEY_SQL(mobiles.length), [...mobiles, ...mobiles, istText(now)]);
    for (const r of j) (r.k === "booked" ? booked : journey).set(String(r.mobile10), String(r.requisition_id));
    const [c] = await db.execute<RowDataPacket[]>(CONTACT_SQL(mobiles.length), [...mobiles, ...mobiles]);
    for (const r of c) if (r.t) contact.set(String(r.mobile10), String(r.t));
  }
  const atsIds = leads.map((l) => l.ats_candidate_id).filter(Boolean) as string[];
  const dra = new Map<string, string>();
  if (atsIds.length) {
    const [d] = await db.execute<RowDataPacket[]>(DRA_SQL(atsIds.length), atsIds);
    for (const r of d) dra.set(String(r.candidate_id), String(r.status));
  }
  const byLead = new Map<string, CandidateFacts["system"]>();
  for (const l of leads) {
    const f = elig.get(String(l.id));
    const e = f ? evaluateEligibility(f) : { eligible: true, blocks: [], priority: 1 };
    const m = String(l.mobile10);
    byLead.set(String(l.id), {
      eligibility: { ok: e.eligible, blocks: e.blocks, priority: e.priority },
      inOtherJourney: journey.get(m) ?? null, bookedFor: booked.get(m) ?? null,
      exEmployee: f?.exEmployee ? (f.exEmployee.cleanVoluntary ? "clean" : "not_clean") : null, rejectedOtherProcess: (f?.rejections.length ?? 0) > 0,
    });
  }
  const sysFor = (lead: Record<string, unknown> | null, mobile: string): CandidateFacts["system"] => (lead ? byLead.get(String(lead.id))! : {
    eligibility: { ok: true, blocks: [], priority: 1 }, inOtherJourney: journey.get(mobile) ?? null, bookedFor: booked.get(mobile) ?? null, exEmployee: null, rejectedOtherProcess: false,
  });
  return { sysFor, contact, dra };
}

/** Pool people by mobile (why-not lookup, re-evaluation after a criteria change); same families as a chunk. */
export async function loadHePeopleByMobiles(mobiles: string[], now: Date): Promise<Loaded["people"]> {
  if (!mobiles.length) return [];
  const q = heBaseSql(undefined, mobiles.length);
  const [rows] = await db.execute<RowDataPacket[]>(q.sql, [...mobiles, mobiles.length]);
  return heRowsToPeople(rows, now);
}

async function heRowsToPeople(rows: RowDataPacket[], now: Date): Promise<Loaded["people"]> {
  const { sysFor, contact, dra } = await systemFacts(rows, rows.map((r) => String(r.mobile10)), now);
  return rows.map((r) => {
    const ats = r.record_type ? { record_type: r.record_type, sourcing_channel: r.sourcing_channel, source_details: r.ac_source_details, ...pick(r, "ac_") } : null;
    const lead = Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("ac_") && !k.startsWith("p_") && k !== "record_type" && k !== "sourcing_channel"));
    const profile = Object.values(pick(r, "p_")).some((v) => v !== null && v !== undefined) ? pick(r, "p_") : null;
    const draStatus = r.ats_candidate_id ? dra.get(String(r.ats_candidate_id)) : undefined;
    const person: RawPerson = { sourceKind: "he", subSource: heSubSource(r), mobile: String(r.mobile10), ats, lead, profile, meta: null,
      dra: draStatus ? { status: draStatus } : null, system: sysFor(r, String(r.mobile10)), contact: { lastFirstContactAt: contact.get(String(r.mobile10)) ?? null } };
    return { person, sourceRef: String(r.id) };
  });
}

export async function loadRawPeople(scope: LoadScope, now: Date): Promise<Loaded> {
  const limit = Math.max(1, Math.min(scope.limit, 5000));
  if (scope.sourceKind === "he") {
    const q = heBaseSql(scope.subSources);
    const [rows] = await db.execute<RowDataPacket[]>(q.sql, [scope.afterKey ?? "", ...q.args, limit]);
    const people = await heRowsToPeople(rows, now);
    return { people, nextKey: rows.length === limit ? String(rows[rows.length - 1].mobile10) : null, skippedInvalidMobile: 0 };
  }
  const live = scope.sourceKind === "meta_live";
  const liveFrom = scope.liveFrom ?? await loadLiveFrom();
  const [rows] = await db.execute<RowDataPacket[]>(META_BASE_SQL(liveFrom), [scope.afterKey ?? "", scope.sourceKind, limit]);
  const valid = rows.map((r) => ({ r, m: normalizeMobile10(r.parsed_phone) })).filter((x): x is { r: RowDataPacket; m: string } => !!x.m);
  const mobiles = [...new Set(valid.map((x) => x.m))];
  const [leads] = mobiles.length ? await db.execute<RowDataPacket[]>(LEADS_BY_MOBILE_SQL(mobiles.length), mobiles) : [[] as RowDataPacket[]];
  const leadByMobile = new Map(leads.map((l) => [String(l.mobile10), l]));
  const { sysFor, contact, dra } = await systemFacts(leads, mobiles, now);
  const people = valid.map(({ r, m }) => {
    const lead = leadByMobile.get(m) ?? null;
    const draStatus = lead?.ats_candidate_id ? dra.get(String(lead.ats_candidate_id)) : undefined;
    const person: RawPerson = { sourceKind: scope.sourceKind, subSource: live ? "meta_live" : "meta_old", mobile: m, ats: null, lead, profile: null,
      meta: { rawPayload: r.raw_payload, parsedEducation: r.parsed_education ?? null, parsedLocation: r.parsed_location ?? null,
        parsedExperienceYr: r.parsed_experience_yr == null ? null : Number(r.parsed_experience_yr), createdAt: String(r.created_at) },
      dra: draStatus ? { status: draStatus } : null, system: sysFor(lead, m), contact: { lastFirstContactAt: contact.get(m) ?? null } };
    return { person, sourceRef: String(r.id) };
  });
  return { people, nextKey: rows.length === limit ? String(rows[rows.length - 1].id) : null, skippedInvalidMobile: rows.length - valid.length };
}
