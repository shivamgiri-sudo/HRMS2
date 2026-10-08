/**
 * Pure aggregation for the Drive Command Center: per-type funnel, conversions, daily series, timing grids, scatter points and the
 * loss waterfall. No I/O and no clock. Rates are n / d when d > 0, else 0 (stored) or null (displayed conversions); never NaN / Infinity.
 */
import type { OutcomeReasonCode } from "./he-outcome-reason.js";
import { defaultTrendDates, showRate, type DriveAggRow } from "./he-drive-trend.service.js";
import type { SourceRow } from "./he-requisition-sources.service.js";
import type { SourceType } from "./qualified-followup.types.js";

export const SOURCE_TYPES: readonly SourceType[] = ["meta_live", "meta_old", "he"];
export const STAGES = ["leads", "qualified", "invited", "confirmed", "arrived", "selected", "joined"] as const;
export type Stage = (typeof STAGES)[number];
export type StageCounts = Record<Stage, number>;
export type TypedStageCounts = StageCounts & { noShow: number; declined: number };

export interface MatchOutcome { sourceType: SourceType; selected: number; joined: number }
export interface TaggedAggRow extends DriveAggRow { requisitionId: string; branch: string }

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const ratio = (n: number, d: number): number => (d > 0 ? n / d : 0);

export const zeroStages = (): StageCounts => ({ leads: 0, qualified: 0, invited: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0 });
const perType = <T>(make: () => T): Record<SourceType, T> => ({ meta_live: make(), meta_old: make(), he: make() });

export interface PersonStageCounts { leads: number; invited: number; confirmed: number; arrived: number }
/** leads / qualified from the sources read model, invited / confirmed / arrived from drive state buckets,
 *  selected / joined = max(match outcome, sources value) so overlapping populations are not added twice.
 *  With `persons` (the events-based read, he-drive-persons.service.ts) leads / invited / confirmed / arrived come from it instead
 *  (leads never below qualified); noShow / declined stay the drive state counts. */
export function stageCountsByType(sources: SourceRow[], agg: DriveAggRow[], outcomes: MatchOutcome[], persons?: Record<SourceType, PersonStageCounts>): Record<SourceType, TypedStageCounts> {
  const out = perType<TypedStageCounts>(() => ({ ...zeroStages(), noShow: 0, declined: 0 }));
  const outSel = perType(() => 0);
  const outJoin = perType(() => 0);
  for (const s of sources) {
    const t = out[s.sourceType];
    if (!t) continue;
    t.leads += num(s.leads); t.qualified += num(s.qualified); t.selected += num(s.selected); t.joined += num(s.joined);
  }
  for (const r of agg) {
    const t = out[r.streamType ?? "he"];
    if (!t) continue;
    t.invited += num(r.invited); t.confirmed += num(r.confirmed); t.arrived += num(r.arrived);
    t.noShow += num(r.noShow); t.declined += num(r.declined);
  }
  for (const o of outcomes) {
    if (!(o.sourceType in outSel)) continue;
    outSel[o.sourceType] += num(o.selected); outJoin[o.sourceType] += num(o.joined);
  }
  for (const k of SOURCE_TYPES) {
    out[k].selected = Math.max(out[k].selected, outSel[k]);
    out[k].joined = Math.max(out[k].joined, outJoin[k]);
    const p = persons?.[k];
    if (p) {
      out[k].leads = Math.max(num(p.leads), out[k].qualified);
      out[k].invited = num(p.invited); out[k].confirmed = num(p.confirmed); out[k].arrived = num(p.arrived);
    }
  }
  return out;
}

export interface Conversion { from: Stage; to: Stage; rate: number | null }
/** Null when the previous stage is 0 or the stage exceeds it (the stages come from different populations). */
export function conversions(s: StageCounts): Conversion[] {
  return STAGES.slice(1).map((to, i) => {
    const from = STAGES[i];
    const prev = num(s[from]), cur = num(s[to]);
    return { from, to, rate: prev > 0 && cur <= prev ? cur / prev : null };
  });
}

export interface DailyPoint { date: string; target: number; byType: Record<SourceType, { invited: number; confirmed: number; arrived: number }> }
export function dailySeries(agg: DriveAggRow[], from: string, to: string): DailyPoint[] {
  const dates = defaultTrendDates(from, to, agg.map((r) => r.date));
  const points = new Map<string, DailyPoint>();
  for (const date of dates) points.set(date, { date, target: 0, byType: perType(() => ({ invited: 0, confirmed: 0, arrived: 0 })) });
  const seen = new Set<string>();
  for (const r of agg) {
    const p = points.get(r.date);
    if (!p) continue;
    if (!seen.has(r.driveId)) { seen.add(r.driveId); p.target += num(r.wanted); }
    const b = p.byType[r.streamType ?? "he"];
    if (!b) continue;
    b.invited += num(r.invited); b.confirmed += num(r.confirmed); b.arrived += num(r.arrived);
  }
  return dates.map((d) => points.get(d)!);
}

