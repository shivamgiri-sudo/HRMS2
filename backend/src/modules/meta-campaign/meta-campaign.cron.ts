/**
 * META campaign metrics sync — scheduler.
 *
 * Deliberately built to the self-rearming-setTimeout shape already established in this codebase
 * (see modules/analytics/intervention-recommendation.cron.ts and
 * modules/management/daily-brief/daily-brief.cron.ts), NOT node-cron: compute ms until the next
 * HH:mm, setTimeout, unref, reschedule in the finally. Adding a second scheduling mechanism for one
 * job would mean one of them is untested in this deployment.
 *
 * ENV GATES, same convention as its siblings — off by default, no env.ts schema change needed:
 *   - META_CAMPAIGN_SYNC_ENABLED: must be exactly "true", else start...() is a no-op.
 *   - META_CAMPAIGN_SYNC_TIME: "HH:mm" host-local, default "06:00" per the owner's spec. Sits
 *     after midnight so a full previous day is captured, and clear of the 02:00
 *     attendance-reconciliation slot so the two are not competing for the same DB window. An
 *     unparseable value falls back to the default rather than crashing the scheduler.
 *
 * A note on freshness, so the dashboard is not misread: META's own insight figures lag reality by
 * roughly 15-30 minutes for impressions/reach/clicks and up to 24 hours for final spend. Running
 * this more often than daily does not make spend more accurate — it just re-reads a number META has
 * not finalised yet. Lead ARRIVAL is unaffected by this scheduler: leads come in through the
 * webhook within seconds and never wait for this job.
 *
 * Independently of the flag, the sync is a no-op without META_MARKETING_ACCESS_TOKEN — see
 * syncAllCampaignMetrics, which returns zeroes rather than hammering the Graph API with a
 * guaranteed-401. That is why enabling this on an untokened environment is harmless.
 */

import { recordWorkerRun } from '../../workers/worker-utils.js';
import { metaCampaignService } from './meta-campaign.service.js';
import { isMetaConfigured } from './meta-api.client.js';

export const WORKER_NAME = 'meta-campaign-metrics-sync';
const DEFAULT_TIME = '06:00';
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

let nextRun: NodeJS.Timeout | undefined;

function isEnabled(): boolean {
  return process.env.META_CAMPAIGN_SYNC_ENABLED === 'true';
}

export function parseRunTime(value: string | undefined): { hour: number; minute: number } {
  const raw = value && TIME_PATTERN.test(value) ? value : DEFAULT_TIME;
  const [hourStr, minuteStr] = raw.split(':');
  return { hour: Number(hourStr), minute: Number(minuteStr) };
}

export function millisecondsUntilNextMetaSyncRun(now = new Date()): number {
  const { hour, minute } = parseRunTime(process.env.META_CAMPAIGN_SYNC_TIME);
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export interface MetaSyncRunSummary {
  synced: number;
  failed: number;
  skipped: number;
  metaConfigured: boolean;
}

export async function runMetaCampaignMetricsSync(): Promise<MetaSyncRunSummary> {
  const startedAt = Date.now();
  console.log(`[${WORKER_NAME}] run start`);
  await recordWorkerRun(WORKER_NAME, 'started', {});

  if (!isMetaConfigured()) {
    const summary: MetaSyncRunSummary = { synced: 0, failed: 0, skipped: 0, metaConfigured: false };
    console.log(`[${WORKER_NAME}] skipped — META_MARKETING_ACCESS_TOKEN is not configured`);
    await recordWorkerRun(WORKER_NAME, 'completed', { ...summary, elapsedMs: Date.now() - startedAt });
    return summary;
  }

  try {
    const result = await metaCampaignService.syncAllCampaignMetrics();
    const summary: MetaSyncRunSummary = { ...result, metaConfigured: true };
    const elapsedMs = Date.now() - startedAt;
    console.log(`[${WORKER_NAME}] run end elapsedMs=${elapsedMs} synced=${summary.synced} failed=${summary.failed}`);
    await recordWorkerRun(WORKER_NAME, 'completed', { ...summary, elapsedMs });
    return summary;
  } catch (error) {
    console.error(`[${WORKER_NAME}] run failed`, error instanceof Error ? error.message : String(error));
    await recordWorkerRun(WORKER_NAME, 'failed', {
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt,
    });
    throw error;
  }
}

export function startMetaCampaignSyncScheduler(): void {
  if (!isEnabled()) {
    console.log(`[${WORKER_NAME}] disabled (set META_CAMPAIGN_SYNC_ENABLED=true to enable)`);
    return;
  }
  if (nextRun) return;

  const scheduleNext = () => {
    nextRun = setTimeout(async () => {
      try {
        await runMetaCampaignMetricsSync();
      } catch (error) {
        console.error(`[${WORKER_NAME}] scheduled run failed`, error instanceof Error ? error.message : String(error));
      } finally {
        nextRun = undefined;
        scheduleNext();
      }
    }, millisecondsUntilNextMetaSyncRun());
    nextRun.unref();
  };

  scheduleNext();
  const { hour, minute } = parseRunTime(process.env.META_CAMPAIGN_SYNC_TIME);
  console.log(
    `[${WORKER_NAME}] scheduled daily at ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  );
}

export function stopMetaCampaignSyncScheduler(): void {
  if (!nextRun) return;
  clearTimeout(nextRun);
  nextRun = undefined;
}
