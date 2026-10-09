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
import { enrolMetaArrival } from "../modules/selection/meta-arrival.service.js";
import { readSyncStatus, safeErrorCode, writeSyncStatus, type SyncStatusRecord } from "../modules/meta-campaign/meta-sync-status.store.js";

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
let lastRecord: SyncStatusRecord | null = null;

/** Outcome (ok or error) of the latest cycle in this process; the health strip also reads the persisted copy after a restart. */
export function getLastMetaSyncRecord(): SyncStatusRecord | null {
  return lastRecord;
}

async function recordOutcome(rec: Omit<SyncStatusRecord, "lastOkAt">): Promise<void> {
  // after a restart the in-memory copy is empty: carry the last good time over from the persisted one
  const prev = rec.ok ? null : lastRecord ?? (await readSyncStatus());
  const lastOkAt = rec.ok ? rec.finishedAt : prev?.lastOkAt ?? null;
  lastRecord = { ...rec, lastOkAt };
  await writeSyncStatus(lastRecord);
}

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

    // (No WhatsApp delivery reconcile here any more: it polled the retired Wassenger gateway. Pinbot is the only WhatsApp provider
    //  (owner decision O7) and its delivery receipts arrive through the Pinbot webhook onto he_message; intentional, 34098ec7a.)
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
    await recordOutcome({ finishedAt: summary.finishedAt, ok: true, imported: totalImported, forms: formsToPull.length, formErrors, errorCode: null });
    return { status: "ok", summary };
  } catch (err: any) {
    console.error("[meta-sync] Sync error:", err?.message ?? err);
    await recordOutcome({ finishedAt: new Date().toISOString(), ok: false, imported: 0, forms: 0, formErrors: 0, errorCode: safeErrorCode(err) });
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

// Leads the follow-up method owns (a live / canary row, open or stopped) are never re-selected, whatever the mode (row-based).
const OWNED_ROW_SKIP = `
        AND NOT EXISTS (SELECT 1 FROM qualified_followup qf
                         WHERE qf.mode_at_enqueue IN ('live','canary')
                           AND (qf.meta_lead_id = meta_lead_raw.id COLLATE utf8mb4_unicode_ci
                                OR (qf.mobile10 = RIGHT(REGEXP_REPLACE(meta_lead_raw.parsed_phone, '[^0-9]', ''), 10) COLLATE utf8mb4_unicode_ci
                                    AND qf.requisition_id = meta_lead_raw.requisition_id COLLATE utf8mb4_unicode_ci)))`;

/** A backfill import (skipOutreach) stores leads Meta created long before: never messaged by the safety net. */
const BACKFILL_AGE_MS = 2 * 86_400_000;
const META_CREATED = `JSON_UNQUOTE(JSON_EXTRACT(meta_lead_raw.raw_payload, '$.created_time'))`;
// Meta's created_time ("2026-10-07T10:00:00+0000") in UTC; a missing / odd offset reads as UTC, an unparsable value as NULL (not a backfill).
const META_CREATED_UTC = `CONVERT_TZ(STR_TO_DATE(LEFT(${META_CREATED}, 19), '%Y-%m-%dT%H:%i:%s'), IF(${META_CREATED} REGEXP '[+-][0-9]{4}$', CONCAT(SUBSTRING(${META_CREATED}, -5, 3), ':', RIGHT(${META_CREATED}, 2)), '+00:00'), '+00:00')`;
const leadSelect = (filter: string): string => `SELECT id,
            (SELECT JSON_EXTRACT(jr.meta_screening_config, '$.auto_notify') = CAST('false' AS JSON) FROM job_requisition jr WHERE jr.id = meta_lead_raw.requisition_id) AS auto_notify_off,
            ${META_CREATED_UTC} < ? AS is_backfill
       FROM meta_lead_raw
      WHERE screening_result = 'qualified'
        AND notification_sent_at IS NULL
        AND created_at >= ?${OWNED_ROW_SKIP}${filter}
      ORDER BY created_at ASC
      LIMIT 100`;
const utcCutoff = (now: number): string => new Date(now - BACKFILL_AGE_MS).toISOString().slice(0, 19).replace("T", " ");

export async function notifyNewQualifiedLeads(): Promise<{ sent: number; skipped: number; failed: number }> {
  const params = [utcCutoff(Date.now()), notifyWindowStart()];
  // auto_notify off on the requisition, or a backfill import, are never messaged from here and keep notification_sent_at NULL, so
  // they are selected apart: they must not fill the LIMIT and starve newer leads. Their own pass skips anyone already enrolled.
  const [held] = await db.execute<RowDataPacket[]>(leadSelect(`
        AND NOT EXISTS (SELECT 1 FROM qualified_followup q2 WHERE q2.meta_lead_id = meta_lead_raw.id COLLATE utf8mb4_unicode_ci)
     HAVING (auto_notify_off = 1 OR is_backfill = 1)`), params);
  const [leads] = await db.execute<RowDataPacket[]>(leadSelect(`
     HAVING COALESCE(auto_notify_off, 0) = 0 AND COALESCE(is_backfill, 0) = 0`), params);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  // Enrolled held for HR when the source runs (D13); never messaged here.
  for (const lead of held as any[]) {
    const autoOff = Number(lead.auto_notify_off) === 1;
    await enrolMetaArrival(lead.id, { skipOutreach: !autoOff }).catch(() => null);
    skipped++;
  }

  if (!(leads as any[]).length) return { sent, skipped, failed };

  console.log(`[meta-sync] Triggering outreach for ${(leads as any[]).length} new qualified lead(s)...`);
  for (const lead of leads as any[]) {
    try {
      // notifyQualifiedLead decides per source mode: owned / Live Meta run by the method -> enrolled, not messaged here.
      // It reports refusals/skips in its outcome instead of throwing, so count by what actually landed.
      const outcome = await notifyQualifiedLead(lead.id, { sourcePath: 'legacy_meta_sync' });
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
