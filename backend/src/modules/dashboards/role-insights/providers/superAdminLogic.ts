import type { InsightPoint, InsightSignal, InsightTone } from "../types.js";

/**
 * Pure computation behind the Super Admin "mission control" provider. Nothing here touches the
 * database, so the thresholds that decide whether a light is green, amber or red are unit-testable
 * and the SQL in superAdmin*.ts only has to fetch facts.
 */

export type SystemStatus = "ok" | "warn" | "down" | "unknown";

export interface SystemRow {
  id: string;
  name: string;
  group: "core" | "integration" | "comms" | "jobs";
  status: SystemStatus;
  /** Big number/phrase on the tile ("2m ago", "39% failed"). */
  headline: string;
  detail: string;
  /** Minutes since the last good signal; null when there has never been one. */
  age_min: number | null;
  href: string;
  [key: string]: string | number | null;
}

/** Roles that can change who may do what, or move money. Dormant ones are an access risk. */
export const PRIVILEGED_ROLES = [
  "super_admin", "admin", "branch_admin", "ceo", "coo", "cfo", "hr", "payroll", "payroll_hr",
  "payroll_head", "finance", "finance_head", "accounts_head", "it", "it_head",
] as const;

const RANK: Record<SystemStatus, number> = { ok: 0, unknown: 1, warn: 2, down: 3 };

export function worstStatus(...all: SystemStatus[]): SystemStatus {
  return all.reduce<SystemStatus>((worst, s) => (RANK[s] > RANK[worst] ? s : worst), "ok");
}

/** Freshness light: green within `okWithin` minutes, amber within `warnWithin`, red beyond. */
export function ageStatus(ageMin: number | null, okWithin: number, warnWithin: number): SystemStatus {
  if (ageMin === null || !Number.isFinite(ageMin)) return "unknown";
  if (ageMin <= okWithin) return "ok";
  if (ageMin <= warnWithin) return "warn";
  return "down";
}

/**
 * Failure-rate light. A handful of calls cannot indict a service, so below `minSample`
 * attempts the light stays green (nothing to judge) rather than flipping on one bad call.
 */
export function rateStatus(failed: number, total: number, warnPct: number, downPct: number, minSample = 10): SystemStatus {
  if (total <= 0) return "unknown";
  if (total < minSample) return failed > 0 && failed === total ? "warn" : "ok";
  const rate = (failed / total) * 100;
  return rate >= downPct ? "down" : rate >= warnPct ? "warn" : "ok";
}

export function ratePct(failed: number, total: number): number | null {
  return total > 0 ? Math.round((failed / total) * 1000) / 10 : null;
}

export function formatAge(min: number | null): string {
  if (min === null || !Number.isFinite(min)) return "never";
  if (min < 1) return "just now";
  if (min < 60) return `${Math.round(min)}m ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)}h ago`;
  return `${Math.round(min / 1440)}d ago`;
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function toTone(status: SystemStatus): InsightTone {
  return status === "ok" ? "green" : status === "warn" ? "amber" : status === "down" ? "red" : "slate";
}

/**
 * Composite platform health. Unknown lights are excluded from the denominator instead of being
 * counted as healthy: a probe that could not run must not pad the score.
 */
export function systemsHealth(rows: Pick<SystemRow, "status">[]): { score: number | null; basis: string } {
  const judged = rows.filter((r) => r.status !== "unknown");
  if (!judged.length) return { score: null, basis: "No system could be probed." };
  const points = judged.reduce((s, r) => s + (r.status === "ok" ? 1 : r.status === "warn" ? 0.5 : 0), 0);
  const down = judged.filter((r) => r.status === "down").length;
  const warn = judged.filter((r) => r.status === "warn").length;
  const unknown = rows.length - judged.length;
  return {
    score: Math.round((points / judged.length) * 100),
    basis: `${judged.length - down - warn} of ${judged.length} systems healthy, ${warn} degraded, ${down} down`
      + (unknown ? `; ${unknown} could not be probed and are not counted` : "")
      + ". Healthy = 1, degraded = 0.5, down = 0.",
  };
}

/** Good / bad / watch lines derived from the lights. Text only states what the numbers say. */
export function systemSignals(rows: SystemRow[]): InsightSignal[] {
  const out: InsightSignal[] = [];
  for (const r of rows) {
    if (r.status === "down") out.push({ tone: "bad", title: `${r.name} is failing`, detail: r.detail, value: r.headline, href: r.href });
    else if (r.status === "warn") out.push({ tone: "watch", title: `${r.name} is degraded`, detail: r.detail, value: r.headline, href: r.href });
  }
  const healthy = rows.filter((r) => r.status === "ok");
  if (healthy.length && healthy.length >= rows.length - 1) {
    out.push({ tone: "good", title: `${healthy.length} of ${rows.length} systems healthy`, detail: healthy.map((r) => r.name).join(", ") });
  }
  return out;
}

/** Severity for a data-quality gap by how much of the base it affects. */
export function gapSeverity(count: number | null, total: number | null): "critical" | "high" | "normal" | "info" {
  if (count === null || count <= 0) return "info";
  const share = total && total > 0 ? count / total : 1;
  return share >= 0.1 ? "critical" : share >= 0.03 ? "high" : "normal";
}

export interface IntegrationFacts {
  active: boolean;
  testOk: number | null;
  testAgeDays: number | null;
  lastRunAgeMin: number | null;
  lastRunStatus: string | null;
}

/** Registry state for one configured integration. Runs beat stale connection tests. */
export function integrationState(f: IntegrationFacts): { state: "off" | "down" | "warn" | "ok" | "idle"; reason: string } {
  if (!f.active) return { state: "off", reason: "Switched off" };
  const s = (f.lastRunStatus ?? "").toLowerCase();
  if (s === "failed" || s === "error") {
    // A failure that nothing has retried for weeks is a dormant feed, not a live outage.
    return f.lastRunAgeMin !== null && f.lastRunAgeMin > 3 * 1440
      ? { state: "warn", reason: `Last run failed ${formatAge(f.lastRunAgeMin)}, never retried` }
      : { state: "down", reason: `Last run failed ${formatAge(f.lastRunAgeMin)}` };
  }
  if (f.testOk === 0) {
    const when = f.testAgeDays !== null ? ` ${f.testAgeDays}d ago` : "";
    return { state: "warn", reason: `Connection test failed${when}` };
  }
  if (f.lastRunAgeMin === null) return { state: "idle", reason: "No run recorded" };
  if (f.lastRunAgeMin > 30 * 1440) return { state: "idle", reason: `Last run ${formatAge(f.lastRunAgeMin)}` };
  return { state: "ok", reason: `Last run ${formatAge(f.lastRunAgeMin)}` };
}

/** Lowest-friction dormant test: never logged in, or idle past `days`. */
export function isDormant(idleDays: number | null, neverLoggedIn: boolean, days = 30): boolean {
  return neverLoggedIn || (idleDays !== null && idleDays >= days);
}

/** Zero-fill a per-day series so a quiet day shows as 0 rather than a missing bar. */
export function fillDays(days: string[], byDay: Map<string, Record<string, number>>, keys: string[]): InsightPoint[] {
  return days.map((d) => {
    const row = byDay.get(d) ?? {};
    const point: InsightPoint = { label: d.slice(5) };
    for (const k of keys) point[k] = row[k] ?? 0;
    return point;
  });
}
