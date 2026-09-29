export type OpsDimension = "all" | "branch" | "process" | "lob" | "manager" | "employee";
export type OpsUnit = "count" | "pct" | "hours" | "minutes" | "days";
export type OpsDirection = "higher_is_better" | "lower_is_better" | "neutral";
export type OpsRecordDomain =
  | "headcount" | "joiners" | "exits" | "notice" | "absent" | "late" | "unrostered"
  | "warnings" | "pip" | "training_risk" | "low_quality" | "at_risk";

export interface OpsMetricDef {
  id: string;
  label: string;
  domain: string;
  unit: OpsUnit;
  direction: OpsDirection;
  formula: string;
  warn?: number;
  bad?: number;
  records?: OpsRecordDomain;
}

export interface OpsQuery {
  from?: string;
  to?: string;
  branchId?: string;
  processId?: string;
  lobId?: string;
  managerId?: string;
}

export type MetricValues = Record<string, number | null>;

export interface OpsPeriod {
  from: string;
  to: string;
  attendanceThrough: string;
  today: string;
}

export interface OpsRow {
  id: string;
  name: string;
  sub: string | null;
  m: MetricValues;
}

export interface OpsSummary {
  period: OpsPeriod;
  scopeLevel: string;
  totals: { current: MetricValues; previous: MetricValues };
  groupBy: OpsDimension;
  rows: OpsRow[];
  totalRows: number;
  externalQualityAvailable: boolean;
}

export interface FilterOption { id: string; name: string; sub?: string | null }
export interface OpsFilterOptions {
  branches: FilterOption[];
  processes: FilterOption[];
  lobs: FilterOption[];
  managers: FilterOption[];
  period: OpsPeriod;
}

export interface TrendPoint {
  date: string;
  attendancePct: number | null;
  shrinkagePct: number | null;
  absentPct: number | null;
  latePct: number | null;
  exits: number;
  joiners: number;
}

export interface PerfMetricMeta {
  key: string; label: string; unit: string | null;
  direction: "higher_is_better" | "lower_is_better"; category: string | null; family: string | null;
}
export interface PerfCell {
  value: number | null; target: number | null; achievementPct: number | null;
  status: "on_track" | "watch" | "off_track" | "no_target";
}
export interface PerfRow { id: string; name: string; sub: string | null; cells: Record<string, PerfCell> }
export interface PerfResponse { metrics: PerfMetricMeta[]; rows: PerfRow[]; grain: "process" | "analyst" }

export interface RecordColumn { key: string; label: string; type?: "text" | "date" | "number" | "pct" }
export interface RecordsResponse {
  domain: OpsRecordDomain;
  title: string;
  columns: RecordColumn[];
  rows: Array<Record<string, string | number | null>>;
  total: number;
}

export type Tone = "good" | "warn" | "bad" | "neutral";

export function toneFor(def: OpsMetricDef | undefined, value: number | null | undefined): Tone {
  if (!def || value === null || value === undefined || def.warn === undefined || def.bad === undefined) return "neutral";
  if (def.direction === "higher_is_better") return value < def.bad ? "bad" : value < def.warn ? "warn" : "good";
  if (def.direction === "lower_is_better") return value > def.bad ? "bad" : value > def.warn ? "warn" : "good";
  return "neutral";
}

export const TONE_TEXT: Record<Tone, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-rose-600 dark:text-rose-400",
  neutral: "text-foreground",
};

export function formatMetric(value: number | null | undefined, unit: OpsUnit | string | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  switch (unit) {
    case "pct": return `${value.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`;
    case "hours": return `${value.toLocaleString("en-IN", { maximumFractionDigits: 1 })} h`;
    case "minutes": return `${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })} min`;
    default: return value.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  }
}

/** DD/MM/YYYY from an ISO date (yyyy-mm-dd) — the platform's display format. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Change vs the previous period, oriented so "good" is always green. */
export function deltaOf(cur: number | null | undefined, prev: number | null | undefined, direction: OpsDirection) {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return null;
  const diff = Math.round((cur - prev) * 10) / 10;
  if (diff === 0) return { diff, tone: "neutral" as Tone };
  const up = diff > 0;
  const tone: Tone = direction === "neutral" ? "neutral" : (direction === "higher_is_better") === up ? "good" : "bad";
  return { diff, tone };
}
