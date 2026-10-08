/**
 * Campaign-level shortlisting criteria — the fallback for META campaigns that have no job
 * requisition yet ("JR pending").
 *
 * The screener's criteria normally come from the linked requisition. A campaign without one had
 * nowhere to hold rules, so its leads either qualified unchecked or stayed pending. meta_campaign
 * .screening_config (migration 1835) holds the same JSON shape as job_requisition
 * .meta_screening_config, and is consulted ONLY while the campaign has no requisition.
 *
 * Every read here is best-effort: if the column does not exist yet (migration not applied) the
 * answer is "no fallback criteria", never an error — a lead webhook must not fail over this.
 */

import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import type { MetaScreeningConfig } from '../job-requisition/job-requisition.types.js';

export interface CampaignCriteria {
  formId: string;
  campaignName: string | null;
  requisitionId: string | null;
  screeningConfig: MetaScreeningConfig | null;
}

export function parseScreeningConfig(raw: unknown): MetaScreeningConfig | null {
  if (!raw) return null;
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return obj && typeof obj === 'object' ? (obj as MetaScreeningConfig) : null;
  } catch {
    return null;
  }
}

/** The fallback criteria for the campaign that owns this Lead Gen form, or null. */
export async function loadCampaignScreeningConfig(formId: string): Promise<MetaScreeningConfig | null> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT screening_config FROM meta_campaign WHERE meta_form_id = ? LIMIT 1',
      [formId]
    );
    return parseScreeningConfig(rows[0]?.screening_config);
  } catch {
    return null; // column not present yet
  }
}

/** Every campaign with its form id, name and (if the column exists) fallback criteria. */
export async function loadAllCampaignCriteria(): Promise<CampaignCriteria[]> {
  const map = (r: RowDataPacket, cfg: unknown): CampaignCriteria => ({
    formId: String(r.meta_form_id),
    campaignName: (r.campaign_name as string | null) ?? null,
    requisitionId: (r.requisition_id as string | null) || null,
    screeningConfig: parseScreeningConfig(cfg),
  });
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT meta_form_id, campaign_name, requisition_id, screening_config FROM meta_campaign WHERE meta_form_id IS NOT NULL'
    );
    return rows.map((r) => map(r, r.screening_config));
  } catch {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT meta_form_id, campaign_name, requisition_id FROM meta_campaign WHERE meta_form_id IS NOT NULL'
    );
    return rows.map((r) => map(r, null));
  }
}
