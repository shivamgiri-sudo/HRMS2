/**
 * META Campaign Automation — shared types.
 *
 * Naming follows the two conventions already in use in this codebase: snake_case for anything
 * that is a direct row shape off a MySQL query, camelCase for API/DTO shapes the frontend sees.
 * Mixing them in one interface is what makes campaign code hard to read, so the row shapes live
 * in `*Row` interfaces and the mappers are the only place the two meet.
 */

export type MetaCampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';
export type MetaScreeningResult = 'pending' | 'qualified' | 'disqualified';

/** Row shape of `meta_campaign`. */
export interface MetaCampaignRow {
  id: string;
  requisition_id: string;
  meta_campaign_id: string | null;
  meta_adset_id: string | null;
  meta_ad_id: string | null;
  meta_form_id: string | null;
  campaign_name: string;
  campaign_status: MetaCampaignStatus;
  impressions: number;
  reach: number;
  clicks: number;
  leads_count: number;
  spend_inr: string | number;
  last_synced_at: Date | string | null;
  last_sync_error: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** API shape of a campaign. */
export interface MetaCampaign {
  id: string;
  requisitionId: string;
  requisitionCode?: string | null;
  designationName?: string | null;
  branchName?: string | null;
  /** Joined from job_requisition */
  processName?: string | null;
  demandRaisedDate?: string | null;
  trainingStartDate?: string | null;
  targetJoiningDate?: string | null;
  requestedByName?: string | null;
  requestedHeadcount?: number | null;
  plannedBatchNo?: string | null;
  plannedBatchName?: string | null;
  requisitionPriority?: string | null;
  metaCampaignId: string | null;
  metaAdsetId: string | null;
  metaAdId: string | null;
  metaFormId: string | null;
  campaignName: string;
  campaignStatus: MetaCampaignStatus;
  impressions: number;
  reach: number;
  clicks: number;
  leadsCount: number;
  spendInr: number;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Row shape of `meta_lead_raw`. */
export interface MetaLeadRow {
  id: string;
  meta_form_id: string;
  meta_lead_id: string;
  campaign_id: string | null;
  requisition_id: string | null;
  raw_payload: unknown;
  parsed_name: string | null;
  parsed_phone: string | null;
  parsed_email: string | null;
  parsed_age: number | null;
  parsed_location: string | null;
  parsed_education: string | null;
  parsed_experience_yr: string | number | null;
  screening_result: MetaScreeningResult;
  disqualification_reason: string | null;
  ats_candidate_id: string | null;
  notification_sent_at: Date | string | null;
  notification_channels: unknown;
  voice_call_status: string | null;
  voice_call_outcome: string | null;
  voice_called_at: Date | string | null;
  calling_feedback: string | null;
  calling_feedback_at: Date | string | null;
  calling_feedback_notes: string | null;
  calling_feedback_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** API shape of a lead. */
export interface MetaLead {
  id: string;
  metaFormId: string;
  metaLeadId: string;
  campaignId: string | null;
  requisitionId: string | null;
  parsedName: string | null;
  parsedPhone: string | null;
  parsedEmail: string | null;
  parsedAge: number | null;
  parsedLocation: string | null;
  parsedEducation: string | null;
  parsedExperienceYr: number | null;
  screeningResult: MetaScreeningResult;
  disqualificationReason: string | null;
  atsCandidateId: string | null;
  notificationSentAt: string | null;
  notificationChannels: string[];
  voiceCallStatus: string | null;
  voiceCallOutcome: string | null;
  voiceCalledAt: string | null;
  callingFeedback: string | null;
  callingFeedbackAt: string | null;
  callingFeedbackNotes: string | null;
  createdAt: string;
}

/**
 * The webhook body META POSTs for a Lead Gen form fill.
 *
 * Note this payload contains NO candidate data at all — only `leadgen_id`, which must then be
 * fetched from the Graph API. That is why the webhook cannot be self-contained and why
 * META_MARKETING_ACCESS_TOKEN is required even just to read a lead.
 */
export interface MetaWebhookLeadPayload {
  object: string;
  entry: Array<{
    id: string;
    time: number;
    changes: Array<{
      field: string;
      value: {
        form_id: string;
        leadgen_id: string;
        created_time: number;
        page_id: string;
        ad_id?: string;
        adgroup_id?: string;
        campaign_id?: string;
      };
    }>;
  }>;
}

export interface MetaLeadFieldData {
  name?: string;
  field_name?: string;
  values: string[];
}

export interface MetaLeadDetail {
  id: string;
  created_time?: string | number;
  form_id?: string;
  ad_id?: string;
  adgroup_id?: string;
  campaign_id?: string;
  field_data: MetaLeadFieldData[];
}

export interface MetaCampaignInsights {
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  spend: number;
}

/** The subset of `job_requisition` the campaign feature adds and reads. */
export interface RequisitionMetaFields {
  bmiAssessmentUrl: string | null;
  metaTargetAgeMin: number | null;
  metaTargetAgeMax: number | null;
  metaTargetLocations: string[] | null;
  metaTargetRadiusKm: number | null;
}

/** One stage of the campaign funnel rendered by the dashboard. */
export interface MetaFunnelStage {
  key: string;
  label: string;
  count: number;
}

export interface MetaCampaignFunnel {
  campaignId: string;
  requisitionId: string | null;
  requisitionCode: string | null;
  designationName: string | null;
  campaignName: string;
  stages: MetaFunnelStage[];
  spendInr: number;
  costPerLead: number | null;
  costPerQualified: number | null;
}

export interface CreateMetaCampaignInput {
  requisitionId: string;
  campaignName: string;
  metaCampaignId?: string | null;
  metaAdsetId?: string | null;
  metaAdId?: string | null;
  metaFormId?: string | null;
  campaignStatus?: MetaCampaignStatus;
  notes?: string | null;
}

export type UpdateMetaCampaignInput = Partial<Omit<CreateMetaCampaignInput, 'requisitionId'>>;
