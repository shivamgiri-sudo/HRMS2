import type { BranchOverview, AttritionData } from "../../../../../backend/src/modules/branch-head-health/types";
import type { AttendanceData, FinanceData, HiringData, PeopleData } from "./panelTypes";
import type { StatDelta, Tone } from "./viz";
import { formatCount, formatInr, formatPct } from "./format";

export type KpiId = "shrinkage" | "late" | "headcount" | "attrition" | "profit" | "budget" | "grn" | "openings";
export const KPI_IDS: readonly KpiId[] = ["shrinkage", "late", "headcount", "attrition", "profit", "budget", "grn", "openings"];

/** A threshold rule. "higher" = bigger is worse (value >= limit trips it); "lower" = smaller is worse (value < limit). */
export interface ToneRule { worse: "higher" | "lower"; warning: number; critical: number }

/** Every KPI tile threshold in one place. Mandate fill is two-sided (under- and over-staffing). */
export const KPI_TONES = {
  shrinkagePct: { worse: "higher", warning: 10, critical: 20 },
  /** Late arrivals as a share of people present. */
  lateSharePct: { worse: "higher", warning: 8, critical: 15 },
  /** Critical + high attrition-risk employees. */
  attritionRisk: { worse: "higher", warning: 1, critical: 10 },
  opPct: { worse: "lower", warning: 5, critical: 0 },
  budgetPct: { worse: "higher", warning: 80, critical: 95 },
  grnPending: { worse: "higher", warning: 1, critical: 10 },
  mandateFillPct: { underCritical: 80, underWarning: 90, overWarning: 110 },
} as const satisfies Record<string, ToneRule | { underCritical: number; underWarning: number; overWarning: number }>;

const fin = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export function toneFor(value: number | null | undefined, rule: ToneRule): Tone {
  if (!fin(value)) return "neutral";
  if (rule.worse === "higher") return value >= rule.critical ? "critical" : value >= rule.warning ? "warning" : "good";
  return value < rule.critical ? "critical" : value < rule.warning ? "warning" : "good";
}

export function mandateTone(active: number | null | undefined, mandate: number | null | undefined): Tone {
  if (!fin(active) || !fin(mandate) || mandate <= 0) return "neutral";
  const fill = (active / mandate) * 100;
  const r = KPI_TONES.mandateFillPct;
  if (fill < r.underCritical) return "critical";
  if (fill < r.underWarning || fill > r.overWarning) return "warning";
  return "good";
}

export interface KpiTile {
  id: KpiId; label: string; value: string; tone: Tone; hint?: string; delta?: StatDelta;
  /** Backend trend metric for the sparkline, when one is whitelisted. */
  metric?: string;
}

/** Trend metrics the strip (and hero) ask the trend endpoint for. */
export const KPI_TREND_METRICS = ["shrinkagePct", "totalLate", "totalActive", "opPct", "budgetUtilizationPct", "openPositions"] as const;

function okData<T>(s: { status: string; data: unknown } | undefined): T | null {
  return s && s.status === "ok" && s.data ? (s.data as T) : null;
}

/** Shrinkage today vs the previous day, in percentage points; lower shrinkage is good. */
export function shrinkageDelta(a: AttendanceData | null): StatDelta | undefined {
  const prev = a?.previousDay?.shrinkagePct;
  if (!a || !fin(a.shrinkagePct) || !fin(prev)) return undefined;
  const diff = Math.round((a.shrinkagePct - prev) * 10) / 10;
  if (diff === 0) return { text: "0.0 pts vs yesterday", direction: "flat", good: null };
  return { text: `${diff > 0 ? "+" : ""}${diff.toFixed(1)} pts vs yesterday`, direction: diff > 0 ? "up" : "down", good: diff < 0 };
}

const NO_DATA = "No data";

/** The 8 KPI tiles from the payload sections; a missing or errored section gives "—" and no tone. */
export function buildKpis(ov: BranchOverview): KpiTile[] {
  const att = okData<AttendanceData>(ov.attendance);
  const ppl = okData<PeopleData>(ov.people);
  const hir = okData<HiringData>(ov.hiring);
  const fi = okData<FinanceData>(ov.finance);
  const atr = okData<AttritionData>(ov.attrition);

  const lateShare = att && att.present > 0 ? (att.totalLate / att.present) * 100 : null;
  const mandate = ppl?.mandateSeatsTotal ?? null;
  const fill = ppl && fin(mandate) && mandate > 0 ? (ppl.totalActive / mandate) * 100 : null;
  const risk = atr ? atr.critical + atr.high : null;
  const grn = fi?.grn ?? null;

  return [
    { id: "shrinkage", label: "Shrinkage", metric: "shrinkagePct", value: formatPct(att?.shrinkagePct), tone: toneFor(att?.shrinkagePct, KPI_TONES.shrinkagePct),
      delta: shrinkageDelta(att), hint: att ? `${formatCount(att.absent)} absent of ${formatCount(att.scheduled)}` : NO_DATA },
    { id: "late", label: "Late today", metric: "totalLate", value: formatCount(att?.totalLate), tone: toneFor(lateShare, KPI_TONES.lateSharePct),
      hint: lateShare == null ? (att ? "No one present yet" : NO_DATA) : `${formatPct(lateShare)} of present` },
    { id: "headcount", label: "Headcount vs mandate", metric: "totalActive", tone: mandateTone(ppl?.totalActive, mandate),
      value: ppl ? (fin(mandate) && mandate > 0 ? `${formatCount(ppl.totalActive)} / ${formatCount(mandate)}` : formatCount(ppl.totalActive)) : "—",
      hint: !ppl ? NO_DATA : fill == null ? "No mandate set" : fill > 100 ? `Over mandate by ${formatCount(ppl.totalActive - (mandate as number))}` : `${Math.round(fill)}% of mandate` },
    { id: "attrition", label: "Attrition risk", value: formatCount(risk), tone: toneFor(risk, KPI_TONES.attritionRisk),
      hint: atr ? `${formatCount(atr.critical)} critical, ${formatCount(atr.high)} high` : NO_DATA },
    { id: "profit", label: "Operating profit", metric: "opPct", value: formatPct(fi?.opPct), tone: toneFor(fi?.opPct, KPI_TONES.opPct),
      hint: fi ? `${formatInr(fi.operatingProfit)} month to date` : NO_DATA },
    { id: "budget", label: "Budget used", metric: "budgetUtilizationPct", value: formatPct(fi?.budgetUtilizationPct), tone: toneFor(fi?.budgetUtilizationPct, KPI_TONES.budgetPct),
      hint: fi ? `${formatInr(fi.budget.available)} available` : NO_DATA },
    { id: "grn", label: "GRN pending", value: formatCount(grn?.pending), tone: toneFor(grn?.pending, KPI_TONES.grnPending),
      hint: grn ? `${formatCount(grn.pendingOver3Days)} over 3 days` : NO_DATA },
    { id: "openings", label: "Open positions", metric: "openPositions", value: formatCount(hir?.openPositions), tone: "neutral",
      hint: hir ? `${formatCount(hir.inPipeline)} in pipeline` : NO_DATA },
  ];
}
