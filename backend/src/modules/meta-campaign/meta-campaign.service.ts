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
import { assignRecruiterToCandidate, assignUnassignedCandidates } from '../ats/ats.enhanced.service.js';
import {
  fetchLeadDetail,
  fetchCampaignInsights,
  fetchFormLeads,
  fetchPageLeadForms,
  isMetaConfigured,
  MetaApiError,
} from './meta-api.client.js';
import { parseLead, normaliseMetaId, extractRoutingCode } from './meta-lead.parser.js';
import { screenLead } from './lead-screener.service.js';
import { loadCampaignScreeningConfig } from './campaign-screening.js';
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
    processName: (r.process_name as string | null) ?? null,
    demandRaisedDate: iso(r.demand_raised_date as Date | string | null),
    trainingStartDate: iso(r.training_start_date as Date | string | null),
    targetJoiningDate: iso(r.target_joining_date as Date | string | null),
    requestedByName: (r.requested_by_name as string | null) ?? null,
    requestedHeadcount: r.requested_headcount ? Number(r.requested_headcount) : null,
    plannedBatchNo: (r.planned_batch_no as string | null) ?? null,
    plannedBatchName: (r.planned_batch_name as string | null) ?? null,
    requisitionPriority: (r.requisition_priority as string | null) ?? null,
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

/** True for the placeholder row ingestLead stores when the Graph lead fetch failed. */
export function isGraphFetchStub(row: Record<string, unknown>): boolean {
  let payload = row.raw_payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return false;
    }
  }
  return (payload as { error?: unknown } | null)?.error === 'graph_fetch_failed';
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
    callingFeedback: r.calling_feedback,
    callingFeedbackAt: iso(r.calling_feedback_at),
    callingFeedbackNotes: r.calling_feedback_notes,
    createdAt: iso(r.created_at) ?? '',
  };
}

const CAMPAIGN_SELECT = `
  SELECT mc.*,
         jr.requisition_code, jr.designation_name, jr.branch_name, jr.process_name,
         jr.demand_raised_date, jr.training_start_date, jr.target_joining_date,
         jr.requested_by_name, jr.requested_headcount,
         jr.planned_batch_no, jr.planned_batch_name, jr.priority AS requisition_priority
    FROM meta_campaign mc
    LEFT JOIN job_requisition jr ON jr.id = mc.requisition_id`;

// ──────────────────────────── service ────────────────────────────

