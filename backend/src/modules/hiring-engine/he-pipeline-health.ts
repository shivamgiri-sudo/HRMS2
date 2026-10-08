/** Pure pipeline-health rules. No I/O; `now` is a parameter. Output carries counts, timestamps and labels only. */
import type { PinbotQuality } from "./qualified-followup.rules.js";

export type HealthLevel = "ok" | "warn" | "critical";
export interface HealthCheck { key: string; label: string; level: HealthLevel; detail: string }
export interface HealthSnapshot {
  metaConfigured: boolean;
  tokenValid: boolean | null;
  lastLeadAt: Date | null;
  leadsLast24h: number | null;
  avgLeadsPerDay14d: number | null;
  lastSyncFinishedAt: Date | null;
  /** Optional: undefined/null = unknown (treated as ok when a sync time exists). false = the latest cycle errored. */
  lastSyncOk?: boolean | null;
  lastSyncErrorCode?: string | null;
  /** Finish time of the latest successful cycle, when known. */
  lastSyncOkAt?: Date | null;
  lastSyncImported: number | null;
  formErrorsLastRun: number | null;
  schedulerRunning: boolean;
  whatsappFailed24h: number | null;
  whatsappSent24h: number | null;
  followupOverdue: number | null;
  /** Optional: undefined = not collected (no check); null = probe failed (unknown, warns). */
  pinbotQuality?: PinbotQuality | null;
  inboundWa24h?: number | null;
}

export const MIN_AVG_LEADS_FOR_ALERT = 3;
export const LEAD_DROP_WARN_RATIO = 0.3;
export const SYNC_STALE_MS = 3 * 60 * 60 * 1000;
export const WA_MIN_VOLUME = 20;
export const WA_CRITICAL_FAIL_SHARE = 0.5;
export const WA_WARN_FAIL_SHARE = 0.2;

const DAY_MS = 24 * 60 * 60 * 1000;
const BASELINE_DAYS = 14;
/** A day with more than this multiple of the median is treated as a backfill/import spike and ignored. */
export const BACKFILL_SPIKE_RATIO = 3;

export interface LeadTimeRow { createdAt: Date; metaCreatedTime?: string | number | null }

