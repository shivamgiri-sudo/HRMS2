/**
 * Cost per source (HE_COST_PER_SOURCE). Pure: no I/O, no clock. Every figure is an estimate: Meta spend is a last-30-day total spread over
 * the days in range, and messaging uses rates the owner sets in he_model_param (cost.*). A per-stage cost is total / stage, null when the stage is 0.
 */
import { SOURCE_TYPES, type StageCounts } from "./he-drive-analytics.js";
import type { SourceType } from "./qualified-followup.types.js";
import { addDays } from "./requisition-stream.window.js";

export const COST_DEFAULTS = { "cost.whatsapp_per_conversation": 0, "cost.call_per_minute": 0, "cost.call_per_call": 0, "cost.email": 0 } as const;
export type CostKey = keyof typeof COST_DEFAULTS;
export type CostRates = Record<CostKey, number>;

const DECIMAL = /^\d+(\.\d+)?$/;
const MAX_RATE = 100_000;
const SPEND_PERIOD_DAYS = 30;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** A value that is not a plain decimal, or is outside 0 to 100000, keeps the default (0). */
export function parseCostRates(rows: Array<{ param_key: unknown; value: unknown }>): CostRates {
  const out: CostRates = { ...COST_DEFAULTS };
  for (const r of rows ?? []) {
    const key = String(r.param_key);
    if (!Object.prototype.hasOwnProperty.call(COST_DEFAULTS, key) || r.value === null || r.value === undefined) continue;
    const raw = String(r.value).trim();
    if (!DECIMAL.test(raw)) continue;
    const v = Number(raw);
    if (Number.isFinite(v) && v >= 0 && v <= MAX_RATE) out[key as CostKey] = v;
  }
  return out;
}

const dayDiff = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The spend covers [syncedOn - 29, syncedOn]; the share in [from, to] is spend * overlapDays / 30. Null sync date or no overlap gives 0. */
export function prorateSpend(spendInr: number, syncedOn: string | null, from: string, to: string): number {
  if (!syncedOn || !(spendInr > 0) || !Number.isFinite(spendInr)) return 0;
  const start = addDays(syncedOn, -(SPEND_PERIOD_DAYS - 1));
  const lo = from > start ? from : start;
  const hi = to < syncedOn ? to : syncedOn;
  if (hi < lo) return 0;
  return round2((spendInr * (dayDiff(lo, hi) + 1)) / SPEND_PERIOD_DAYS);
}

export interface CostUsage { adSpend: number; waConversations: number; calls: number; callMinutes: number; emails: number }
export interface TypeCost {
  total: number; adSpend: number; messaging: number;
  perLead: number | null; perQualified: number | null; perArrival: number | null; perJoin: number | null;
  usage: CostUsage;
}

export function typeCost(u: CostUsage, r: CostRates, s: { leads: number; qualified: number; arrived: number; joined: number }): TypeCost {
  const adSpend = round2(num(u.adSpend));
  const messaging = round2(num(u.waConversations) * r["cost.whatsapp_per_conversation"] + num(u.calls) * r["cost.call_per_call"]
    + num(u.callMinutes) * r["cost.call_per_minute"] + num(u.emails) * r["cost.email"]);
  const total = round2(adSpend + messaging);
  const per = (d: number): number | null => (d > 0 ? round2(total / d) : null);
  return { total, adSpend, messaging, perLead: per(s.leads), perQualified: per(s.qualified), perArrival: per(s.arrived), perJoin: per(s.joined), usage: u };
}

export interface CostBlock {
  available: boolean; note: string; estimated: boolean; ratesConfigured: boolean; rates: CostRates;
  byType: Record<SourceType, TypeCost> | null;
}

const NOTE_NONE = "No cost source yet: no Meta ad spend is synced for these requisitions and no messaging rates are set";
const NOTE_ESTIMATE = "Estimated: Meta ad spend is the last 30-day total spread over the days in range; messaging uses the owner's rates. Calls from the calling file and messages without a requisition are not counted.";
const NOTE_NO_RATES = " Messaging rates are not set, so only ad spend counts.";

export function costBlock(usage: Record<SourceType, CostUsage>, r: CostRates, stages: Record<SourceType, StageCounts>): CostBlock {
  const ratesConfigured = Object.values(r).some((v) => v > 0);
  const spend = SOURCE_TYPES.reduce((a, t) => a + num(usage[t]?.adSpend), 0);
  if (!ratesConfigured && !(spend > 0)) return { available: false, note: NOTE_NONE, estimated: false, ratesConfigured, rates: r, byType: null };
  const byType = {} as Record<SourceType, TypeCost>;
  for (const t of SOURCE_TYPES) byType[t] = typeCost(usage[t], r, stages[t]);
  return { available: true, note: NOTE_ESTIMATE + (ratesConfigured ? "" : NOTE_NO_RATES), estimated: true, ratesConfigured, rates: r, byType };
}
