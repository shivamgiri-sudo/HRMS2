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

// Never notify leads older than this: the Sep-20 backlog (1,906 leads) was handled through a
// separate channel. Within the floor, a rolling window (not process-start time) means a backend
// restart cannot orphan leads that qualified while the process was down.
const NOTIFY_FLOOR = new Date("2026-09-21T00:00:00+05:30");
const NOTIFY_LOOKBACK_MS = 48 * 60 * 60 * 1000;

function notifyWindowStart(now = new Date()): Date {
  return new Date(Math.max(NOTIFY_FLOOR.getTime(), now.getTime() - NOTIFY_LOOKBACK_MS));
}

// Forms on the Page that have no meta_campaign row are invisible to the linked-form poll, so
// their leads never reach HRMS unless the webhook happened to deliver them. Optional: unset = skip.
async function listUnlinkedPageFormIds(linked: Set<string>): Promise<string[]> {
  const pageIds = (process.env.META_PAGE_IDS ?? process.env.META_PAGE_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const unlinked: string[] = [];
  for (const pageId of pageIds) {
    try {
      const forms = await metaCampaignService.listPageForms(pageId);
      for (const f of forms) if (!linked.has(f.id)) unlinked.push(f.id);
    } catch (err: any) {
      console.error(`[meta-sync] Page ${pageId} form discovery failed:`, err?.message ?? err);
    }
  }
  return unlinked;
}

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

    const [allLinked] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT meta_form_id FROM meta_campaign WHERE meta_form_id IS NOT NULL AND meta_form_id <> ''`
    );
    const unlinkedIds = await listUnlinkedPageFormIds(
      new Set((allLinked as any[]).map((r) => String(r.meta_form_id)))
    );
    const formsToPull = [
      ...(activeForms as any[]).map((r) => ({ id: String(r.meta_form_id), name: String(r.campaign_name) })),
      ...unlinkedIds.map((id) => ({ id, name: "unlinked form" })),
    ];

    let totalImported = 0;
    let formErrors = 0;
    for (const form of formsToPull) {
      try {
        const result = await metaCampaignService.backfillFormLeads(form.id);
        totalImported += result.imported;
        if (result.imported > 0) {
          console.log(`[meta-sync] ${result.imported} new lead(s) from "${form.name}" (${form.id})`);
        }
      } catch (err: any) {
        formErrors++;
        console.error(`[meta-sync] Form ${form.id} ("${form.name}") error:`, err?.message ?? err);
      }
    }
    console.log(
      `[meta-sync] Lead sync complete: ${totalImported} imported across ${formsToPull.length} forms (${unlinkedIds.length} unlinked), ${formErrors} form errors`
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
    [notifyWindowStart()]
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
  console.log(`[meta-sync] 30-min Meta lead sync scheduler starting (notifying leads created >= ${notifyWindowStart().toISOString()}, rolling 48h)`);
  runMetaLeadSync();
}

export function stopMetaLeadSyncScheduler(): void {
  if (scheduler) clearTimeout(scheduler);
  scheduler = undefined;
  console.log("[meta-sync] Meta lead sync scheduler stopped");
}
