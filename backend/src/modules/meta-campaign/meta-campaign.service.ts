/**
 * META Campaign Automation — service layer.
 *
 * Owns four concerns: campaign CRUD, webhook lead ingestion, the campaign funnel read model, and
 * the nightly insights sync.
 *
 * The ingestion path is the delicate one, and it is built around one fact about META's webhook:
 * delivery is at-least-once and the payload contains no candidate data. So the flow is
 *
 *   log raw body  ->  ack 200 immediately  ->  process asynchronously
 *
 * ACKing before processing is deliberate. META retries any non-2xx, and a slow Graph API call or a
 * DB hiccup would otherwise turn one form fill into a retry storm of duplicate work. The raw body
 * is durably logged first, so nothing is lost by ACKing early: meta_webhook_log.processed stays 0
 * and the row is recoverable.
 *
 * Duplicate suppression then lives on meta_lead_raw.meta_lead_id (UNIQUE). Re-processing the same
 * leadgen_id is a no-op rather than a second candidate.
 */

import { randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { fetchLeadDetail, fetchCampaignInsights, isMetaConfigured, MetaApiError } from './meta-api.client.js';
import { parseLead, normaliseMetaId } from './meta-lead.parser.js';
import { screenLead } from './lead-screener.service.js';
import { notifyQualifiedLead } from './lead-outreach.service.js';
import { buildCanonicalFunnel, canonicalStage, CANONICAL_STAGE_LABEL, CANONICAL_STAGE_ORDER } from '../ats/ats-stage-model.js';
import type {
  MetaCampaign,
  MetaCampaignRow,
  MetaLead,
  MetaLeadRow,
  MetaWebhookLeadPayload,
  MetaCampaignFunnel,
  MetaFunnelStage,
  CreateMetaCampaignInput,
  UpdateMetaCampaignInput,
  MetaCampaignStatus,
} from './meta-campaign.types.js';

// ──────────────────────────── mappers ────────────────────────────

const iso = (v: Date | string | null | undefined): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function toCampaign(row: RowDataPacket | MetaCampaignRow): MetaCampaign {
  const r = row as MetaCampaignRow & Record<string, unknown>;
  return {
    id: r.id,
    requisitionId: r.requisition_id,
    requisitionCode: (r.requisition_code as string | null) ?? null,
    designationName: (r.designation_name as string | null) ?? null,
    branchName: (r.branch_name as string | null) ?? null,
    metaCampaignId: r.meta_campaign_id,
    metaAdsetId: r.meta_adset_id,
    metaAdId: r.meta_ad_id,
    metaFormId: r.meta_form_id,
    campaignName: r.campaign_name,
    campaignStatus: r.campaign_status,
    impressions: Number(r.impressions ?? 0),
    reach: Number(r.reach ?? 0),
    clicks: Number(r.clicks ?? 0),
    leadsCount: Number(r.leads_count ?? 0),
    spendInr: Number(r.spend_inr ?? 0),
    lastSyncedAt: iso(r.last_synced_at),
    lastSyncError: r.last_sync_error,
    notes: r.notes,
    createdBy: r.created_by,
    createdAt: iso(r.created_at) ?? '',
    updatedAt: iso(r.updated_at) ?? '',
  };
}

/** mysql2 returns a JSON column as a parsed value on some driver versions and a string on others. */
function jsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toLead(row: RowDataPacket | MetaLeadRow): MetaLead {
  const r = row as MetaLeadRow;
  return {
    id: r.id,
    metaFormId: r.meta_form_id,
    metaLeadId: r.meta_lead_id,
    campaignId: r.campaign_id,
    requisitionId: r.requisition_id,
    parsedName: r.parsed_name,
    parsedPhone: r.parsed_phone,
    parsedEmail: r.parsed_email,
    parsedAge: r.parsed_age === null ? null : Number(r.parsed_age),
    parsedLocation: r.parsed_location,
    parsedEducation: r.parsed_education,
    parsedExperienceYr: r.parsed_experience_yr === null ? null : Number(r.parsed_experience_yr),
    screeningResult: r.screening_result,
    disqualificationReason: r.disqualification_reason,
    atsCandidateId: r.ats_candidate_id,
    notificationSentAt: iso(r.notification_sent_at),
    notificationChannels: jsonArray(r.notification_channels),
    voiceCallStatus: r.voice_call_status,
    voiceCallOutcome: r.voice_call_outcome,
    voiceCalledAt: iso(r.voice_called_at),
    createdAt: iso(r.created_at) ?? '',
  };
}

const CAMPAIGN_SELECT = `
  SELECT mc.*, jr.requisition_code, jr.designation_name, jr.branch_name
    FROM meta_campaign mc
    LEFT JOIN job_requisition jr ON jr.id = mc.requisition_id`;

// ──────────────────────────── service ────────────────────────────

export const metaCampaignService = {
  async listCampaigns(filters: {
    requisitionId?: string;
    status?: MetaCampaignStatus;
    search?: string;
  } = {}): Promise<MetaCampaign[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.requisitionId) {
      conds.push('mc.requisition_id = ?');
      params.push(filters.requisitionId);
    }
    if (filters.status) {
      conds.push('mc.campaign_status = ?');
      params.push(filters.status);
    }
    if (filters.search) {
      conds.push('(mc.campaign_name LIKE ? OR jr.requisition_code LIKE ? OR jr.designation_name LIKE ?)');
      const like = `%${filters.search}%`;
      params.push(like, like, like);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const [rows] = await db.execute<RowDataPacket[]>(
      `${CAMPAIGN_SELECT} ${where} ORDER BY mc.created_at DESC LIMIT 500`,
      params
    );
    return rows.map(toCampaign);
  },

  async getCampaign(id: string): Promise<MetaCampaign | null> {
    const [rows] = await db.execute<RowDataPacket[]>(`${CAMPAIGN_SELECT} WHERE mc.id = ? LIMIT 1`, [id]);
    return rows[0] ? toCampaign(rows[0]) : null;
  },

  /**
   * Normalise the META ids on an inbound create/update payload.
   *
   * An operator copying from the lead export pastes `f:27936517096019427`; one copying from Ads
   * Manager pastes the bare number. Both must produce the same stored value, or the UNIQUE index on
   * meta_form_id fails to catch a genuine duplicate and webhook routing misses.
   */
  normaliseCampaignIds<T extends { metaFormId?: string | null; metaCampaignId?: string | null; metaAdsetId?: string | null; metaAdId?: string | null }>(
    input: T
  ): T {
    const out = { ...input };
    if (out.metaFormId !== undefined) out.metaFormId = normaliseMetaId(out.metaFormId);
    if (out.metaCampaignId !== undefined) out.metaCampaignId = normaliseMetaId(out.metaCampaignId);
    if (out.metaAdsetId !== undefined) out.metaAdsetId = normaliseMetaId(out.metaAdsetId);
    if (out.metaAdId !== undefined) out.metaAdId = normaliseMetaId(out.metaAdId);
    return out;
  },

  async createCampaign(rawInput: CreateMetaCampaignInput, userId: string | null): Promise<MetaCampaign> {
    const input = this.normaliseCampaignIds(rawInput);
    const [req] = await db.execute<RowDataPacket[]>(
      'SELECT id FROM job_requisition WHERE id = ? LIMIT 1',
      [input.requisitionId]
    );
    if (!req[0]) {
      throw Object.assign(new Error('Requisition not found'), { statusCode: 404 });
    }

    // meta_form_id is UNIQUE, and a collision here is an operator pasting a form ID that is
    // already routed elsewhere. Caught explicitly so the API can say which requisition owns it,
    // rather than surfacing a raw ER_DUP_ENTRY.
    if (input.metaFormId) {
      const [clash] = await db.execute<RowDataPacket[]>(
        `SELECT mc.id, jr.requisition_code FROM meta_campaign mc
         LEFT JOIN job_requisition jr ON jr.id = mc.requisition_id
         WHERE mc.meta_form_id = ? LIMIT 1`,
        [input.metaFormId]
      );
      if (clash[0]) {
        throw Object.assign(
          new Error(
            `Lead Gen Form ID ${input.metaFormId} is already linked to requisition ${clash[0].requisition_code ?? clash[0].id}. One form can only feed one requisition.`
          ),
          { statusCode: 409 }
        );
      }
    }

    const id = randomUUID();
    await db.execute(
      `INSERT INTO meta_campaign
         (id, requisition_id, meta_campaign_id, meta_adset_id, meta_ad_id, meta_form_id,
          campaign_name, campaign_status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.requisitionId,
        input.metaCampaignId ?? null,
        input.metaAdsetId ?? null,
        input.metaAdId ?? null,
        input.metaFormId ?? null,
        input.campaignName,
        input.campaignStatus ?? 'draft',
        input.notes ?? null,
        userId,
      ]
    );
    const created = await this.getCampaign(id);
    if (!created) throw new Error('Campaign insert did not persist');
    return created;
  },

  async updateCampaign(id: string, rawInput: UpdateMetaCampaignInput): Promise<MetaCampaign> {
    const input = this.normaliseCampaignIds(rawInput);
    const existing = await this.getCampaign(id);
    if (!existing) throw Object.assign(new Error('Campaign not found'), { statusCode: 404 });

    if (input.metaFormId && input.metaFormId !== existing.metaFormId) {
      const [clash] = await db.execute<RowDataPacket[]>(
        'SELECT id FROM meta_campaign WHERE meta_form_id = ? AND id <> ? LIMIT 1',
        [input.metaFormId, id]
      );
      if (clash[0]) {
        throw Object.assign(
          new Error(`Lead Gen Form ID ${input.metaFormId} is already linked to another campaign.`),
          { statusCode: 409 }
        );
      }
    }

    const map: Array<[keyof UpdateMetaCampaignInput, string]> = [
      ['campaignName', 'campaign_name'],
      ['metaCampaignId', 'meta_campaign_id'],
      ['metaAdsetId', 'meta_adset_id'],
      ['metaAdId', 'meta_ad_id'],
      ['metaFormId', 'meta_form_id'],
      ['campaignStatus', 'campaign_status'],
      ['notes', 'notes'],
    ];
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, column] of map) {
      if (input[key] !== undefined) {
        sets.push(`${column} = ?`);
        params.push(input[key] ?? null);
      }
    }
    if (sets.length) {
      params.push(id);
      await db.execute(`UPDATE meta_campaign SET ${sets.join(', ')} WHERE id = ?`, params);
    }
    const updated = await this.getCampaign(id);
    if (!updated) throw new Error('Campaign vanished during update');
    return updated;
  },

  async listLeads(filters: { campaignId?: string; requisitionId?: string; screening?: string } = {}): Promise<MetaLead[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.campaignId) {
      conds.push('campaign_id = ?');
      params.push(filters.campaignId);
    }
    if (filters.requisitionId) {
      conds.push('requisition_id = ?');
      params.push(filters.requisitionId);
    }
    if (filters.screening) {
      conds.push('screening_result = ?');
      params.push(filters.screening);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM meta_lead_raw ${where} ORDER BY created_at DESC LIMIT 500`,
      params
    );
    return rows.map(toLead);
  },

  // ─────────────────────── webhook ingestion ───────────────────────

  /**
   * Durably record the raw webhook body. Called BEFORE any parsing, so a payload shape we do not
   * yet handle is still recoverable rather than dropped.
   */
  async logWebhook(eventType: string, payload: unknown): Promise<string> {
    const id = randomUUID();
    let serialised: string;
    try {
      serialised = typeof payload === 'string' ? payload : JSON.stringify(payload);
    } catch {
      serialised = String(payload);
    }
    await db.execute(
      'INSERT INTO meta_webhook_log (id, event_type, payload) VALUES (?, ?, ?)',
      [id, eventType, serialised.slice(0, 16_000_000)]
    );
    return id;
  },

  async markWebhookProcessed(logId: string, error?: string): Promise<void> {
    await db.execute('UPDATE meta_webhook_log SET processed = ?, error_msg = ? WHERE id = ?', [
      error ? 0 : 1,
      error ?? null,
      logId,
    ]);
  },

  /**
   * Walk a `leadgen` webhook body and process each change entry.
   *
   * Errors are collected per entry rather than thrown: one unparseable change must not abandon
   * the others in the same batch (META can bundle several).
   */
  async processWebhookPayload(payload: MetaWebhookLeadPayload, logId: string): Promise<{ processed: number; errors: string[] }> {
    const errors: string[] = [];
    let processed = 0;

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'leadgen') continue;
        try {
          await this.ingestLead({
            formId: change.value.form_id,
            leadgenId: change.value.leadgen_id,
            adId: change.value.ad_id ?? null,
            adgroupId: change.value.adgroup_id ?? null,
            campaignIdFromMeta: change.value.campaign_id ?? null,
          });
          processed += 1;
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
      }
    }

    await this.markWebhookProcessed(logId, errors.length ? errors.join(' | ') : undefined);
    return { processed, errors };
  },

  /**
   * Ingest one lead: dedup, fetch, parse, screen, persist, then (if qualified) create the ATS
   * candidate and fire outreach.
   */
  async ingestLead(args: {
    formId: string;
    leadgenId: string;
    adId?: string | null;
    adgroupId?: string | null;
    campaignIdFromMeta?: string | null;
  }): Promise<MetaLead | null> {
    // Normalise both ids before anything else. The live lead export prefixes them by type
    // (`f:27936517096019427`, `l:1735112467564611`) while the Graph webhook sends them bare, and a
    // lead whose form_id does not match what an operator stored simply lands unrouted — visible as
    // an unlinked form rather than as a bug. See normaliseMetaId.
    const formId = normaliseMetaId(args.formId) ?? args.formId;
    const leadgenId = normaliseMetaId(args.leadgenId) ?? args.leadgenId;

    // Dedup first: META redelivers, and the cheapest correct response to a redelivery is nothing.
    const [dupe] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM meta_lead_raw WHERE meta_lead_id = ? LIMIT 1',
      [leadgenId]
    );
    if (dupe[0]) return toLead(dupe[0]);

    // Route the form back to a campaign/requisition. An unlinked form is stored anyway — losing
    // the lead because an operator has not filled in the Form ID yet would be the worse failure.
    const [campaignRows] = await db.execute<RowDataPacket[]>(
      `SELECT mc.id, mc.requisition_id,
              jr.meta_target_age_min, jr.meta_target_age_max,
              jr.education_requirement, jr.experience_min_years, jr.experience_max_years,
              jr.designation_name, jr.branch_name, jr.process_name
         FROM meta_campaign mc
         LEFT JOIN job_requisition jr ON jr.id = mc.requisition_id
        WHERE mc.meta_form_id = ? LIMIT 1`,
      [formId]
    );
    const campaign = campaignRows[0] ?? null;

    let detail;
    try {
      detail = await fetchLeadDetail(leadgenId);
    } catch (err) {
      // Store a stub so the lead is not lost, and so a token fix can be followed by a re-parse.
      const stubId = randomUUID();
      await db.execute(
        `INSERT IGNORE INTO meta_lead_raw
           (id, meta_form_id, meta_lead_id, campaign_id, requisition_id, raw_payload,
            screening_result, disqualification_reason)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [
          stubId,
          formId,
          leadgenId,
          campaign?.id ?? null,
          campaign?.requisition_id ?? null,
          JSON.stringify({ error: 'graph_fetch_failed', args }),
          err instanceof MetaApiError ? err.message : String(err),
        ]
      );
      throw err;
    }

    const parsed = parseLead(detail);
    const screening = campaign
      ? screenLead(
          {
            parsedAge: parsed.age,
            parsedEducation: parsed.education,
            parsedExperienceYr: parsed.experienceYears,
          },
          {
            metaTargetAgeMin: campaign.meta_target_age_min === null ? null : Number(campaign.meta_target_age_min),
            metaTargetAgeMax: campaign.meta_target_age_max === null ? null : Number(campaign.meta_target_age_max),
            educationRequirement: (campaign.education_requirement as string | null) ?? null,
            experienceMinYears:
              campaign.experience_min_years === null ? null : Number(campaign.experience_min_years),
            experienceMaxYears:
              campaign.experience_max_years === null ? null : Number(campaign.experience_max_years),
          }
        )
      : // No linked requisition means no criteria to screen against. 'pending' is the honest
        // state — neither qualified nor disqualified — and it keeps the lead visible for a
        // recruiter to action manually.
        null;

    const id = randomUUID();
    await db.execute(
      `INSERT INTO meta_lead_raw
         (id, meta_form_id, meta_lead_id, campaign_id, requisition_id, raw_payload,
          parsed_name, parsed_phone, parsed_email, parsed_age, parsed_location,
          parsed_education, parsed_experience_yr, screening_result, disqualification_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        formId,
        leadgenId,
        campaign?.id ?? null,
        campaign?.requisition_id ?? null,
        JSON.stringify(detail),
        parsed.name,
        parsed.phone,
        parsed.email,
        parsed.age,
        parsed.location,
        parsed.education,
        parsed.experienceYears,
        screening === null ? 'pending' : screening.qualified ? 'qualified' : 'disqualified',
        screening?.reason ?? null,
      ]
    );

    if (campaign?.id) {
      await db.execute('UPDATE meta_campaign SET leads_count = leads_count + 1 WHERE id = ?', [campaign.id]);
    }

    if (screening?.qualified) {
      await this.createCandidateFromLead(id).catch((e: unknown) =>
        console.warn('[meta] createCandidateFromLead failed', e instanceof Error ? e.message : e)
      );
      await notifyQualifiedLead(id).catch((e: unknown) =>
        console.warn('[meta] notifyQualifiedLead failed', e instanceof Error ? e.message : e)
      );
    }

    const [rows] = await db.execute<RowDataPacket[]>('SELECT * FROM meta_lead_raw WHERE id = ? LIMIT 1', [id]);
    return rows[0] ? toLead(rows[0]) : null;
  },

  /**
   * Create (or adopt) an ats_candidate row for a qualified lead.
   *
   * Adopting an existing candidate on a phone match rather than inserting a second row is the
   * important behaviour here. ats_candidate has no UNIQUE on mobile, and META lead ads reliably
   * surface people who already applied through a walk-in or referral; inserting blind would
   * fragment one person's history across rows and inflate every funnel that counts candidates.
   */
  async createCandidateFromLead(leadId: string): Promise<string | null> {
    const [leadRows] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM meta_lead_raw WHERE id = ? LIMIT 1',
      [leadId]
    );
    const lead = leadRows[0];
    if (!lead) return null;
    if (lead.ats_candidate_id) return lead.ats_candidate_id as string;
    if (!lead.parsed_phone || !lead.parsed_name) {
      // Without a name and a contact number there is nothing an ATS row could usefully hold;
      // ats_candidate.mobile and full_name are both NOT NULL.
      return null;
    }

    const [existing] = await db.execute<RowDataPacket[]>(
      'SELECT id FROM ats_candidate WHERE mobile = ? ORDER BY created_at DESC LIMIT 1',
      [lead.parsed_phone]
    );
    if (existing[0]) {
      await db.execute('UPDATE meta_lead_raw SET ats_candidate_id = ? WHERE id = ?', [existing[0].id, leadId]);
      return existing[0].id as string;
    }

    let requisition: RowDataPacket | undefined;
    if (lead.requisition_id) {
      const [reqRows] = await db.execute<RowDataPacket[]>(
        'SELECT designation_name, branch_name, process_name FROM job_requisition WHERE id = ? LIMIT 1',
        [lead.requisition_id]
      );
      requisition = reqRows[0];
    }

    const candidateId = randomUUID();
    const candidateCode = `CND-${Date.now().toString(36).toUpperCase()}`;
    const remarks = [
      'Auto-created from META Lead Gen campaign.',
      lead.parsed_location ? `Location: ${lead.parsed_location}` : null,
      lead.parsed_age ? `Age: ${lead.parsed_age}` : null,
      lead.parsed_experience_yr !== null ? `Experience: ${lead.parsed_experience_yr} yrs` : null,
      `META lead ID: ${lead.meta_lead_id}`,
    ]
      .filter(Boolean)
      .join(' | ');

    // sourcing_channel uses the existing canonical value "Social Media" rather than a new
    // "META" string, so these candidates aggregate into the channel reporting that already
    // exists (see normalizeSourceChannel in ats.service.ts). The META-specific provenance is
    // preserved in remarks and, authoritatively, in meta_lead_raw.
    await db.execute(
      `INSERT INTO ats_candidate
         (id, candidate_code, full_name, mobile, email, current_stage,
          applied_for_process, applied_for_branch, sourcing_channel, remarks,
          requisition_id, education, experience)
       VALUES (?, ?, ?, ?, ?, 'Applied', ?, ?, 'Social Media', ?, ?, ?, ?)`,
      [
        candidateId,
        candidateCode,
        String(lead.parsed_name).toUpperCase(),
        lead.parsed_phone,
        lead.parsed_email ?? null,
        (requisition?.process_name as string | null) ?? null,
        (requisition?.branch_name as string | null) ?? null,
        remarks,
        lead.requisition_id ?? null,
        lead.parsed_education ?? null,
        lead.parsed_experience_yr === null ? null : String(lead.parsed_experience_yr),
      ]
    );

    await db.execute('UPDATE meta_lead_raw SET ats_candidate_id = ? WHERE id = ?', [candidateId, leadId]);
    return candidateId;
  },

  // ─────────────────────── funnel read model ───────────────────────

  /**
   * Funnel for one campaign: META-side counters, then the ATS stages of the candidates it produced.
   *
   * ATS depth is computed through ats-stage-model.ts rather than by matching stage strings here.
   * That module exists precisely because `ats_candidate.current_stage` holds three rival
   * vocabularies at once ("Arrival" vs "Arrived", machine states like `converted` leaking in), and
   * its `reached` semantics are cumulative-from-the-deepest-stage — so each row below is a real
   * survival count, not a disjoint GROUP BY bucket being wrongly divided by the next.
   */
  async getCampaignFunnel(campaignId: string): Promise<MetaCampaignFunnel | null> {
    const [rows] = await db.execute<RowDataPacket[]>(`${CAMPAIGN_SELECT} WHERE mc.id = ? LIMIT 1`, [campaignId]);
    const campaign = rows[0];
    if (!campaign) return null;

    const [leadAgg] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*)                                                              AS form_fills,
         SUM(CASE WHEN screening_result = 'qualified' THEN 1 ELSE 0 END)       AS qualified,
         SUM(CASE WHEN screening_result = 'disqualified' THEN 1 ELSE 0 END)    AS disqualified,
         SUM(CASE WHEN notification_sent_at IS NOT NULL THEN 1 ELSE 0 END)     AS notified,
         SUM(CASE WHEN ats_candidate_id IS NOT NULL THEN 1 ELSE 0 END)         AS candidates
       FROM meta_lead_raw WHERE campaign_id = ?`,
      [campaignId]
    );
    const agg = leadAgg[0] ?? {};

    const [stageRows] = await db.execute<RowDataPacket[]>(
      `SELECT c.current_stage AS stage, COUNT(*) AS count
         FROM meta_lead_raw ml
         JOIN ats_candidate c ON c.id = ml.ats_candidate_id
        WHERE ml.campaign_id = ?
        GROUP BY c.current_stage`,
      [campaignId]
    );
    const atsFunnel = buildCanonicalFunnel(
      stageRows.map((r) => ({ stage: String(r.stage ?? ''), count: Number(r.count ?? 0) }))
    );

    const impressions = Number(campaign.impressions ?? 0);
    const formFills = Number(agg.form_fills ?? 0);
    const qualified = Number(agg.qualified ?? 0);
    const notified = Number(agg.notified ?? 0);

    const stages: MetaFunnelStage[] = [
      { key: 'impressions', label: 'Impressions', count: impressions },
      { key: 'reach', label: 'Reach', count: Number(campaign.reach ?? 0) },
      { key: 'clicks', label: 'Clicks', count: Number(campaign.clicks ?? 0) },
      { key: 'form_fills', label: 'Form Fills', count: formFills },
      { key: 'qualified', label: 'Qualified', count: qualified },
      { key: 'notified', label: 'Notified', count: notified },
    ];

    // Only stages an ATS candidate actually reached are appended. Rendering all ten canonical
    // stages for a campaign with three candidates would be mostly zeroes and read as failure.
    for (const stage of CANONICAL_STAGE_ORDER) {
      const step = atsFunnel.steps.find((s) => s.stage === stage);
      if (step && step.reached > 0) {
        stages.push({ key: `ats_${stage}`, label: CANONICAL_STAGE_LABEL[stage], count: step.reached });
      }
    }

    const spend = Number(campaign.spend_inr ?? 0);
    return {
      campaignId,
      requisitionId: (campaign.requisition_id as string | null) ?? null,
      requisitionCode: (campaign.requisition_code as string | null) ?? null,
      designationName: (campaign.designation_name as string | null) ?? null,
      campaignName: String(campaign.campaign_name ?? ''),
      stages,
      spendInr: spend,
      // Guarded divides: 0 spend over 0 leads is not "₹0 per lead", it is unknown.
      costPerLead: spend > 0 && formFills > 0 ? spend / formFills : null,
      costPerQualified: spend > 0 && qualified > 0 ? spend / qualified : null,
    };
  },

  /** Roll-up across every campaign, for the dashboard header. */
  async getOverview(): Promise<{
    campaigns: number;
    activeCampaigns: number;
    impressions: number;
    clicks: number;
    spendInr: number;
    formFills: number;
    qualified: number;
    disqualified: number;
    pending: number;
    candidatesCreated: number;
    costPerQualified: number | null;
    metaConfigured: boolean;
  }> {
    const [c] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS campaigns,
              SUM(CASE WHEN campaign_status = 'active' THEN 1 ELSE 0 END) AS active_campaigns,
              COALESCE(SUM(impressions),0) AS impressions,
              COALESCE(SUM(clicks),0)      AS clicks,
              COALESCE(SUM(spend_inr),0)   AS spend_inr
         FROM meta_campaign`
    );
    const [l] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS form_fills,
              SUM(CASE WHEN screening_result = 'qualified' THEN 1 ELSE 0 END)    AS qualified,
              SUM(CASE WHEN screening_result = 'disqualified' THEN 1 ELSE 0 END) AS disqualified,
              SUM(CASE WHEN screening_result = 'pending' THEN 1 ELSE 0 END)      AS pending,
              SUM(CASE WHEN ats_candidate_id IS NOT NULL THEN 1 ELSE 0 END)      AS candidates
         FROM meta_lead_raw`
    );
    const spend = Number(c[0]?.spend_inr ?? 0);
    const qualified = Number(l[0]?.qualified ?? 0);
    return {
      campaigns: Number(c[0]?.campaigns ?? 0),
      activeCampaigns: Number(c[0]?.active_campaigns ?? 0),
      impressions: Number(c[0]?.impressions ?? 0),
      clicks: Number(c[0]?.clicks ?? 0),
      spendInr: spend,
      formFills: Number(l[0]?.form_fills ?? 0),
      qualified,
      disqualified: Number(l[0]?.disqualified ?? 0),
      pending: Number(l[0]?.pending ?? 0),
      candidatesCreated: Number(l[0]?.candidates ?? 0),
      costPerQualified: spend > 0 && qualified > 0 ? spend / qualified : null,
      metaConfigured: isMetaConfigured(),
    };
  },

  // ─────────────────────── insights sync ───────────────────────

  /**
   * Pull insight counters for every campaign that has a META campaign ID.
   *
   * A per-campaign failure is recorded on the row (last_sync_error) and does not abort the batch.
   * Silent partial success is the failure mode to avoid here: a dashboard showing yesterday's
   * numbers with no indication that the sync broke is worse than showing the error.
   */
  async syncAllCampaignMetrics(): Promise<{ synced: number; failed: number; skipped: number }> {
    if (!isMetaConfigured()) {
      return { synced: 0, failed: 0, skipped: 0 };
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, meta_campaign_id FROM meta_campaign
        WHERE meta_campaign_id IS NOT NULL AND meta_campaign_id <> ''
          AND campaign_status IN ('active','paused','completed')`
    );

    let synced = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const insights = await fetchCampaignInsights(String(row.meta_campaign_id));
        await db.execute(
          `UPDATE meta_campaign
              SET impressions = ?, reach = ?, clicks = ?, spend_inr = ?,
                  last_synced_at = NOW(), last_sync_error = NULL
            WHERE id = ?`,
          [insights.impressions, insights.reach, insights.clicks, insights.spend, row.id]
        );
        synced += 1;
      } catch (err) {
        failed += 1;
        await db
          .execute('UPDATE meta_campaign SET last_sync_error = ?, last_synced_at = NOW() WHERE id = ?', [
            err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000),
            row.id,
          ])
          .catch(() => undefined);
      }
    }
    return { synced, failed, skipped: 0 };
  },

  /** Re-parse and re-screen a stored lead without going back to the Graph API. */
  async rescreenLead(leadId: string): Promise<MetaLead | null> {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT * FROM meta_lead_raw WHERE id = ? LIMIT 1', [leadId]);
    const lead = rows[0];
    if (!lead) return null;

    const raw = typeof lead.raw_payload === 'string' ? JSON.parse(lead.raw_payload) : lead.raw_payload;
    if (!raw || !Array.isArray(raw.field_data)) return toLead(lead);

    const parsed = parseLead(raw);
    let screeningResult: 'pending' | 'qualified' | 'disqualified' = 'pending';
    let reason: string | null = null;

    if (lead.requisition_id) {
      const [reqRows] = await db.execute<RowDataPacket[]>(
        `SELECT meta_target_age_min, meta_target_age_max, education_requirement,
                experience_min_years, experience_max_years
           FROM job_requisition WHERE id = ? LIMIT 1`,
        [lead.requisition_id]
      );
      const r = reqRows[0];
      if (r) {
        const result = screenLead(
          { parsedAge: parsed.age, parsedEducation: parsed.education, parsedExperienceYr: parsed.experienceYears },
          {
            metaTargetAgeMin: r.meta_target_age_min === null ? null : Number(r.meta_target_age_min),
            metaTargetAgeMax: r.meta_target_age_max === null ? null : Number(r.meta_target_age_max),
            educationRequirement: (r.education_requirement as string | null) ?? null,
            experienceMinYears: r.experience_min_years === null ? null : Number(r.experience_min_years),
            experienceMaxYears: r.experience_max_years === null ? null : Number(r.experience_max_years),
          }
        );
        screeningResult = result.qualified ? 'qualified' : 'disqualified';
        reason = result.reason;
      }
    }

    await db.execute(
      `UPDATE meta_lead_raw
          SET parsed_name = ?, parsed_phone = ?, parsed_email = ?, parsed_age = ?,
              parsed_location = ?, parsed_education = ?, parsed_experience_yr = ?,
              screening_result = ?, disqualification_reason = ?
        WHERE id = ?`,
      [
        parsed.name,
        parsed.phone,
        parsed.email,
        parsed.age,
        parsed.location,
        parsed.education,
        parsed.experienceYears,
        screeningResult,
        reason,
        leadId,
      ]
    );

    const [after] = await db.execute<RowDataPacket[]>('SELECT * FROM meta_lead_raw WHERE id = ? LIMIT 1', [leadId]);
    return after[0] ? toLead(after[0]) : null;
  },
};

export { canonicalStage };