/** Lead time = Meta's own created_time when present and sane (not in the future), else our import time. */
export function effectiveLeadTime(row: LeadTimeRow, now: Date = new Date()): Date | null {
  const m = row.metaCreatedTime;
  if (m !== null && m !== undefined && m !== "") {
    let ms = NaN;
    if (typeof m === "number") ms = m < 1e11 ? m * 1000 : m;
    else if (/^\d+$/.test(m)) { const n = Number(m); ms = n < 1e11 ? n * 1000 : n; }
    else ms = Date.parse(m.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    if (Number.isFinite(ms) && ms <= now.getTime()) return new Date(ms);
  }
  return row.createdAt instanceof Date && Number.isFinite(row.createdAt.getTime()) ? row.createdAt : null;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Robust lead-intake numbers. Buckets are rolling 24 h days back from `now`: bucket 0 is the last 24 h, buckets 1..14
 * are the 14 days before it. Baseline = median of the non-zero days after dropping days above 3x that median
 * (backfill spikes). Zero days are ignored on purpose: an outage gap cannot be told from a quiet day. No non-zero day = 0.
 */
export function computeLeadIntake(rows: LeadTimeRow[], now: Date = new Date()): { lastLeadAt: Date | null; leadsLast24h: number; avgPerDay: number } {
  const counts = new Array<number>(BASELINE_DAYS + 1).fill(0);
  let lastLeadAt: Date | null = null;
  for (const r of rows) {
    const t = effectiveLeadTime(r, now);
    if (!t) continue;
    const age = now.getTime() - t.getTime();
    if (age < 0 || age >= (BASELINE_DAYS + 1) * DAY_MS) continue;
    counts[Math.floor(age / DAY_MS)]++;
    if (!lastLeadAt || t > lastLeadAt) lastLeadAt = t;
  }
  const nonZero = counts.slice(1).filter((n) => n > 0);
  if (nonZero.length === 0) return { lastLeadAt, leadsLast24h: counts[0], avgPerDay: 0 };
  const m0 = median(nonZero);
  const kept = nonZero.filter((n) => n <= BACKFILL_SPIKE_RATIO * m0);
  return { lastLeadAt, leadsLast24h: counts[0], avgPerDay: median(kept) };
}

const RANK: Record<HealthLevel, number> = { ok: 0, warn: 1, critical: 2 };

function ageText(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function evaluateHealth(s: HealthSnapshot, now: Date = new Date()): HealthCheck[] {
  const checks: HealthCheck[] = [];
  const add = (key: string, label: string, level: HealthLevel, detail: string) => checks.push({ key, label, level, detail });

  add("meta_configured", "Meta configured", s.metaConfigured ? "ok" : "critical",
    s.metaConfigured ? "Meta access token is set" : "Meta access token is not set; no leads can be pulled");

  add("token", "Meta token valid",
    s.tokenValid === false ? "critical" : s.tokenValid === true ? "ok" : "warn",
    s.tokenValid === false ? "Meta rejected the token" : s.tokenValid === true ? "Meta accepted the token" : "Token check unavailable");

  let leadLevel: HealthLevel = "ok";
  let leadDetail: string;
  if (s.leadsLast24h === null || s.avgLeadsPerDay14d === null) {
    leadLevel = "critical";
    leadDetail = "Could not read lead counts from the database";
  } else {
    const avg = s.avgLeadsPerDay14d;
    if (avg >= MIN_AVG_LEADS_FOR_ALERT) {
      if (s.leadsLast24h === 0) leadLevel = "critical";
      else if (s.leadsLast24h < LEAD_DROP_WARN_RATIO * avg) leadLevel = "warn";
    }
    leadDetail = `${s.leadsLast24h} leads in last 24 h vs ${avg.toFixed(1)}/day over previous 14 days`
      + (s.lastLeadAt ? `; last lead ${ageText(now.getTime() - s.lastLeadAt.getTime())} ago` : "; no lead on record");
  }
  add("lead_intake", "Lead intake", leadLevel, leadDetail);

  let syncLevel: HealthLevel = "ok";
  let syncDetail: string;
  if (s.lastSyncFinishedAt && s.lastSyncOk === false) {
    // the latest cycle errored: never "no sync recorded"; warn while a good sync is recent, critical once none for 3 h
    const okAge = s.lastSyncOkAt ? now.getTime() - s.lastSyncOkAt.getTime() : null;
    syncLevel = okAge !== null && okAge <= SYNC_STALE_MS ? "warn" : "critical";
    syncDetail = `Last sync failed ${ageText(now.getTime() - s.lastSyncFinishedAt.getTime())} ago`
      + (s.lastSyncErrorCode ? ` (${s.lastSyncErrorCode})` : "")
      + (okAge !== null ? `; last good sync ${ageText(okAge)} ago` : "; no good sync on record");
  } else if (s.lastSyncFinishedAt) {
    const age = now.getTime() - s.lastSyncFinishedAt.getTime();
    syncDetail = `Last sync finished ${ageText(age)} ago`;
    if (!s.schedulerRunning) { syncLevel = "warn"; syncDetail += "; scheduler not running in this process"; }
    else if (age > SYNC_STALE_MS) syncLevel = "critical";
  } else {
    syncLevel = "warn";
    syncDetail = s.schedulerRunning ? "No sync recorded since restart" : "No sync recorded; scheduler not running in this process";
  }
  add("sync_recent", "Meta sync recent", syncLevel, syncDetail);

  const fe = s.formErrorsLastRun;
  add("form_errors", "Form errors", fe !== null && fe > 0 ? "warn" : "ok",
    fe === null ? "Unknown since restart" : `${fe} form error(s) in last sync`);

  if (s.whatsappSent24h === null || s.whatsappFailed24h === null) {
    add("whatsapp_failures", "Hiring Engine WhatsApp (candidates)", "warn", "Check unavailable");
  } else {
    const total = s.whatsappSent24h + s.whatsappFailed24h;
    const share = total > 0 ? s.whatsappFailed24h / total : 0;
    let waLevel: HealthLevel = "ok";
    if (total >= WA_MIN_VOLUME && share >= WA_CRITICAL_FAIL_SHARE) waLevel = "critical";
    else if (total > 0 && share >= WA_WARN_FAIL_SHARE) waLevel = "warn";
    add("whatsapp_failures", "Hiring Engine WhatsApp (candidates)", waLevel,
      `${s.whatsappFailed24h} failed of ${total} in last 24 h (${Math.round(share * 100)}%)`);
  }

  if (s.followupOverdue === null) add("followup_overdue", "Follow-ups overdue", "warn", "Check unavailable");
  else add("followup_overdue", "Follow-ups overdue", s.followupOverdue > 0 ? "warn" : "ok",
    `${s.followupOverdue} follow-up(s) overdue by more than 30 min`);

  if (s.pinbotQuality !== undefined) {
    const q = s.pinbotQuality;
    if (q === "GREEN") add("pinbot_quality", "WhatsApp number quality", "ok", "Quality GREEN");
    else if (q === "YELLOW") add("pinbot_quality", "WhatsApp number quality", "warn", "Quality YELLOW: follow-up sends halved");
    else if (q === "RED") add("pinbot_quality", "WhatsApp number quality", "critical", "Quality RED: new follow-up sends paused");
    else add("pinbot_quality", "WhatsApp number quality", "warn", "Quality unknown: follow-up sends halved");
  }

  if (s.inboundWa24h !== undefined) {
    const label = "Inbound WhatsApp (replies and receipts)";
    const sent = s.whatsappSent24h;
    if (s.inboundWa24h === null || sent === null) add("whatsapp_inbound", label, "warn", "Check unavailable");
    else if (s.inboundWa24h === 0 && sent >= WA_MIN_VOLUME) {
      add("whatsapp_inbound", label, "critical", `No candidate replies reached HRMS in 24 h while ${sent} were sent: check the Pinbot webhook`);
    } else if (s.inboundWa24h === 0 && sent > 0) {
      add("whatsapp_inbound", label, "warn", `No candidate replies in 24 h while ${sent} were sent`);
    } else add("whatsapp_inbound", label, "ok", `${s.inboundWa24h} inbound in last 24 h`);
  }

  return checks;
}

export function overallLevel(checks: HealthCheck[]): HealthLevel {
  return checks.reduce<HealthLevel>((w, c) => (RANK[c.level] > RANK[w] ? c.level : w), "ok");
}
