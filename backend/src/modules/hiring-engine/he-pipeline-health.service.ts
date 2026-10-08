/** Collects a HealthSnapshot (each probe isolated; a failing source never throws) and caches the result 60 s. */
import axios from "axios";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getLastMetaSyncRecord, getLastMetaSyncSummary } from "../../cron/metaLeadSync.cron.js";
import { newerRecord, readSyncStatus, type SyncStatusRecord } from "../meta-campaign/meta-sync-status.store.js";
import { isMetaConfigured } from "../meta-campaign/meta-api.client.js";
import { getPinbotQuality } from "./he-pinbot-quality.service.js";
import { computeLeadIntake, evaluateHealth, overallLevel, type HealthCheck, type HealthLevel, type HealthSnapshot } from "./he-pipeline-health.js";

const SNAPSHOT_TTL_MS = 60_000;
const TOKEN_TTL_MS = 10 * 60_000;
const PROBE_TIMEOUT_MS = 8_000;

let tokenCache: { at: number; valid: boolean | null } | null = null;

/** 2xx -> true; Graph error code 190 (invalid/expired token) -> false; anything else (rate limits, other 4xx/5xx, no response) -> null. */
export function tokenValidFromProbe(status: number | null, errorCode: number | null): boolean | null {
  if (status !== null && status >= 200 && status < 300) return true;
  if (errorCode === 190) return false;
  return null;
}

async function probeToken(): Promise<boolean | null> {
  if (tokenCache && Date.now() - tokenCache.at < TOKEN_TTL_MS) return tokenCache.valid;
  let valid: boolean | null = null;
  try {
    const token = process.env.META_MARKETING_ACCESS_TOKEN ?? "";
    if (!token) valid = null;
    else {
      const version = process.env.META_GRAPH_API_VERSION || "v19.0";
      const res = await axios.get(`https://graph.facebook.com/${version}/me`, {
        params: { access_token: token }, timeout: PROBE_TIMEOUT_MS, validateStatus: () => true,
      });
      // keep only the status and the numeric Graph error code; body and token are never stored or logged
      const code = Number((res.data as { error?: { code?: unknown } } | undefined)?.error?.code);
      valid = tokenValidFromProbe(res.status, Number.isFinite(code) ? code : null);
    }
  } catch { valid = null; }
  tokenCache = { at: Date.now(), valid };
  return valid;
}

async function safe<T>(fn: () => Promise<T> | T, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

/**
 * schedulerRunning: no exported start flag exists, so it is true when this process has a sync summary, or when
 * server.ts would have started the Meta sync here (ENABLE_SCHEDULERS=true, or WORKERS_PROCESS=external which
 * starts the Meta sync even with schedulers disabled).
 */
function schedulerLikelyRunning(hasSummary: boolean): boolean {
  return hasSummary || process.env.ENABLE_SCHEDULERS === "true" || process.env.WORKERS_PROCESS === "external";
}

export async function collectHealthSnapshot(): Promise<HealthSnapshot> {
  // Latest cycle outcome: the persisted row survives restarts; the in-memory record covers a failed write.
  const memRecord = await safe(() => getLastMetaSyncRecord(), null as SyncStatusRecord | null);
  const memSummary = await safe(() => getLastMetaSyncSummary(), null);
  const record = newerRecord(await safe(() => readSyncStatus(), null as SyncStatusRecord | null), memRecord)
    ?? (memSummary ? { finishedAt: memSummary.finishedAt, ok: true, imported: memSummary.imported, forms: memSummary.forms, formErrors: memSummary.formErrors, errorCode: null, lastOkAt: memSummary.finishedAt } : null);
  const metaConfigured = await safe(() => isMetaConfigured(), false);
  const tokenValid = metaConfigured ? await safe(probeToken, null) : null;

  // Meta's own lead time (created_time inside raw_payload) is preferred over created_at, which is import time.
  // created_at >= created_time, so a 16-day created_at window is a superset of every lead that can matter.
  const leads = await safe(async () => {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT created_at, JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.created_time')) AS meta_time
         FROM meta_lead_raw WHERE created_at >= NOW() - INTERVAL 16 DAY`);
    const [last] = await db.query<RowDataPacket[]>("SELECT MAX(created_at) AS last_at FROM meta_lead_raw");
    const r = computeLeadIntake((rows ?? []).map((x) => ({ createdAt: new Date(x.created_at), metaCreatedTime: x.meta_time ?? null })));
    return {
      lastLeadAt: r.lastLeadAt ?? (last?.[0]?.last_at ? new Date(last[0].last_at) : null),
      leadsLast24h: r.leadsLast24h as number | null,
      avg: r.avgPerDay as number | null,
    };
  }, { lastLeadAt: null as Date | null, leadsLast24h: null as number | null, avg: null as number | null });

  const wa = await safe(async () => {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT SUM(delivery_status = 'failed') AS failed, SUM(delivery_status IS NULL OR delivery_status <> 'failed') AS sent
         FROM he_message WHERE direction = 'out' AND channel = 'whatsapp' AND created_at >= NOW() - INTERVAL 24 HOUR`);
    return { failed: Number(rows?.[0]?.failed ?? 0), sent: Number(rows?.[0]?.sent ?? 0) } as { failed: number | null; sent: number | null };
  }, { failed: null, sent: null } as { failed: number | null; sent: number | null });

  const overdue = await safe(async () => {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM qualified_followup
        WHERE stopped_reason IS NULL AND mode_at_enqueue = 'live' AND wa_due_at < NOW() - INTERVAL 30 MINUTE AND wa_sent_at IS NULL`);
    return Number(rows?.[0]?.n ?? 0) as number | null;
  }, null as number | null);

  const inbound = await safe(async () => {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM he_message
        WHERE direction = 'in' AND channel = 'whatsapp' AND created_at >= NOW() - INTERVAL 24 HOUR`);
    return Number(rows?.[0]?.n ?? 0) as number | null;
  }, null as number | null);

  const pinbotQuality = await safe(getPinbotQuality, null);

  return {
    metaConfigured,
    tokenValid,
    lastLeadAt: leads.lastLeadAt,
    leadsLast24h: leads.leadsLast24h,
    avgLeadsPerDay14d: leads.avg,
    lastSyncFinishedAt: record ? new Date(record.finishedAt) : null,
    lastSyncOk: record ? record.ok : null,
    lastSyncErrorCode: record?.errorCode ?? null,
    lastSyncOkAt: record?.lastOkAt ? new Date(record.lastOkAt) : null,
    lastSyncImported: record ? record.imported : null,
    formErrorsLastRun: record && record.ok ? record.formErrors : null,
    schedulerRunning: schedulerLikelyRunning(record !== null),
    whatsappFailed24h: wa.failed,
    whatsappSent24h: wa.sent,
    followupOverdue: overdue,
    pinbotQuality,
    inboundWa24h: inbound,
  };
}

export interface PipelineHealth { generatedAt: string; level: HealthLevel; checks: HealthCheck[] }
let cache: { at: number; value: PipelineHealth } | null = null;

export async function getPipelineHealth(): Promise<PipelineHealth> {
  if (cache && Date.now() - cache.at < SNAPSHOT_TTL_MS) return cache.value;
  const now = new Date();
  const checks = evaluateHealth(await collectHealthSnapshot(), now);
  const value = { generatedAt: now.toISOString(), level: overallLevel(checks), checks };
  cache = { at: Date.now(), value };
  return value;
}
