/** Pure helpers + API adapters for the Interventions panel (no React). */
import type { PillTone } from "@/components/wfm/console/StatusPill";

export type Tier = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type Owner = "hr_admin" | "manager" | "wfm" | "process_head";
export type Priority = "immediate" | "within_48h" | "this_week";
export type Bucket = "open" | "actioned" | "retained" | "exited" | "overdue" | "all";

export const TIERS: Tier[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
export const TIER_LABEL: Record<Tier, string> = { CRITICAL: "Critical", HIGH: "High", MEDIUM: "Medium", LOW: "Low" };
export const TIER_TONE: Record<Tier, PillTone> = { CRITICAL: "red", HIGH: "amber", MEDIUM: "blue", LOW: "green" };
export const TIER_RANK: Record<Tier, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
export const OWNER_LABEL: Record<Owner, string> = { hr_admin: "HR Admin", manager: "Manager", wfm: "WFM", process_head: "Process Head" };
export const PRIORITY_LABEL: Record<Priority, string> = { immediate: "Immediate", within_48h: "Within 48h", this_week: "This week" };
export const PRIORITY_RANK: Record<Priority, number> = { immediate: 0, within_48h: 1, this_week: 2 };

export interface Recommendation { priority: Priority; owner: Owner; action: string; reason: string; signal?: string }

export interface CaseRow {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  processName: string;
  branchName: string;
  designationName: string;
  generatedAt: string;
  ageDays: number;
  riskTier: Tier;
  score: number;
  recommendations: Recommendation[];
  actionTaken: boolean;
  outcome: "retained" | "exited" | "pending";
  slaHours: number;
  overdue: boolean;
}

export interface CaseApiRow {
  id: string; employee_id: string; employee_code?: string | null; employee_name?: string | null;
  branch_name?: string | null; process_name?: string | null; designation_name?: string | null;
  generated_at: string; days_since_generated?: number | null; risk_tier: string; prediction_score: number | string | null;
  recommendations: Recommendation[] | string | null; action_taken?: number | boolean | null;
  outcome?: string | null; sla_hours?: number | null; is_overdue?: number | boolean | null;
}

function parseRecs(raw: CaseApiRow["recommendations"]): Recommendation[] {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

export function topRecommendation(recs: Recommendation[]): Recommendation | null {
  if (!recs.length) return null;
  return [...recs].sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9))[0];
}

export function adaptCase(r: CaseApiRow): CaseRow {
  const tier = String(r.risk_tier ?? "LOW").toUpperCase() as Tier;
  const outcome = r.outcome === "retained" || r.outcome === "exited" ? r.outcome : "pending";
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeCode: r.employee_code ?? "",
    employeeName: (r.employee_name ?? "").trim(),
    processName: r.process_name ?? "",
    branchName: r.branch_name ?? "",
    designationName: r.designation_name ?? "",
    generatedAt: r.generated_at,
    ageDays: Math.max(0, Number(r.days_since_generated ?? 0) || 0),
    riskTier: tier in TIER_RANK ? tier : "LOW",
    score: Number(r.prediction_score ?? 0) || 0,
    recommendations: parseRecs(r.recommendations),
    actionTaken: Boolean(Number(r.action_taken ?? 0)),
    outcome,
    slaHours: Number(r.sla_hours ?? 168) || 168,
    overdue: Boolean(Number(r.is_overdue ?? 0)),
  };
}

export type SortKey = "employee" | "tier" | "score" | "action" | "owner" | "age";
export interface SortState { key: SortKey; dir: "asc" | "desc" }

export function sortCases(rows: CaseRow[], sort: SortState): CaseRow[] {
  const m = sort.dir === "asc" ? 1 : -1;
  const val = (r: CaseRow): string | number => {
    switch (sort.key) {
      case "employee": return r.employeeName.toLowerCase();
      case "tier": return TIER_RANK[r.riskTier];
      case "score": return r.score;
      case "age": return r.ageDays;
      case "owner": return topRecommendation(r.recommendations)?.owner ?? "~";
      case "action": return topRecommendation(r.recommendations)?.action.toLowerCase() ?? "~";
    }
  };
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return c !== 0 ? c * m : a.employeeName.localeCompare(b.employeeName);
  });
}

