/**
 * META Graph API client — Lead Gen retrieval and campaign insights.
 *
 * Every function here is credential-gated through isMetaConfigured(). None of the four
 * META_MARKETING_* / META_LEAD_* env vars existed anywhere in this repo before this feature, so
 * on any environment that has not been given a token these calls must fail closed and quietly
 * rather than throw on boot or spam the log — the same posture the communication providers take.
 */

import axios, { AxiosError } from 'axios';
import type { MetaLeadDetail, MetaCampaignInsights } from './meta-campaign.types.js';

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v19.0';
const BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function token(): string {
  return process.env.META_MARKETING_ACCESS_TOKEN ?? '';
}

/** True when a Graph API call can actually be attempted. */
export function isMetaConfigured(): boolean {
  return Boolean(token());
}

/** The token META echoes back during webhook subscription (`hub.verify_token`). */
export function leadVerifyToken(): string {
  return process.env.META_LEAD_VERIFY_TOKEN ?? '';
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly metaCode: number | null
  ) {
    super(message);
    this.name = 'MetaApiError';
  }
}

function toMetaApiError(err: unknown, context: string): MetaApiError {
  if (axios.isAxiosError(err)) {
    const ax = err as AxiosError<{ error?: { message?: string; code?: number } }>;
    const metaMsg = ax.response?.data?.error?.message;
    const metaCode = ax.response?.data?.error?.code ?? null;
    return new MetaApiError(
      `${context}: ${metaMsg ?? ax.message}`,
      ax.response?.status ?? null,
      metaCode
    );
  }
  return new MetaApiError(`${context}: ${err instanceof Error ? err.message : String(err)}`, null, null);
}

/**
 * Fetch the actual field values for a lead.
 *
 * The webhook payload carries only a `leadgen_id` — no name, no phone, nothing — so this call is
 * mandatory, not an enrichment step. Note META only serves lead data for 90 days after creation,
 * which is why meta_lead_raw stores the response verbatim: after that window a re-parse is only
 * possible from our own copy.
 */
export async function fetchLeadDetail(leadId: string): Promise<MetaLeadDetail> {
  if (!isMetaConfigured()) {
    throw new MetaApiError('META_MARKETING_ACCESS_TOKEN is not configured', null, null);
  }
  try {
    const { data } = await axios.get<MetaLeadDetail>(`${BASE}/${encodeURIComponent(leadId)}`, {
      params: {
        access_token: token(),
        fields: 'id,created_time,field_data,ad_id,adgroup_id,campaign_id,form_id',
      },
      timeout: 10000,
    });
    return data;
  } catch (err) {
    throw toMetaApiError(err, `fetchLeadDetail(${leadId})`);
  }
}

/**
 * Pull insight counters for one campaign.
 *
 * `spend` comes back as the ad account's currency, NOT necessarily INR — the column is named
 * spend_inr because every MAS ad account bills in INR, but if a non-INR account is ever added
 * this is the conversion point and the value would otherwise be silently wrong.
 *
 * Lead volume is read from the `actions` array rather than a top-level field; META reports it as
 * an action of type `lead`, and its absence means zero leads, not an error.
 */
export async function fetchCampaignInsights(
  metaCampaignId: string,
  datePreset = 'last_30d'
): Promise<MetaCampaignInsights> {
  if (!isMetaConfigured()) {
    throw new MetaApiError('META_MARKETING_ACCESS_TOKEN is not configured', null, null);
  }
  try {
    const { data } = await axios.get<{
      data?: Array<{
        impressions?: string;
        reach?: string;
        clicks?: string;
        spend?: string;
        actions?: Array<{ action_type: string; value: string }>;
      }>;
    }>(`${BASE}/${encodeURIComponent(metaCampaignId)}/insights`, {
      params: {
        access_token: token(),
        fields: 'impressions,reach,clicks,actions,spend',
        date_preset: datePreset,
      },
      timeout: 15000,
    });

    const row = data.data?.[0] ?? {};
    const leadAction = (row.actions ?? []).find(
      (a) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped'
    );
    return {
      impressions: Number(row.impressions ?? 0),
      reach: Number(row.reach ?? 0),
      clicks: Number(row.clicks ?? 0),
      leads: Number(leadAction?.value ?? 0),
      spend: Number(row.spend ?? 0),
    };
  } catch (err) {
    throw toMetaApiError(err, `fetchCampaignInsights(${metaCampaignId})`);
  }
}