export const metaCampaignService = {
  async listCampaigns(filters: {
    requisitionId?: string;
    status?: MetaCampaignStatus;
    search?: string;
    branchName?: string;
    processName?: string;
    dateFrom?: string;
    dateTo?: string;
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
    if (filters.branchName) {
      conds.push('jr.branch_name = ?');
      params.push(filters.branchName);
    }
    if (filters.processName) {
      conds.push('jr.process_name = ?');
      params.push(filters.processName);
    }
    if (filters.dateFrom) {
      conds.push('mc.created_at >= ?');
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      conds.push("mc.created_at <= CONCAT(?, ' 23:59:59')");
      params.push(filters.dateTo);
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
   * Resolve a batch requisition from a hidden routing code carried in the lead form, and ensure a
   * meta_campaign row exists linking THIS form to it.
   *
   * This is the Option-A auto-routing path. When a form carries requisition_code=REQ-2609-K7BK:
   *
   *   1. look up job_requisition by that code (exact, case-insensitive on the stored value);
   *   2. if a meta_campaign row already exists for this form_id, adopt it (and correct its
   *      requisition link if it drifted);
   *   3. otherwise create a meta_campaign row on the fly, so the lead screens and reports exactly
   *      as a manually-linked form would — no operator step required.
   *
   * Returns the campaign row (same shape ingestLead already reads) or null when the code does not
   * resolve to a real requisition, in which case ingestLead falls back to the form-ID link and
   * finally to pending. A code that names no requisition is NOT invented into one — a wrong batch
   * is worse than an unrouted lead a human can place.
   */
  async resolveCampaignByRoutingCode(
    formId: string,
    routingCode: string
  ): Promise<RowDataPacket | null> {
    const [reqRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, requisition_code FROM job_requisition WHERE UPPER(requisition_code) = ? LIMIT 1`,
      [routingCode]
    );
    const requisition = reqRows[0];
    if (!requisition) return null;

    // Is this form already linked (manually or by an earlier auto-route)?
    const [existing] = await db.execute<RowDataPacket[]>(
      'SELECT id, requisition_id FROM meta_campaign WHERE meta_form_id = ? LIMIT 1',
      [formId]
    );
    if (existing[0]) {
      // Correct a drifted link: the hidden code is authoritative, so if the stored campaign points
      // at a different requisition than the form now declares, re-point it. This is how a form
      // that was manually mislinked self-heals once it starts carrying the code.
      if (existing[0].requisition_id !== requisition.id) {
        await db.execute('UPDATE meta_campaign SET requisition_id = ? WHERE id = ?', [
          requisition.id,
          existing[0].id,
        ]);
      }
    } else {
      // Auto-create the link. campaign_status 'active' (not 'draft') because a form actively
      // receiving leads is, by definition, live; the name records that it was self-registered.
      const newId = randomUUID();
      await db
        .execute(
          `INSERT INTO meta_campaign
             (id, requisition_id, meta_form_id, campaign_name, campaign_status, notes, created_by)
           VALUES (?, ?, ?, ?, 'active', ?, NULL)`,
          [
            newId,
            requisition.id,
            formId,
            `Auto-linked · ${requisition.requisition_code}`,
            `Self-registered from hidden requisition_code field on form ${formId}.`,
          ]
        )
        .catch(async (e: unknown) => {
          // A UNIQUE clash on meta_form_id means a concurrent lead from the same form created the
          // row a millisecond earlier — harmless, adopt whatever is there now.
          const msg = e instanceof Error ? e.message : String(e);
          if (!/duplicate|ER_DUP_ENTRY/i.test(msg)) throw e;
        });
    }

    // Return the campaign joined to the requisition's screening criteria, matching the exact shape
    // ingestLead's own lookup produces.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT mc.id, mc.requisition_id,
              jr.meta_target_age_min, jr.meta_target_age_max,
              jr.education_requirement, jr.experience_min_years, jr.experience_max_years,
              jr.designation_name, jr.branch_name, jr.process_name,
              jr.meta_screening_config
         FROM meta_campaign mc
         LEFT JOIN job_requisition jr ON jr.id = mc.requisition_id
        WHERE mc.meta_form_id = ? LIMIT 1`,
      [formId]
    );
    return rows[0] ?? null;
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
    /**
     * When true, the qualified-lead outreach (WhatsApp / voice) is NOT fired. Used by the
     * historical backfill: pulling months of past leads must never blast messages to people who
     * applied weeks ago. The ATS candidate is still created — only the outbound contact is skipped.
     */
    skipOutreach?: boolean;
    /**
     * A lead detail already fetched from Graph (backfill has it in hand from the /leads listing),
     * so ingestLead need not spend a second Graph call per lead re-fetching what it was handed.
     */
    prefetchedDetail?: import('./meta-campaign.types.js').MetaLeadDetail;
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
    // A placeholder left by a failed Graph fetch is NOT a duplicate: it holds no name or phone, and
    // treating it as one would strand the lead forever. It is completed in place below.
    const stubToHeal = dupe[0] && isGraphFetchStub(dupe[0]) ? dupe[0] : null;
    if (dupe[0] && !stubToHeal) return toLead(dupe[0]);

    // Route the form back to a campaign/requisition. An unlinked form is stored anyway — losing
    // the lead because an operator has not filled in the Form ID yet would be the worse failure.
    const [campaignRows] = await db.execute<RowDataPacket[]>(
      `SELECT mc.id, mc.requisition_id,
              jr.meta_target_age_min, jr.meta_target_age_max,
              jr.education_requirement, jr.experience_min_years, jr.experience_max_years,
              jr.designation_name, jr.branch_name, jr.process_name,
              jr.meta_screening_config
         FROM meta_campaign mc
         LEFT JOIN job_requisition jr ON jr.id = mc.requisition_id
        WHERE mc.meta_form_id = ? LIMIT 1`,
      [formId]
    );
    // The form-ID link, resolved before we have the lead detail. It may be overridden below once
    // the detail is parsed and a hidden requisition_code is found (Option-A auto-routing).
    const campaignFromForm = campaignRows[0] ?? null;

    let detail;
    try {
      detail = args.prefetchedDetail ?? (await fetchLeadDetail(leadgenId));
    } catch (err) {
      // Already holding a stub for this lead: nothing new to store, retry on the next attempt.
      if (stubToHeal) throw err;
      // Store a stub so the lead is not lost; the next ingest attempt completes it in place.
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
          campaignFromForm?.id ?? null,
          campaignFromForm?.requisition_id ?? null,
          JSON.stringify({ error: 'graph_fetch_failed', args }),
          err instanceof MetaApiError ? err.message : String(err),
        ]
      );
      throw err;
    }

    const parsed = parseLead(detail);

    // Option-A auto-routing: a hidden requisition_code on the form is authoritative and overrides
    // the form-ID link resolved above. This is what makes many-batches/many-campaigns route
    // correctly without an operator pasting a Form ID for every batch — the form declares its own
    // requisition. Falls through to the form-ID `campaign` when absent or unresolvable.
    let campaign = campaignFromForm;
    if (parsed.routingCode) {
      const routed = await this.resolveCampaignByRoutingCode(formId, parsed.routingCode).catch(
        (e: unknown) => {
          console.warn('[meta] routing-code resolution failed', e instanceof Error ? e.message : e);
          return null;
        }
      );
      if (routed) campaign = routed;
    }

    // A campaign with no requisition yet ("JR pending") is screened only against its own
    // campaign-level criteria, if it has any. With none it stays 'pending' — it used to be screened
    // against nothing and so qualified (and was messaged) unchecked.
    const hasRequisition = Boolean(campaign?.requisition_id);
    const campaignCriteria = campaign && !hasRequisition ? await loadCampaignScreeningConfig(formId) : null;
    const rawScreeningConfig = hasRequisition ? campaign?.meta_screening_config : campaignCriteria;
    const screeningConfig = rawScreeningConfig
      ? (typeof rawScreeningConfig === 'string' ? JSON.parse(rawScreeningConfig) : rawScreeningConfig)
      : null;

    const screening = campaign && (hasRequisition || campaignCriteria)
      ? screenLead(
          {
            parsedAge: parsed.age,
            parsedEducation: parsed.education,
            parsedExperienceYr: parsed.experienceYears,
            parsedGender: parsed.gender,
            rawFields: parsed.rawFields,
          },
          {
            metaTargetAgeMin: campaign.meta_target_age_min === null ? null : Number(campaign.meta_target_age_min),
            metaTargetAgeMax: campaign.meta_target_age_max === null ? null : Number(campaign.meta_target_age_max),
            educationRequirement: (campaign.education_requirement as string | null) ?? null,
            experienceMinYears:
              campaign.experience_min_years === null ? null : Number(campaign.experience_min_years),
            experienceMaxYears:
              campaign.experience_max_years === null ? null : Number(campaign.experience_max_years),
            screeningConfig,
          }
        )
      : // No linked requisition means no criteria to screen against. 'pending' is the honest
        // state — neither qualified nor disqualified — and it keeps the lead visible for a
        // recruiter to action manually.
        null;

    const id = stubToHeal ? String(stubToHeal.id) : randomUUID();
    const leadValues = [
      campaign?.id ?? null,
      campaign?.requisition_id || null,
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
    ];
    if (stubToHeal) {
      await db.execute(
        `UPDATE meta_lead_raw
            SET campaign_id = ?, requisition_id = ?, raw_payload = ?,
                parsed_name = ?, parsed_phone = ?, parsed_email = ?, parsed_age = ?, parsed_location = ?,
                parsed_education = ?, parsed_experience_yr = ?, screening_result = ?, disqualification_reason = ?
          WHERE id = ?`,
        [...leadValues, id]
      );
    } else {
      await db.execute(
        `INSERT INTO meta_lead_raw
           (id, meta_form_id, meta_lead_id, campaign_id, requisition_id, raw_payload,
            parsed_name, parsed_phone, parsed_email, parsed_age, parsed_location,
            parsed_education, parsed_experience_yr, screening_result, disqualification_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, formId, leadgenId, ...leadValues]
      );
    }

    if (campaign?.id) {
      await db.execute('UPDATE meta_campaign SET leads_count = leads_count + 1 WHERE id = ?', [campaign.id]);
    }

    if (screening?.qualified) {
      await this.createCandidateFromLead(id).catch((e: unknown) =>
        console.warn('[meta] createCandidateFromLead failed', e instanceof Error ? e.message : e)
      );
      // Outreach is suppressed for backfilled leads or when auto_notify is explicitly disabled.
      // Default: auto_notify = true (fire immediately on qualify).
      const autoNotify = screeningConfig?.auto_notify !== false;
      if (!args.skipOutreach && autoNotify) {
        await notifyQualifiedLead(id).catch((e: unknown) =>
          console.warn('[meta] notifyQualifiedLead failed', e instanceof Error ? e.message : e)
        );
      }
    }

    const [rows] = await db.execute<RowDataPacket[]>('SELECT * FROM meta_lead_raw WHERE id = ? LIMIT 1', [id]);
    return rows[0] ? toLead(rows[0]) : null;
  },

  /**
   * Backfill every stored lead for one form by walking the Graph `/{form}/leads` pages.
   *
   * This is the historical import path. It reuses ingestLead for each lead, so parsing, screening,
   * dedup (on meta_lead_id) and candidate creation are byte-for-byte identical to the live webhook
   * path — the ONLY difference is skipOutreach, which is forced true so importing months of past
   * leads never messages anyone. Re-running is safe: dedup makes an already-imported lead a no-op.
   *
   * Errors on individual leads are counted, not thrown, so one malformed lead cannot abandon the
   * rest of a 1,000-lead form.
   */
  async backfillFormLeads(
    formId: string,
    opts: { maxPages?: number } = {}
  ): Promise<{ formId: string; fetched: number; imported: number; duplicates: number; errors: number }> {
    const normalisedForm = normaliseMetaId(formId) ?? formId;
    const maxPages = opts.maxPages ?? 200; // 200 * 100 = 20k leads ceiling, well above any one form
    let after: string | null = null;
    let fetched = 0;
    let imported = 0;
    let duplicates = 0;
    let errors = 0;

    for (let page = 0; page < maxPages; page += 1) {
      const { leads, nextAfter } = await fetchFormLeads(normalisedForm, after);
      if (!leads.length) break;

      for (const detail of leads) {
        fetched += 1;
        const leadgenId = String(detail.id);
        try {
          // Cheap pre-check so the "duplicates" counter is meaningful; ingestLead would also
          // dedup, but it would report the lead as imported.
          const [dupe] = await db.execute<RowDataPacket[]>(
            'SELECT id, raw_payload FROM meta_lead_raw WHERE meta_lead_id = ? LIMIT 1',
            [normaliseMetaId(leadgenId) ?? leadgenId]
          );
          if (dupe[0] && !isGraphFetchStub(dupe[0])) {
            duplicates += 1;
            continue;
          }
          await this.ingestLead({
            formId: normalisedForm,
            leadgenId,
            adId: detail.ad_id ?? null,
            adgroupId: detail.adgroup_id ?? null,
            campaignIdFromMeta: detail.campaign_id ?? null,
            skipOutreach: true,
            prefetchedDetail: detail,
          });
          imported += 1;
        } catch {
          errors += 1;
        }
      }

      after = nextAfter;
      if (!after) break;
    }

    return { formId: normalisedForm, fetched, imported, duplicates, errors };
  },

  /**
   * Backfill every linked campaign's form, or a given set of form IDs. Convenience wrapper over
   * backfillFormLeads for the initial bulk import and the dashboard's "import history" action.
   */
  async backfillAllLinkedForms(): Promise<{
    forms: Array<{ formId: string; fetched: number; imported: number; duplicates: number; errors: number }>;
    totalImported: number;
  }> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT meta_form_id FROM meta_campaign
        WHERE meta_form_id IS NOT NULL AND meta_form_id <> ''`
    );
    const forms: Array<{ formId: string; fetched: number; imported: number; duplicates: number; errors: number }> = [];
    let totalImported = 0;
    for (const row of rows) {
      const result = await this.backfillFormLeads(String(row.meta_form_id));
      forms.push(result);
      totalImported += result.imported;
    }
    return { forms, totalImported };
  },

  /** List the Lead Gen forms on the configured Page (discovery for form→requisition linking). */
  async listPageForms(pageId: string): Promise<Array<{ id: string; name: string; status: string; leadsCount: number }>> {
    return fetchPageLeadForms(pageId);
  },

  /**
   * All leads across every campaign, paginated, for the standalone All-Leads page.
   *
   * Distinct from listLeads (which caps at 500 and is used for a single campaign's drawer): this
   * supports offset paging, a free-text search over name/phone/email, and joins the requisition +
   * campaign so each row can name where it came from. Returns rows + a total for the pager.
   */
  async listAllLeads(filters: {
    search?: string;
    screening?: string;
    requisitionId?: string;
    branchName?: string;
    processName?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ rows: Array<MetaLead & { requisitionCode: string | null; designationName: string | null; branchName: string | null; campaignName: string | null }>; total: number }> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.screening && filters.screening !== 'all') {
      conds.push('ml.screening_result = ?');
      params.push(filters.screening);
    }
    if (filters.requisitionId) {
      conds.push('ml.requisition_id = ?');
      params.push(filters.requisitionId);
    }
    if (filters.search && filters.search.trim()) {
      conds.push('(ml.parsed_name LIKE ? OR ml.parsed_phone LIKE ? OR ml.parsed_email LIKE ?)');
      const like = `%${filters.search.trim()}%`;
      params.push(like, like, like);
    }
    let needsJrJoin = false;
    if (filters.branchName) {
      conds.push('jr.branch_name = ?');
      params.push(filters.branchName);
      needsJrJoin = true;
    }
    if (filters.processName) {
      conds.push('jr.process_name = ?');
      params.push(filters.processName);
      needsJrJoin = true;
    }
    if (filters.dateFrom) {
      conds.push('ml.created_at >= ?');
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      conds.push("ml.created_at <= CONCAT(?, ' 23:59:59')");
      params.push(filters.dateTo);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const countJoin = needsJrJoin
      ? 'LEFT JOIN job_requisition jr ON jr.id = ml.requisition_id'
      : '';

    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM meta_lead_raw ml ${countJoin} ${where}`,
      params
    );
    const total = Number(countRows[0]?.total ?? 0);

    const limit = Math.min(Math.max(Number(filters.limit ?? 50), 1), 200);
    const offset = Math.max(Number(filters.offset ?? 0), 0);

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ml.*, jr.requisition_code, jr.designation_name, jr.branch_name, mc.campaign_name,
              COALESCE(msg.unread_count, 0) AS unread_message_count,
              msg.last_message_at
         FROM meta_lead_raw ml
         LEFT JOIN job_requisition jr ON jr.id = ml.requisition_id
         LEFT JOIN meta_campaign mc ON mc.id = ml.campaign_id
         LEFT JOIN (
           SELECT lead_id,
                  SUM(CASE WHEN direction='inbound' AND read_at IS NULL THEN 1 ELSE 0 END) AS unread_count,
                  MAX(created_at) AS last_message_at
             FROM meta_lead_messages
            GROUP BY lead_id
         ) msg ON msg.lead_id = ml.id
         ${where}
        ORDER BY ml.created_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return {
      rows: rows.map((r) => ({
        ...toLead(r),
        requisitionCode: (r.requisition_code as string | null) ?? null,
        designationName: (r.designation_name as string | null) ?? null,
        branchName: (r.branch_name as string | null) ?? null,
        campaignName: (r.campaign_name as string | null) ?? null,
        unreadMessageCount: Number(r.unread_message_count ?? 0),
        lastMessageAt: (r.last_message_at as string | null) ?? null,
      })),
      total,
    };
  },

  /**
   * One lead with its raw form answers, for the All-Leads drill-down drawer.
   *
   * The list endpoints deliberately omit raw_payload (it would bloat every row of a 2,600-row
   * table). This returns a single lead joined to its requisition/campaign, PLUS the flattened
   * field_data — every question the form asked and its answer, including the hidden routing code —
   * so the drawer can show exactly what META delivered without a second Graph call.
   */
  async getLeadDetail(leadId: string): Promise<
    | (MetaLead & {
        requisitionCode: string | null;
        designationName: string | null;
        branchName: string | null;
        campaignName: string | null;
        routingCode: string | null;
        fields: Array<{ name: string; value: string }>;
      })
    | null
  > {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ml.*, jr.requisition_code, jr.designation_name, jr.branch_name, mc.campaign_name
         FROM meta_lead_raw ml
         LEFT JOIN job_requisition jr ON jr.id = ml.requisition_id
         LEFT JOIN meta_campaign mc ON mc.id = ml.campaign_id
        WHERE ml.id = ? LIMIT 1`,
      [leadId]
    );
    const row = rows[0];
    if (!row) return null;

    // Flatten field_data for display. raw_payload may be a string or already-parsed JSON depending
    // on the mysql2 driver version, mirroring rescreenLead's handling.
    let fields: Array<{ name: string; value: string }> = [];
    let routingCode: string | null = null;
    try {
      const raw = typeof row.raw_payload === 'string' ? JSON.parse(row.raw_payload) : row.raw_payload;
      if (raw && Array.isArray(raw.field_data)) {
        fields = raw.field_data.map((f: { name?: string; field_name?: string; values?: string[] }) => ({
          name: String(f.name ?? f.field_name ?? ''),
          value: Array.isArray(f.values) ? f.values.filter(Boolean).join(', ') : '',
        }));
        routingCode = extractRoutingCode(raw);
      }
    } catch {
      // A stub row (graph_fetch_failed) has no field_data — leave fields empty rather than throw.
      fields = [];
    }

    return {
      ...toLead(row),
      requisitionCode: (row.requisition_code as string | null) ?? null,
      designationName: (row.designation_name as string | null) ?? null,
      branchName: (row.branch_name as string | null) ?? null,
      campaignName: (row.campaign_name as string | null) ?? null,
      routingCode,
      fields,
    };
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
    // Give the lead an owner straight away: a present recruiter of the requisition's branch. A miss
    // (no branch, nobody at the branch) is retried by healUnsyncedLeads, so it never blocks ingest.
    await assignRecruiterToCandidate(candidateId, null).catch((e: unknown) =>
      console.warn('[meta] recruiter assignment failed', e instanceof Error ? e.message : e)
    );
    return candidateId;
  },

  /**
   * Retry candidate creation for qualified leads that never got one (a swallowed INSERT failure
   * at ingest time leaves the lead qualified with ats_candidate_id NULL and nothing retries it),
   * and re-fetch leads stranded as Graph-fetch stubs. Candidate creation sends no messages.
   */
  async healUnsyncedLeads(sinceDays = 2, limit = 200): Promise<{ candidatesCreated: number; stubsRetried: number; stubsHealed: number; candidatesAssigned: number }> {
    const [orphans] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM meta_lead_raw
        WHERE screening_result = 'qualified' AND ats_candidate_id IS NULL
          AND parsed_phone IS NOT NULL AND parsed_name IS NOT NULL
          AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        ORDER BY created_at ASC LIMIT ${Number(limit)}`,
      [sinceDays]
    );
    let candidatesCreated = 0;
    for (const row of orphans) {
      const id = await this.createCandidateFromLead(String(row.id)).catch(() => null);
      if (id) candidatesCreated += 1;
    }

    const [stubs] = await db.execute<RowDataPacket[]>(
      `SELECT meta_form_id, meta_lead_id FROM meta_lead_raw
        WHERE parsed_name IS NULL AND parsed_phone IS NULL
          AND JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.error')) = 'graph_fetch_failed'
          AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        ORDER BY created_at ASC LIMIT ${Number(limit)}`,
      [sinceDays]
    );
    let stubsHealed = 0;
    for (const s of stubs) {
      const healed = await this.ingestLead({
        formId: String(s.meta_form_id),
        leadgenId: String(s.meta_lead_id),
        skipOutreach: true,
      }).catch(() => null);
      if (healed && healed.parsedName) stubsHealed += 1;
    }
    // Leads whose candidate had no present recruiter at creation time get one now.
    const reassigned = await assignUnassignedCandidates({ sinceDays: Math.max(sinceDays, 7), limit }).catch(() => null);
    return { candidatesCreated, stubsRetried: stubs.length, stubsHealed, candidatesAssigned: reassigned?.assigned ?? 0 };
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
    walkins: number;
    selected: number;
    onboarded: number;
    costPerQualified: number | null;
    costPerWalkin: number | null;
    costPerOnboarded: number | null;
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

    // ATS funnel stages for candidates from META campaigns — uses the canonical stage mapping
    // to handle the variant labels (Arrival/Arrived, converted/onboarded, etc.)
    const [ats] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN LOWER(c.current_stage) IN ('arrival', 'arrived') THEN 1 ELSE 0 END) AS walkins,
         SUM(CASE WHEN LOWER(c.current_stage) IN ('selected', 'selection discussion') THEN 1 ELSE 0 END) AS selected,
         SUM(CASE WHEN LOWER(c.current_stage) IN ('onboarded', 'converted', 'payroll_validated') THEN 1 ELSE 0 END) AS onboarded
       FROM meta_lead_raw ml
       JOIN ats_candidate c ON c.id = ml.ats_candidate_id
       WHERE ml.ats_candidate_id IS NOT NULL`
    );

    const spend = Number(c[0]?.spend_inr ?? 0);
    const qualified = Number(l[0]?.qualified ?? 0);
    const walkins = Number(ats[0]?.walkins ?? 0);
    const onboarded = Number(ats[0]?.onboarded ?? 0);

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
      walkins,
      selected: Number(ats[0]?.selected ?? 0),
      onboarded,
      costPerQualified: spend > 0 && qualified > 0 ? spend / qualified : null,
      costPerWalkin: spend > 0 && walkins > 0 ? spend / walkins : null,
      costPerOnboarded: spend > 0 && onboarded > 0 ? spend / onboarded : null,
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

  /** Distinct branches, processes, and requisitions for the dashboard filter dropdowns. */
  async getFilterOptions(): Promise<{
    branches: string[];
    processes: string[];
    requisitions: Array<{ id: string; code: string; designation: string }>;
  }> {
    const [dimRows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT jr.branch_name, jr.process_name
         FROM meta_campaign mc
         LEFT JOIN job_requisition jr ON jr.id = mc.requisition_id
        WHERE jr.branch_name IS NOT NULL OR jr.process_name IS NOT NULL`
    );
    const branches = [...new Set(
      dimRows.map((r) => r.branch_name as string | null).filter((v): v is string => Boolean(v))
    )].sort();
    const processes = [...new Set(
      dimRows.map((r) => r.process_name as string | null).filter((v): v is string => Boolean(v))
    )].sort();

    const [reqRows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT mc.requisition_id AS id, jr.requisition_code AS code,
              jr.designation_name AS designation
         FROM meta_campaign mc
         LEFT JOIN job_requisition jr ON jr.id = mc.requisition_id
        WHERE mc.requisition_id IS NOT NULL
        ORDER BY jr.requisition_code`
    );
    const requisitions = reqRows
      .filter((r) => r.id)
      .map((r) => ({
        id: String(r.id),
        code: String(r.code ?? r.id),
        designation: String(r.designation ?? ''),
      }));

    return { branches, processes, requisitions };
  },

  /** Re-parse and re-screen a stored lead without going back to the Graph API. */
  async rescreenLead(leadId: string, opts: { createCandidate?: boolean } = {}): Promise<MetaLead | null> {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT * FROM meta_lead_raw WHERE id = ? LIMIT 1', [leadId]);
    const lead = rows[0];
    if (!lead) return null;

    const raw = typeof lead.raw_payload === 'string' ? JSON.parse(lead.raw_payload) : lead.raw_payload;
    if (!raw || !Array.isArray(raw.field_data)) return toLead(lead);

    const parsed = parseLead(raw);
    let screeningResult: 'pending' | 'qualified' | 'disqualified' = 'pending';
    let reason: string | null = null;

    // Retro-route on re-parse: if this lead's form carries a hidden requisition_code, resolve it
    // and (re)link the lead to that requisition + campaign. This is how the leads imported before
    // auto-routing existed — the 2,600+ backfilled ones sitting at pending/unlinked — get placed
    // onto their batch requisition simply by being re-parsed, with no manual form linking.
    let effectiveRequisitionId: string | null = (lead.requisition_id as string | null) ?? null;
    if (parsed.routingCode) {
      const routed = await this.resolveCampaignByRoutingCode(
        String(lead.meta_form_id),
        parsed.routingCode
      ).catch(() => null);
      if (routed?.requisition_id) {
        effectiveRequisitionId = routed.requisition_id as string;
        await db.execute('UPDATE meta_lead_raw SET campaign_id = ?, requisition_id = ? WHERE id = ?', [
          routed.id,
          routed.requisition_id,
          leadId,
        ]);
      }
    }

    if (effectiveRequisitionId) {
      const [reqRows] = await db.execute<RowDataPacket[]>(
        `SELECT meta_target_age_min, meta_target_age_max, education_requirement,
                experience_min_years, experience_max_years, meta_screening_config
           FROM job_requisition WHERE id = ? LIMIT 1`,
        [effectiveRequisitionId]
      );
      const r = reqRows[0];
      if (r) {
        const rawCfg = r.meta_screening_config;
        const cfg = rawCfg ? (typeof rawCfg === 'string' ? JSON.parse(rawCfg) : rawCfg) : null;
        const result = screenLead(
          {
            parsedAge: parsed.age,
            parsedEducation: parsed.education,
            parsedExperienceYr: parsed.experienceYears,
            parsedGender: parsed.gender,
            rawFields: parsed.rawFields,
          },
          {
            metaTargetAgeMin: r.meta_target_age_min === null ? null : Number(r.meta_target_age_min),
            metaTargetAgeMax: r.meta_target_age_max === null ? null : Number(r.meta_target_age_max),
            educationRequirement: (r.education_requirement as string | null) ?? null,
            experienceMinYears: r.experience_min_years === null ? null : Number(r.experience_min_years),
            experienceMaxYears: r.experience_max_years === null ? null : Number(r.experience_max_years),
            screeningConfig: cfg,
          }
        );
        screeningResult = result.qualified ? 'qualified' : 'disqualified';
        reason = result.reason;
      }
    } else {
      // No requisition yet ("JR pending"): screen against the campaign's own criteria if it has
      // any; otherwise the lead stays pending, as before.
      const campaignCfg = await loadCampaignScreeningConfig(String(lead.meta_form_id));
      if (campaignCfg) {
        const result = screenLead(
          {
            parsedAge: parsed.age,
            parsedEducation: parsed.education,
            parsedExperienceYr: parsed.experienceYears,
            parsedGender: parsed.gender,
            rawFields: parsed.rawFields,
          },
          {
            metaTargetAgeMin: null,
            metaTargetAgeMax: null,
            educationRequirement: null,
            experienceMinYears: null,
            experienceMaxYears: null,
            screeningConfig: campaignCfg,
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

    // If the re-screen (typically after retro-routing) now qualifies the lead, create the ATS
    // candidate — same adopt-or-insert path as live ingestion. Outreach is intentionally NOT fired
    // here: rescreen runs over historical/backfilled leads, and messaging them is the exact thing
    // the backfill's skipOutreach was built to avoid. A recruiter can trigger outreach per-lead.
    // opts.createCandidate = false lets a bulk re-screen refresh results without seeding the ATS.
    if (screeningResult === 'qualified' && opts.createCandidate !== false) {
      await this.createCandidateFromLead(leadId).catch((e: unknown) =>
        console.warn('[meta] rescreen createCandidateFromLead failed', e instanceof Error ? e.message : e)
      );
    }

    const [after] = await db.execute<RowDataPacket[]>('SELECT * FROM meta_lead_raw WHERE id = ? LIMIT 1', [leadId]);
    return after[0] ? toLead(after[0]) : null;
  },
};

export { canonicalStage };