/** % change; null when the previous period is 0 (undefined) — KpiTile then shows no delta. */
export function pctChange(cur: number, prev: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

export function fmtPct(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`;
}

export function fmtInt(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN");
}

const pad = (n: number) => String(n).padStart(2, "0");
function parse(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(String(v).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}
/** DD/MM/YYYY */
export function fmtDate(v: unknown): string {
  const d = parse(v);
  return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : "—";
}
/** DD/MM/YYYY HH:mm */
export function fmtDateTime(v: unknown): string {
  const d = parse(v);
  return d ? `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : "—";
}

/** Weekly trend rows -> chart data with DD/MM labels; zero-fills missing weeks (12 ending this week). */
export function fillWeeks(
  trend: Array<{ week_start: string; generated: number; actioned: number }>,
  now: Date = new Date(),
  weeks = 12,
): Array<{ week: string; label: string; generated: number; actioned: number }> {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const by = new Map(trend.map((t) => [String(t.week_start).slice(0, 10), t]));
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(monday);
    d.setDate(d.getDate() - i * 7);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const t = by.get(key);
    out.push({ week: key, label: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`, generated: t?.generated ?? 0, actioned: t?.actioned ?? 0 });
  }
  return out;
}

export interface SummaryApi {
  total_generated: number; action_taken_count: number; retained_count: number; exited_count: number;
  pending_count: number; retention_success_rate: number | null; avg_days_to_action: number | null;
  open_total?: number; overdue_count?: number; overdue_pct?: number | null;
  by_tier_open?: Record<Tier, number>;
  by_owner_open?: Record<Owner, number>;
  trend?: Array<{ week_start: string; generated: number; actioned: number }>;
  windows?: { generated_7d: number; generated_prev_7d: number; actioned_7d: number; actioned_prev_7d: number };
}

export interface Summary {
  total: number; actioned: number; retained: number; exited: number; pending: number;
  openTotal: number; overdue: number; overduePct: number | null;
  byTier: Record<Tier, number>; byOwner: Record<Owner, number>;
  actionRate: number | null; retentionRate: number | null; avgDaysToAction: number | null;
  trend: ReturnType<typeof fillWeeks>;
  generatedDelta: number | null; actionedDelta: number | null;
  generatedSpark: number[]; actionedSpark: number[];
}

export function adaptSummary(raw: SummaryApi | undefined, now: Date = new Date()): Summary {
  const num = (v: unknown) => Number(v) || 0;
  const total = num(raw?.total_generated);
  const actioned = num(raw?.action_taken_count);
  const trend = fillWeeks(raw?.trend ?? [], now);
  const w = raw?.windows;
  const tier = raw?.by_tier_open ?? ({} as Record<Tier, number>);
  const own = raw?.by_owner_open ?? ({} as Record<Owner, number>);
  return {
    total, actioned,
    retained: num(raw?.retained_count), exited: num(raw?.exited_count), pending: num(raw?.pending_count),
    openTotal: num(raw?.open_total), overdue: num(raw?.overdue_count), overduePct: raw?.overdue_pct ?? null,
    byTier: { CRITICAL: num(tier.CRITICAL), HIGH: num(tier.HIGH), MEDIUM: num(tier.MEDIUM), LOW: num(tier.LOW) },
    byOwner: { hr_admin: num(own.hr_admin), manager: num(own.manager), wfm: num(own.wfm), process_head: num(own.process_head) },
    // null (not 0%) when nothing has been generated: "no data" must not read as "0% acted on".
    actionRate: total > 0 ? Math.round((actioned / total) * 1000) / 10 : null,
    retentionRate: raw?.retention_success_rate ?? null,
    avgDaysToAction: raw?.avg_days_to_action ?? null,
    trend,
    generatedDelta: w ? pctChange(w.generated_7d, w.generated_prev_7d) : null,
    actionedDelta: w ? pctChange(w.actioned_7d, w.actioned_prev_7d) : null,
    generatedSpark: trend.map((t) => t.generated),
    actionedSpark: trend.map((t) => t.actioned),
  };
}
