/**
 * Facts for the funnel-depth insights (he-drive-insights-funnel.ts), built from what the /drive-analytics build already holds: the persons
 * journey, per-campaign rows with their blockers, open seats, the reply / arrival grids and cost. The one read: the top disqualify reasons
 * of the window's screened fills, only for campaigns whose screening passes few fills (meta_lead_raw by campaign_id, idx_ml_campaign).
 * Reasons are grouped by their rule text (reasonLabel drops candidate answers and numbers). Never throws: a failing read flags
 * "insight:screening" (logged as section + code only) and every other fact stays.
 */
import type { RowDataPacket } from "mysql2";
import { limitedDb } from "./he-read-limit.js";
import { logger } from "../../logger.js";
import type { Grid } from "./he-drive-analytics.js";
import type { InsightThresholds } from "./he-drive-insights.js";
import { emptyFunnelFacts, lowQualification, peakHour, reasonLabel, type FunnelCampaignFact, type FunnelFacts, type FunnelJourney } from "./he-drive-insights-funnel.js";
import type { CampaignProgress } from "./he-drive-persons.service.js";
import type { SourceType } from "./qualified-followup.types.js";
import { addDays } from "./requisition-stream.window.js";

export interface FunnelFactsInput {
  journey: Record<SourceType, FunnelJourney> | null;
  campaigns: CampaignProgress[];
  openSeats: Array<{ requisitionId: string; code: string; branch: string; open: number; closedReason?: string | null }>;
  replies: Record<SourceType, Grid>;
  arrivals: Record<SourceType, Grid> | undefined;
  cost: Record<SourceType, { perJoin: number | null; joined: number }> | null;
  from: string; to: string; t: InsightThresholds;
}

const MAX_REASONS = 3;
const ph = (n: number): string => Array(n).fill("?").join(",");
const reasonsSql = (n: number): string => `SELECT r.campaign_id, r.disqualification_reason AS reason, COUNT(*) AS n
  FROM meta_lead_raw r
 WHERE r.campaign_id IN (${ph(n)}) AND r.created_at >= ? AND r.created_at < ? AND r.screening_result = 'disqualified'
 GROUP BY r.campaign_id, r.disqualification_reason`;
const TYPES: readonly SourceType[] = ["meta_live", "meta_old", "he"];

export async function collectFunnelFacts(i: FunnelFactsInput, failed: string[]): Promise<FunnelFacts> {
  const f = emptyFunnelFacts();
  f.journey = i.journey;
  f.openSeats = (i.openSeats ?? []).map((s) => ({ requisitionId: s.requisitionId, code: s.code, branch: s.branch, open: s.open }));
  f.cost = i.cost;
  for (const t of TYPES) { f.replyPeak[t] = peakHour(i.replies?.[t]); f.arrivalPeak[t] = peakHour(i.arrivals?.[t]); }
  f.campaigns = (i.campaigns ?? []).map((c): FunnelCampaignFact => ({
    key: c.campaignId ?? "none", name: c.campaignName, requisitionId: c.requisitionId, code: c.requisitionCode, branch: c.branch, sourceType: c.sourceType,
    leads: c.stages.leads, fills: c.stages.fills, screened: c.stages.screened, qualified: c.stages.qualified, contacted: c.stages.contacted,
    invited: c.stages.invited, confirmed: c.stages.confirmed, arrived: c.stages.arrived, blockers: c.blockers ?? [],
  }));

  const min = Number(i.t["insight.min_sample"]) || 0;
  const ids = [...new Set(f.campaigns.filter((c) => c.key !== "none" && lowQualification(c, i.t, min)).map((c) => c.key))];
  if (!ids.length) return f;
  try {
    const by = new Map<string, Map<string, number>>();
    for (let k = 0; k < ids.length; k += 200) {
      const b = ids.slice(k, k + 200);
      const [rows] = await limitedDb.execute<RowDataPacket[]>(reasonsSql(b.length), [...b, `${i.from} 00:00:00`, `${addDays(i.to, 1)} 00:00:00`]);
      for (const r of rows) {
        const m = by.get(String(r.campaign_id)) ?? new Map<string, number>();
        const label = reasonLabel(r.reason == null ? null : String(r.reason));
        m.set(label, (m.get(label) ?? 0) + (Number(r.n) || 0));
        by.set(String(r.campaign_id), m);
      }
    }
    for (const c of f.campaigns) {
      const m = by.get(c.key);
      if (m && ids.includes(c.key)) c.disqualify = [...m.entries()].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason)).slice(0, MAX_REASONS);
    }
  } catch (err) {
    if (!failed.includes("insight:screening")) failed.push("insight:screening");
    logger.error({ section: "insight:screening", code: (err as { code?: unknown })?.code ?? "unknown" }, "[he-drive-insights] fact group failed");
  }
  return f;
}
