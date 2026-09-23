/**
 * Meta Lead Sync — Scheduled Job
 *
 * Runs every hour to pull new leads from Meta Graph API for all active campaigns
 * and sync campaign metrics (impressions, reach, clicks, spend).
 *
 * Uses the same self-rescheduling setTimeout pattern as other crons in this dir.
 *
 * Rationale: webhooks are the real-time path, but they depend on Meta's subscription
 * staying healthy. This hourly pull acts as a safety net so leads are never more than
 * 1 hour stale even when webhooks pause, expire, or are misconfigured.
 *
 * backfillAllLinkedForms() is idempotent — it skips any lead whose meta_lead_id already
 * exists in meta_lead_raw, so re-running is safe and cheap when there are no new leads.
 *
 * No-op when META_MARKETING_ACCESS_TOKEN is not configured.
 */

import { metaCampaignService } from "../modules/meta-campaign/meta-campaign.service.js";
import { isMetaConfigured } from "../modules/meta-campaign/meta-api.client.js";

let scheduler: NodeJS.Timeout | undefined;
let runInFlight = false;
const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

async function runMetaLeadSync(): Promise<void> {
  if (!isMetaConfigured()) {
    scheduler = undefined;
    scheduleNext();
    return;
  }

  if (runInFlight) {
    console.warn("[meta-sync] already in flight, skipping this tick");
    scheduler = undefined;
    scheduleNext();
    return;
  }

  runInFlight = true;
  console.log("[meta-sync] Starting hourly lead sync...");

  try {
    // Pull new leads from all linked forms (deduplicates automatically)
    const leadResult = await metaCampaignService.backfillAllLinkedForms();
    console.log(
      `[meta-sync] Lead sync complete: ${leadResult.totalImported} new leads imported across ${leadResult.forms.length} forms`
    );

    // Sync campaign metrics (impressions, reach, clicks, spend)
    const metricsResult = await metaCampaignService.syncAllCampaignMetrics();
    console.log(
      `[meta-sync] Metrics sync complete: ${metricsResult.synced} synced, ${metricsResult.failed} failed`
    );
  } catch (err: any) {
    console.error("[meta-sync] Sync error:", err?.message ?? err);
  } finally {
    runInFlight = false;
    scheduler = undefined;
    scheduleNext();
  }
}

function scheduleNext(): void {
  if (scheduler) return;
  scheduler = setTimeout(runMetaLeadSync, INTERVAL_MS);
  scheduler.unref();
}

export function startMetaLeadSyncScheduler(): void {
  if (scheduler) return;
  console.log("[meta-sync] Hourly Meta lead sync scheduler starting");
  // Run once immediately on startup (catches any leads missed since last deploy),
  // then every hour after that.
  runMetaLeadSync();
}

export function stopMetaLeadSyncScheduler(): void {
  if (scheduler) clearTimeout(scheduler);
  scheduler = undefined;
  console.log("[meta-sync] Hourly Meta lead sync scheduler stopped");
}