export type Grid = number[][];
export interface TimingCell { sourceType: SourceType; weekday: number; hour: number; n: number }
export function timingGrids(cells: TimingCell[]): Record<SourceType, Grid> {
  const out = perType<Grid>(() => Array.from({ length: 7 }, () => new Array<number>(24).fill(0)));
  for (const c of cells) {
    const g = out[c.sourceType];
    if (!g || !Number.isInteger(c.weekday) || !Number.isInteger(c.hour) || c.weekday < 0 || c.weekday > 6 || c.hour < 0 || c.hour > 23) continue;
    g[c.weekday][c.hour] += num(c.n);
  }
  return out;
}

export interface ScatterPoint { requisitionId: string; code: string; branch: string; sourceType: SourceType; leads: number; showRate: number; leadToJoinRate: number }
export function scatterPoints(
  groups: Array<{ requisitionId: string; code: string; branch: string; sourceType: SourceType; confirmed: number; arrived: number }>,
  sources: Array<{ requisitionId: string; rows: SourceRow[] }>,
): ScatterPoint[] {
  const sums = new Map<string, { leads: number; joined: number }>();
  for (const s of sources) for (const r of s.rows) {
    const key = `${s.requisitionId}|${r.sourceType}`;
    const acc = sums.get(key) ?? { leads: 0, joined: 0 };
    acc.leads += num(r.leads); acc.joined += num(r.joined);
    sums.set(key, acc);
  }
  const out: ScatterPoint[] = [];
  for (const g of groups) {
    const acc = sums.get(`${g.requisitionId}|${g.sourceType}`) ?? { leads: 0, joined: 0 };
    const confirmed = num(g.confirmed), arrived = num(g.arrived);
    if (acc.leads <= 0 && confirmed <= 0) continue;
    out.push({
      requisitionId: g.requisitionId, code: g.code, branch: g.branch, sourceType: g.sourceType,
      leads: acc.leads, showRate: showRate(arrived, confirmed), leadToJoinRate: ratio(acc.joined, acc.leads),
    });
  }
  return out;
}

export type LossReason = "not_qualified" | "opted_out" | "requisition_closed" | "no_contact_details" | "not_invited" | "declined" | "no_reply"
  | "no_show" | "slot_released" | "not_selected" | "not_joined_yet" | "other";
export type ReasonDetail = Array<{ code: OutcomeReasonCode | "not_stated"; n: number }>;
export interface WaterfallStep { from: Stage; to: Stage; lost: number; reasons: Array<{ reason: LossReason; n: number; detail?: ReasonDetail }> }
type ReasonCounts = Partial<Record<OutcomeReasonCode, number>>;
export interface KpiTotals { current: StageCounts; previous: StageCounts }

/** Named reasons first (each capped by what is left of `lost`), the remainder under `rest`, so reasons always sum to `lost`. */
function allocate(lost: number, named: Array<[LossReason, number]>, rest: LossReason): WaterfallStep["reasons"] {
  const reasons: WaterfallStep["reasons"] = [];
  let left = lost;
  for (const [reason, count] of named) {
    const n = Math.min(Math.floor(num(count)), left);
    if (n > 0) { reasons.push({ reason, n }); left -= n; }
  }
  if (left > 0) reasons.push({ reason: rest, n: left });
  return reasons;
}

export function waterfall(
  s: TypedStageCounts,
  stops: Partial<Record<"opted_out" | "requisition_closed" | "no_contact_details", number>>,
  slotReleased: number,
  detail?: { declined?: ReasonCounts; no_show?: ReasonCounts },
): WaterfallStep[] {
  const named: Partial<Record<Stage, Array<[LossReason, number]>>> = {
    qualified: [],
    invited: [["opted_out", stops.opted_out ?? 0], ["requisition_closed", stops.requisition_closed ?? 0], ["no_contact_details", stops.no_contact_details ?? 0]],
    confirmed: [["declined", s.declined]],
    arrived: [["no_show", s.noShow], ["slot_released", slotReleased]],
  };
  const rest: Partial<Record<Stage, LossReason>> = {
    qualified: "not_qualified", invited: "not_invited", confirmed: "no_reply", arrived: "other", selected: "not_selected", joined: "not_joined_yet",
  };
  return STAGES.slice(1).map((to, i) => {
    const from = STAGES[i];
    const lost = Math.max(0, num(s[from]) - num(s[to]));
    const reasons = allocate(lost, named[to] ?? [], rest[to] ?? "other");
    if (detail) for (const r of reasons) if (r.reason === "declined" || r.reason === "no_show") r.detail = reasonDetail(r.n, detail[r.reason]);
    return { from, to, lost, reasons };
  });
}

/** Recorded reasons by count (desc, then code), each capped at what is left of `n`; the unrecorded remainder is `not_stated`. */
function reasonDetail(n: number, counts: ReasonCounts | undefined): ReasonDetail {
  const out: ReasonDetail = [];
  let left = n;
  const sorted = (Object.entries(counts ?? {}) as Array<[OutcomeReasonCode, number]>)
    .map(([code, c]) => ({ code, n: Math.floor(num(c)) })).filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  for (const x of sorted) {
    const take = Math.min(x.n, left);
    if (take > 0) { out.push({ code: x.code, n: take }); left -= take; }
  }
  if (left > 0) out.push({ code: "not_stated", n: left });
  return out;
}
