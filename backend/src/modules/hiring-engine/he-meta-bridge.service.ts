/**
 * Meta lead form fill -> Hiring Engine pool. A QUALIFIED Meta lead gets one he_lead row (mobile = person) and every form fill is recorded in
 * he_lead_campaign, so a person who filled several forms keeps all of them. Used by the live intake (one lead), by the sweep that enrols the
 * campaigns the Hiring Engine owns, and by the campaign launcher (a whole campaign, optionally only fills newer than N days).
 * Never grants consent: the owner's WhatsApp policy (he-policy.service) decides who may be messaged.
 */
import type { ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { eduRankSql } from "./he-lead.service.js";
import { heOwnedCampaignIds } from "./he-campaign-config.service.js";

const M10 = (col: string) => `RIGHT(REGEXP_REPLACE(${col}, '[^0-9]', ''), 10)`;
const VALID = `${M10("r.parsed_phone")} REGEXP '^[6-9][0-9]{9}$'`;

export interface BridgeScope { metaLeadId?: string; campaignIds?: string[]; maxAgeDays?: number | null; onlyUnlinked?: boolean; all?: boolean }
export interface BridgeResult { poolRows: number; linked: number }

function where(s: BridgeScope): { sql: string; args: unknown[] } {
  const parts = [`r.screening_result = 'qualified'`, VALID];
  const args: unknown[] = [];
  if (s.metaLeadId) { parts.push("r.id = ?"); args.push(s.metaLeadId); }
  if (s.campaignIds?.length) { parts.push(`r.campaign_id IN (${s.campaignIds.map(() => "?").join(",")})`); args.push(...s.campaignIds); }
  if (s.maxAgeDays && s.maxAgeDays > 0) { parts.push("r.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)"); args.push(Math.floor(s.maxAgeDays)); }
  if (s.onlyUnlinked) parts.push("NOT EXISTS (SELECT 1 FROM he_lead_campaign x WHERE x.meta_lead_id = r.id)");
  return { sql: parts.join(" AND "), args };
}

/** Idempotent. Existing pool rows are only enriched (COALESCE), never overwritten. */
export async function bridgeMetaLeads(s: BridgeScope): Promise<BridgeResult> {
  if (!s.metaLeadId && !s.campaignIds?.length && !s.all) throw new Error("bridgeMetaLeads needs a lead or campaigns");
  const w = where(s);
  const [a] = await db.execute<ResultSetHeader>(
    `INSERT INTO he_lead (mobile10, full_name, email, age, education_rank, experience_years, primary_source, sources_json, meta_lead_id)
     SELECT mob, name, email, age, edu, exp_y, 'meta', JSON_ARRAY('meta'), lid FROM (
       SELECT ${M10("r.parsed_phone")} AS mob, MAX(r.parsed_name) AS name, MAX(r.parsed_email) AS email, MAX(r.parsed_age) AS age, MAX(r.id) AS lid,
              MAX(${eduRankSql("r.parsed_education")}) AS edu, MAX(r.parsed_experience_yr) AS exp_y
         FROM meta_lead_raw r WHERE ${w.sql} GROUP BY ${M10("r.parsed_phone")}) t
     ON DUPLICATE KEY UPDATE meta_lead_id = COALESCE(he_lead.meta_lead_id, VALUES(meta_lead_id)),
                             full_name = COALESCE(he_lead.full_name, VALUES(full_name)),
                             age = COALESCE(he_lead.age, VALUES(age)), email = COALESCE(he_lead.email, VALUES(email)),
                             education_rank = COALESCE(he_lead.education_rank, VALUES(education_rank)),
                             experience_years = COALESCE(he_lead.experience_years, VALUES(experience_years))`, w.args);
  const [b] = await db.execute<ResultSetHeader>(
    `INSERT IGNORE INTO he_lead_campaign (meta_lead_id, lead_id, campaign_id, requisition_id, form_filled_at)
     SELECT r.id, l.id, r.campaign_id, r.requisition_id, r.created_at FROM meta_lead_raw r
       JOIN he_lead l ON l.mobile10 = (${M10("r.parsed_phone")}) COLLATE utf8mb4_unicode_ci WHERE ${w.sql}`, w.args);
  return { poolRows: a.affectedRows, linked: b.affectedRows };
}

/** Every qualified Meta lead in every campaign (used before a Meta-only plan or when linking history). Idempotent. */
export const bridgeAllMetaLeads = (maxAgeDays?: number | null) => bridgeMetaLeads({ all: true, maxAgeDays: maxAgeDays ?? null });

/** Live intake hook: never throws (a failed bridge must not fail the lead intake; the sweep catches it up). */
export async function bridgeOneMetaLead(metaLeadId: string): Promise<void> {
  try { await bridgeMetaLeads({ metaLeadId }); }
  catch (err) { logger.warn({ metaLeadId, err: (err as Error).message }, "[he-bridge] could not bridge the Meta lead (the sweep will retry)"); }
}

/** Sweep for the campaigns the Hiring Engine owns: any qualified lead not yet linked is enrolled. Cheap when nothing is new. */
export async function sweepOwnedCampaigns(): Promise<BridgeResult> {
  const ids = await heOwnedCampaignIds();
  if (!ids.length) return { poolRows: 0, linked: 0 };
  return bridgeMetaLeads({ campaignIds: ids, onlyUnlinked: true });
}
