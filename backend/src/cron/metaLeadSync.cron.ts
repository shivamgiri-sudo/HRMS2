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
import { reconcileDeliveryStatuses } from "../modules/meta-campaign/meta-messages.service.js";
import { enqueueMetaLeadFollowup } from "../modules/hiring-engine/qualified-followup.service.js";
import { pipelineOwnsSends } from "../modules/hiring-engine/qualified-followup.policy.js";

let scheduler: NodeJS.Timeout | undefined;
let runInFlight = false;
const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes (webhook real-time sync is off; this pull is the only intake)

// Never notify leads older than this: the Sep-20 backlog (1,906 leads) was handled through a
// separate channel. Within the floor, a rolling window (not process-start time) means a backend
// restart cannot orphan leads that qualified while the process was down.
const NOTIFY_FLOOR = new Date("2026-09-21T00:00:00+05:30");
const NOTIFY_LOOKBACK_MS = 48 * 60 * 60 * 1000;

/*
 * A form Meta answers with "(#100) Tried accessing nonexisting field (leads)" is not a lead form
 * this token can read (deleted, or the id is not a Lead Gen form). Retrying it every cycle only
 * repeated the same error in the log forever, so it is parked for a day and logged once.
 */
const FORM_PARK_MS = 24 * 60 * 60 * 1000;
const parkedForms = new Map<string, number>();

export function isFormParked(formId: string, now = Date.now()): boolean {
  const until = parkedForms.get(formId);
  if (until === undefined) return false;
  if (until <= now) { parkedForms.delete(formId); return false; }
  return true;
}

