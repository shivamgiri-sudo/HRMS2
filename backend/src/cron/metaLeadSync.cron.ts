/**
 * Meta Lead Sync — Scheduled Job
 *
 * Every 30 minutes:
 *   1. Pulls new leads from Meta Graph API for all active campaigns (dedup-safe).
 *   2. Triggers WhatsApp + Email outreach for any qualified lead imported in the
 *      last sync window that has not yet been notified.
 *
 * Outreach is scoped to leads created AFTER CRON_NOTIFY_SINCE (set at scheduler
 * start time) so the Sep-20 backlog of 1,906 pre-existing leads is never touched —
 * those were already handled through a separate channel.
 *
 * No-op when META_MARKETING_ACCESS_TOKEN is not configured.
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { metaCampaignService } from "../modules/meta-campaign/meta-campaign.service.js";
import { isMetaConfigured } from "../modules/meta-campaign/meta-api.client.js";
import { notifyQualifiedLead } from "../modules/meta-campaign/lead-outreach.service.js";

let scheduler: NodeJS.Timeout | undefined;
let runInFlight = false;
const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// Only notify leads created at or after this timestamp — set when the scheduler
// first starts so we never retroactively notify the existing backlog.
let notifySince: Date;

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
  console.log("[meta-sync] Starting lead sync...");

  try {
    // 1. Pull new leads for active campaigns only
    const [activeForms] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT mc.meta_form_id, mc.campaign_name FROM meta_campaign mc
        WHERE mc.campaign_status = 'active'
          AND mc.meta_form_id IS NOT NULL AND mc.meta_form_id <> ''`
    );

    let totalImported = 0;
    let formErrors = 0;
    for (const row of activeForms as any[]) {
      try {
        const result = await metaCampaignService.backfillFormLeads(String(row.meta_form_id));
        totalImported += result.imported;
        if (result.imported > 0) {
          console.log(`[meta-sync] ${result.imported} new lead(s) from "${row.campaign_name}"`);
        }
      } catch (err: any) {
        formErrors++;
        console.error(
          `[meta-sync] Form ${row.meta_form_id} ("${row.campaign_name}") error:`,
          err?.message ?? err
        );
      }
    }
    console.log(
      `[meta-sync] Lead sync complete: ${totalImported} imported across ${(activeForms as any[]).length} active forms, ${formErrors} form errors`
    );

    // 2. Sync campaign metrics (impressions, reach, clicks, spend)
    const metricsResult = await metaCampaignService.syncAllCampaignMetrics();
    if (metricsResult.synced > 0 || metricsResult.failed > 0) {
      console.log(
        `[meta-sync] Metrics sync: ${metricsResult.synced} synced, ${metricsResult.failed} failed`
      );
    }

    // 3. Notify newly qualified leads (only those created after scheduler start)
    //    backfillFormLeads sets skipOutreach=true, so we do outreach here.
    await notifyNewQualifiedLeads();
  } catch (err: any) {
    console.error("[meta-sync] Sync error:", err?.message ?? err);
  } finally {
    runInFlight = false;
    scheduler = undefined;
    scheduleNext();
  }
}

async function notifyNewQualifiedLeads(): Promise<void> {
  const [leads] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM meta_lead_raw
      WHERE screening_result = 'qualified'
        AND notification_sent_at IS NULL
        AND created_at >= ?
      ORDER BY created_at ASC
      LIMIT 100`,
    [notifySince]
  );

  if (!(leads as any[]).length) return;

  console.log(`[meta-sync] Triggering outreach for ${(leads as any[]).length} new qualified lead(s)...`);
  let sent = 0;
  let failed = 0;

  for (const lead of leads as any[]) {
    try {
      await notifyQualifiedLead(lead.id);
      sent++;
    } catch (err: any) {
      failed++;
      console.warn(`[meta-sync] Outreach failed for lead ${lead.id}:`, err?.message ?? err);
    }
  }

  console.log(`[meta-sync] Outreach complete: ${sent} sent, ${failed} failed`);
}

function scheduleNext(): void {
  if (scheduler) return;
  scheduler = setTimeout(runMetaLeadSync, INTERVAL_MS);
  scheduler.unref();
}

export function startMetaLeadSyncScheduler(): void {
  if (scheduler) return;
  // Leads created before this moment belong to the existing backlog — do not notify them.
  notifySince = new Date();
  console.log(`[meta-sync] 30-min Meta lead sync scheduler starting (notifying leads created >= ${notifySince.toISOString()})`);
  runMetaLeadSync();
}

export function stopMetaLeadSyncScheduler(): void {
  if (scheduler) clearTimeout(scheduler);
  scheduler = undefined;
  console.log("[meta-sync] Meta lead sync scheduler stopped");
}
