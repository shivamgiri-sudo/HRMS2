import type { InsightContext, InsightTone } from "../../types.js";
import { num } from "../../helpers.js";

/** Pending items raised before this date are legacy backlog, never HR's live queue (see pendency-cutoff.ts). */
export { PENDENCY_CUTOFF_DATE } from "../../../pendency-cutoff.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** SQL date literal from a code-controlled YYYY-MM-DD. Throws on anything else, so it can never carry input. */
export function lit(date: string): string {
  if (!DATE_RE.test(date)) throw new Error(`bad date literal: ${date}`);
  return `'${date}'`;
}

export function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** First day of the month `back` months before `date`'s month. */
export function monthStart(date: string, back = 0): string {
  const d = new Date(`${date}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1)).toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1] ?? ym} ${String(y).slice(2)}`;
}

/** Per-request memo: every section of one insights call shares the same ctx object. */
const MEMO = new WeakMap<InsightContext, Map<string, Promise<unknown>>>();
export function memoized<T>(name: string, fn: (ctx: InsightContext) => Promise<T>): (ctx: InsightContext) => Promise<T> {
  return (ctx) => {
    let m = MEMO.get(ctx);
    if (!m) { m = new Map(); MEMO.set(ctx, m); }
    let p = m.get(name) as Promise<T> | undefined;
    if (!p) { p = fn(ctx); m.set(name, p); }
    return p;
  };
}

export const int = (v: unknown): number => num(v) ?? 0;

/**
 * Attrition for a window = leavers / average headcount over the window.
 * Average headcount is (opening + closing) / 2, both measured from dates on the employee record, so
 * joiners who left inside the window are in the denominator the way they are in the numerator.
 * (The summary endpoint used closing headcount + leavers/2, which ignores joiners entirely.)
 */
export function attritionPct(exits: number | null, hcOpen: number | null, hcClose: number | null): number | null {
  if (exits === null || hcOpen === null || hcClose === null) return null;
  const avg = (hcOpen + hcClose) / 2;
  if (avg <= 0) return null;
  return Math.round((exits / avg) * 1000) / 10;
}

export const TENURE_BUCKETS = ["< 30 days", "30-89 days", "90-179 days", "180-364 days", "1 year +"] as const;
export function tenureBucket(days: number | null): (typeof TENURE_BUCKETS)[number] | null {
  if (days === null || days < 0) return null;
  if (days < 30) return TENURE_BUCKETS[0];
  if (days < 90) return TENURE_BUCKETS[1];
  if (days < 180) return TENURE_BUCKETS[2];
  if (days < 365) return TENURE_BUCKETS[3];
  return TENURE_BUCKETS[4];
}

/** Severity for a queue from its overdue share and size. */
export function queueSeverity(count: number | null, overdue: number | null): "critical" | "high" | "normal" | "info" {
  if (count === null || count <= 0) return "info";
  const o = overdue ?? 0;
  if (o >= 10 || (count >= 5 && o / count >= 0.5)) return "critical";
  if (o > 0 || count >= 25) return "high";
  return "normal";
}

/** Linear 0-100 score: `best` or better scores 100, `worst` or worse scores 0. */
export function scoreBetween(value: number | null, best: number, worst: number): number | null {
  if (value === null) return null;
  const s = ((worst - value) / (worst - best)) * 100;
  return Math.round(Math.max(0, Math.min(100, s)));
}

export interface HealthPart { label: string; score: number | null; weight: number }
/** Weighted mean over the parts that could be measured; null if fewer than half the weight is measurable. */
export function composeHealth(parts: HealthPart[]): { score: number | null; basis: string } {
  const live = parts.filter((p) => p.score !== null);
  const w = live.reduce((s, p) => s + p.weight, 0);
  const total = parts.reduce((s, p) => s + p.weight, 0);
  const basis = parts.map((p) => `${p.label} ${p.score === null ? "n/a" : p.score} (weight ${p.weight})`).join(" · ");
  if (w === 0 || w < total / 2) return { score: null, basis: `Not enough measurable inputs. ${basis}` };
  return { score: Math.round(live.reduce((s, p) => s + (p.score as number) * p.weight, 0) / w), basis };
}

export function toneByOverdue(count: number | null, overdue: number | null): InsightTone {
  if (count === null) return "slate";
  if (!count) return "green";
  return (overdue ?? 0) > 0 ? "red" : "amber";
}
