/** Collects a HealthSnapshot (each probe isolated; a failing source never throws) and caches the result 60 s. */
import axios from "axios";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getLastMetaSyncSummary } from "../../cron/metaLeadSync.cron.js";
import { isMetaConfigured } from "../meta-campaign/meta-api.client.js";
import { evaluateHealth, overallLevel, type HealthCheck, type HealthLevel, type HealthSnapshot } from "./he-pipeline-health.js";

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
  const summary = await safe(() => getLastMetaSyncSummary(), null);
  const metaConfigured = await safe(() => isMetaConfigured(), false);
  const tokenValid = metaConfigured ? await safe(probeToken, null) : null;

  const leads = await safe(async () => {
    const [last] = await db.query<RowDataPacket[]>("SELECT MAX(created_at) AS last_at FROM meta_lead_raw");
    const [h24] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM meta_lead_raw WHERE created_at >= NOW() - INTERVAL 24 HOUR");
    const [prev] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM meta_lead_raw
        WHERE created_at >= NOW() - INTERVAL 15 DAY AND created_at < NOW() - INTERVAL 1 DAY`);
    return {
      lastLeadAt: last?.[0]?.last_at ? new Date(last[0].last_at) : null,
      leadsLast24h: Number(h24?.[0]?.n ?? 0),
      avg: Number(prev?.[0]?.n ?? 0) / 14, // zero-filled: total over the 14 days divided by 14
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

  return {
    metaConfigured,
    tokenValid,
    lastLeadAt: leads.lastLeadAt,
    leadsLast24h: leads.leadsLast24h,
    avgLeadsPerDay14d: leads.avg,
    lastSyncFinishedAt: summary ? new Date(summary.finishedAt) : null,
    lastSyncImported: summary ? summary.imported : null,
    formErrorsLastRun: summary ? summary.formErrors : null,
    schedulerRunning: schedulerLikelyRunning(summary !== null),
    whatsappFailed24h: wa.failed,
    whatsappSent24h: wa.sent,
    followupOverdue: overdue,
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