/** Returns true when the error parked the form (first time only), so the caller logs it once. */
export function parkFormOnPermanentError(formId: string, message: string, now = Date.now()): boolean {
  if (!/\(#100\)/.test(message)) return false;
  if (isFormParked(formId, now)) return false;
  parkedForms.set(formId, now + FORM_PARK_MS);
  return true;
}

export function _resetParkedFormsForTest(): void { parkedForms.clear(); }

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

export interface MetaSyncSummary {
  startedAt: string;
  finishedAt: string;
  imported: number;
  forms: number;
  formErrors: number;
  parkedSkipped: number;
  outreach: { sent: number; skipped: number; failed: number };
}

export type MetaSyncNowResult =
  | { status: "ok"; summary: MetaSyncSummary }
  | { status: "not_configured" }
  | { status: "in_flight" }
  | { status: "error"; message: string };

let lastSummary: MetaSyncSummary | null = null;

/** Result of the most recent completed run (scheduled or manual) in this process, for the UI. */
export function getLastMetaSyncSummary(): MetaSyncSummary | null {
  return lastSummary;
}

/**
 * One full sync cycle, shared by the scheduler and the manual "Sync now" button so both do exactly
 * the same work and honour the same in-flight guard (a manual click during a scheduled run is told
 * to wait, never doubled up).
 */
async function runSyncCycle(): Promise<MetaSyncNowResult> {
  if (!isMetaConfigured()) return { status: "not_configured" };
  if (runInFlight) return { status: "in_flight" };

  runInFlight = true;
  const startedAt = new Date().toISOString();
  console.log("[meta-sync] Starting lead sync...");

  try {
    // 1. Pull new leads for active campaigns only
    const [activeForms] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT mc.meta_form_id, mc.campaign_name FROM meta_campaign mc
        WHERE mc.campaign_status IN ('active', 'draft')
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
    let parkedSkipped = 0;
    for (const form of formsToPull) {
      if (isFormParked(form.id)) { parkedSkipped++; continue; }
      try {
        const result = await metaCampaignService.backfillFormLeads(form.id);
        totalImported += result.imported;
        if (result.imported > 0) {
          console.log(`[meta-sync] ${result.imported} new lead(s) from "${form.name}" (${form.id})`);
        }
      } catch (err: any) {
        formErrors++;
        const message = String(err?.message ?? err);
        if (parkFormOnPermanentError(form.id, message)) {
          console.error(`[meta-sync] Form ${form.id} ("${form.name}") is not readable as a lead form; skipping it for 24h: ${message}`);
        } else {
          console.error(`[meta-sync] Form ${form.id} ("${form.name}") error:`, message);
        }
      }
    }
    console.log(
      `[meta-sync] Lead sync complete: ${totalImported} imported across ${formsToPull.length} forms (${unlinkedIds.length} unlinked), ${formErrors} form errors, ${parkedSkipped} parked form(s) skipped`
    );

    // 2. Sync campaign metrics (impressions, reach, clicks, spend)
    const metricsResult = await metaCampaignService.syncAllCampaignMetrics();
    if (metricsResult.synced > 0 || metricsResult.failed > 0) {
      console.log(
        `[meta-sync] Metrics sync: ${metricsResult.synced} synced, ${metricsResult.failed} failed`
      );
    }

    // 3. Heal leads the webhook/backfill left half-synced (Graph-fetch stubs, qualified leads with
    //    no ATS candidate) so they are complete before outreach.
    try {
      const healed = await metaCampaignService.healUnsyncedLeads();
      if (healed.candidatesCreated || healed.stubsRetried) {
        console.log(
          `[meta-sync] Heal: ${healed.candidatesCreated} candidate(s) created, ${healed.stubsHealed}/${healed.stubsRetried} stub(s) recovered`
        );
      }
    } catch (err: any) {
      console.error("[meta-sync] Heal step failed:", err?.message ?? err);
    }

    // 3b. Reconcile WhatsApp delivery states. A message Wassenger merely queued is not delivered;
    //     a growing "still queued" count means Wassenger's device/queue is stuck.
    try {
      const wa = await reconcileDeliveryStatuses();
      if (wa.checked) {
        const msg = `[meta-sync] WhatsApp delivery: ${wa.checked} checked, ${wa.updated} updated, ${wa.stillQueued} still queued`;
        if (wa.stillQueued > 0) console.warn(`${msg} — Wassenger queue may be stuck`);
        else console.log(msg);
      }
    } catch (err: any) {
      console.error("[meta-sync] Delivery reconcile failed:", err?.message ?? err);
    }

    // 4. Notify newly qualified leads within the rolling window.
    //    backfillFormLeads sets skipOutreach=true, so we do outreach here.
    const outreach = await notifyNewQualifiedLeads();

    const summary: MetaSyncSummary = {
      startedAt,
      finishedAt: new Date().toISOString(),
      imported: totalImported,
      forms: formsToPull.length,
      formErrors,
      parkedSkipped,
      outreach,
    };
    lastSummary = summary;
    return { status: "ok", summary };
  } catch (err: any) {
    console.error("[meta-sync] Sync error:", err?.message ?? err);
    return { status: "error", message: String(err?.message ?? err) };
  } finally {
    runInFlight = false;
  }
}

async function runMetaLeadSync(): Promise<void> {
  const result = await runSyncCycle();
  if (result.status === "in_flight") console.warn("[meta-sync] already in flight, skipping this tick");
  scheduler = undefined;
  scheduleNext();
}

/** Manual trigger (UI "Sync now"). Does not touch the schedule: the next tick stays where it was. */
export async function runMetaLeadSyncNow(): Promise<MetaSyncNowResult> {
  return runSyncCycle();
}

export async function notifyNewQualifiedLeads(): Promise<{ sent: number; skipped: number; failed: number }> {
  const [leads] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM meta_lead_raw
      WHERE screening_result = 'qualified'
        AND notification_sent_at IS NULL
        AND created_at >= ?
      ORDER BY created_at ASC
      LIMIT 100`,
    [notifyWindowStart()]
  );

  if (!(leads as any[]).length) return { sent: 0, skipped: 0, failed: 0 };

  console.log(`[meta-sync] Triggering outreach for ${(leads as any[]).length} new qualified lead(s)...`);
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const lead of leads as any[]) {
    try {
      // Live pipeline: enqueue first; an enqueued or already-enrolled lead is handed over and not messaged from here. Any other
      // result (invalid, not_qualified, a throw) falls through to the old flow, whose own guard fails closed on a lookup error.
      if (pipelineOwnsSends()) {
        const enq = await enqueueMetaLeadFollowup(lead.id, "live").catch(() => null);
        if (enq && (enq.status === "enqueued" || enq.status === "exists")) {
          skipped++;
          console.log(`[meta-sync] Lead ${lead.id} handed to the follow-up pipeline (${enq.status})`);
          continue;
        }
      }
      // notifyQualifiedLead reports refusals/skips in its outcome instead of throwing, so count
      // by what actually landed. Counting every non-throw as "sent" hid leads that never got a message.
      const outcome = await notifyQualifiedLead(lead.id);
      if (outcome.succeeded.length > 0) sent++;
      else skipped++;
      for (const s of outcome.skipped) {
        console.warn(`[meta-sync] Lead ${lead.id} ${s.channel} skipped: ${s.reason}`);
      }
      for (const f of outcome.failed) {
        console.warn(`[meta-sync] Lead ${lead.id} ${f.channel} failed: ${f.error}`);
      }
    } catch (err: any) {
      failed++;
      console.warn(`[meta-sync] Outreach failed for lead ${lead.id}:`, err?.message ?? err);
    }
  }

  console.log(`[meta-sync] Outreach complete: ${sent} delivered, ${skipped} nothing sent (see skip reasons above), ${failed} errored`);
  return { sent, skipped, failed };
}

function scheduleNext(): void {
  if (scheduler) return;
  scheduler = setTimeout(runMetaLeadSync, INTERVAL_MS);
  scheduler.unref();
}

export function startMetaLeadSyncScheduler(): void {
  if (scheduler) return;
  console.log(`[meta-sync] 30-minute Meta lead sync scheduler starting (notifying leads created >= ${notifyWindowStart().toISOString()}, rolling 48h)`);
  runMetaLeadSync();
}

export function stopMetaLeadSyncScheduler(): void {
  if (scheduler) clearTimeout(scheduler);
  scheduler = undefined;
  console.log("[meta-sync] Meta lead sync scheduler stopped");
}
