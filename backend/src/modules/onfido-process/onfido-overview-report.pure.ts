/**
 * Pure helpers for the Onfido Overview / Analyst Performance / Utilization formats
 * (23-Sep-26 "HRMS Correction and new format"). No database access here, so every rule the
 * WFM sheets spell out (120% required HC, buffer %, the 220/75 utilization factor, the AON
 * buckets, the task-type grouping) is unit-tested in isolation.
 *
 * Honesty rule: an input that was never entered is `null`, and every figure that needs it is
 * `null` too. Nothing here substitutes 0 for "unknown".
 */

export type Granularity = "daily" | "weekly" | "monthly";

/** Required HC = Approved HC x 120% (Overview sheet, Manpower Status). */
export const REQUIRED_HC_FACTOR = 1.2;
/** Utilization sheet: a POA task counts as 220/75 DOC-task equivalents. */
export const POA_TASK_FACTOR = 220 / 75;
/** Utilization sheet: an Analyst QC unit counts as 1.2 task equivalents. */
export const ANALYST_QC_FACTOR = 1.2;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DAY.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** from/to must be real dates in order; returns an error message otherwise. */
export function validateRange(from: string | undefined, to: string | undefined): string | null {
  if (!from || !to || !isIsoDay(from) || !isIsoDay(to)) return "from and to must be valid dates (YYYY-MM-DD).";
  if (from > to) return "from must not be after to.";
  return null;
}

/** Monday of the week containing `day` (the sheet's "WC", = A - WEEKDAY(A,3)). */
export function weekCommencing(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  return d.toISOString().slice(0, 10);
}

/** Bucket label for a day, identical to the labels bucketLabel() produces for SQL buckets. */
export function bucketKeyForDay(day: string, granularity: Granularity): string {
  if (granularity === "daily") return day;
  if (granularity === "weekly") return weekCommencing(day);
  return day.slice(0, 7);
}

/** First and last day of the bucket that contains `day`. */
export function bucketBounds(day: string, granularity: Granularity): { start: string; end: string } {
  if (granularity === "daily") return { start: day, end: day };
  if (granularity === "weekly") {
    const start = weekCommencing(day);
    const e = new Date(`${start}T00:00:00Z`);
    e.setUTCDate(e.getUTCDate() + 6);
    return { start, end: e.toISOString().slice(0, 10) };
  }
  const [y, m] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${day.slice(0, 7)}-01`, end: `${day.slice(0, 7)}-${String(last).padStart(2, "0")}` };
}

export const round1 = (v: number): number => Math.round(v * 10) / 10;
export const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Percentage to one decimal; null when the denominator is missing or zero. */
export function pct1(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return round1((numerator / denominator) * 100);
}

// ── Manpower ─────────────────────────────────────────────────────────────────

export interface ManpowerFigures {
  approvedHc: number | null;
  requiredHc: number | null;
  activeHc: number | null;
  /** (Active - Approved) / Approved, as a percentage. */
  bufferPct: number | null;
  /** Required - Active; positive means short, negative means surplus. */
  shortfall: number | null;
}

export function computeManpower(approvedHc: number | null, activeHc: number | null): ManpowerFigures {
  const approved = approvedHc !== null && approvedHc > 0 ? approvedHc : null;
  const requiredHc = approved === null ? null : round2(approved * REQUIRED_HC_FACTOR);
  return {
    approvedHc: approved,
    requiredHc,
    activeHc,
    bufferPct: approved === null || activeHc === null ? null : round1(((activeHc - approved) / approved) * 100),
    shortfall: requiredHc === null || activeHc === null ? null : round2(requiredHc - activeHc),
  };
}

export type ProcessQueue = "EXTRACTION" | "POA" | "ENCORD";
export const PROCESS_QUEUES: readonly ProcessQueue[] = ["EXTRACTION", "POA", "ENCORD"];
export const QUEUE_LABELS: Record<ProcessQueue, string> = {
  EXTRACTION: "Extraction Queue",
  POA: "POA Queue",
  ENCORD: "Encord",
};

export interface ManpowerPlanRow {
  processQueue: ProcessQueue;
  /** YYYY-MM-DD */
  effectiveFrom: string;
  approvedHc: number;
  activeHc: number | null;
}

/** The plan row in force on `day`: the latest effective_from on or before it. */
export function planAsOf(rows: readonly ManpowerPlanRow[], queue: ProcessQueue, day: string): ManpowerPlanRow | null {
  let best: ManpowerPlanRow | null = null;
  for (const r of rows) {
    if (r.processQueue !== queue || r.effectiveFrom > day) continue;
    if (best === null || r.effectiveFrom > best.effectiveFrom) best = r;
  }
  return best;
}

/** Queues that have no approved-HC entry in force on `day`. */
export function queuesMissingPlan(rows: readonly ManpowerPlanRow[], day: string): ProcessQueue[] {
  return PROCESS_QUEUES.filter((q) => planAsOf(rows, q, day) === null);
}

/**
 * Total approved HC on `day`: the sum over the three queues, but only once every queue has an
 * entry (0 is a valid entry for a queue with no approved staff). A partial sum would be set
 * against the whole floor's Active HC and show a false shortfall, so it stays null instead.
 */
export function totalApprovedAsOf(rows: readonly ManpowerPlanRow[], day: string): number | null {
  if (queuesMissingPlan(rows, day).length > 0) return null;
  return PROCESS_QUEUES.reduce((sum, q) => sum + (planAsOf(rows, q, day)?.approvedHc ?? 0), 0);
}

// ── AON (tenure) ─────────────────────────────────────────────────────────────

export const AON_LABELS = ["0-30", "31-60", "61-90", "91-120", "121-180", "181-363", "Above 1 Year"] as const;
export type AonLabel = (typeof AON_LABELS)[number];

/** Overview sheet buckets, on live days. */
export function aonBucketForLiveDays(days: number | null): AonLabel | null {
  if (days === null || !Number.isFinite(days) || days < 0) return null;
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  if (days <= 120) return "91-120";
  if (days <= 180) return "121-180";
  if (days <= 363) return "181-363";
  return "Above 1 Year";
}

/** Label the drill-down uses for staff whose live days are not in the upload. */
export const UNCLASSIFIED_AON_LABEL = "Unclassified";

export interface AonRow { label: string; activeHc: number; contributionPct: number | null }

export function buildAonRows(byLiveDays: readonly { liveDays: number | null; hc: number }[]): { rows: AonRow[]; unclassifiedHc: number; totalHc: number } {
  const counts = new Map<AonLabel, number>(AON_LABELS.map((l) => [l, 0]));
  let unclassifiedHc = 0;
  for (const r of byLiveDays) {
    const label = aonBucketForLiveDays(r.liveDays);
    if (label === null) unclassifiedHc += r.hc;
    else counts.set(label, (counts.get(label) ?? 0) + r.hc);
  }
  const classified = [...counts.values()].reduce((a, b) => a + b, 0);
  return {
    rows: AON_LABELS.map((label) => ({
      label, activeHc: counts.get(label) ?? 0, contributionPct: pct1(counts.get(label) ?? 0, classified),
    })),
    unclassifiedHc,
    totalHc: classified + unclassifiedHc,
  };
}

// ── Attrition / shrinkage per bucket ─────────────────────────────────────────

export interface StaffingDay {
  day: string;
  /** On-floor HC that day. */
  hc: number;
  /** On-floor exits that day. */
  attrition: number;
  scheduled: number;
  unplannedLeave: number;
  actualUl: number;
}

export interface StaffingBucket {
  bucket: string;
  /** On-floor HC on the bucket's last available day. */
  activeHc: number;
  openingHc: number;
  avgHc: number;
  attrition: number;
  attritionPct: number | null;
  scheduled: number;
  shrinkagePct: number | null;
  ulShrinkagePct: number | null;
  lastDay: string;
}

/**
 * Attrition % = exits / ((opening HC + closing HC) / 2), the business's own two-point
 * average (identical to getAttritionMonthlyDetail for a calendar month). Shrinkage % =
 * actual UL / scheduled. Both are period ratios: a weekly figure is that week's rate,
 * not an annualised one.
 */
export function aggregateStaffing(days: readonly StaffingDay[], granularity: Granularity): StaffingBucket[] {
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
  const groups = new Map<string, StaffingDay[]>();
  for (const d of sorted) {
    const key = bucketKeyForDay(d.day, granularity);
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  return [...groups.entries()].map(([bucket, rows]) => {
    const first = rows[0];
    const last = rows[rows.length - 1];
    const avgHc = round2((first.hc + last.hc) / 2);
    const attrition = rows.reduce((s, r) => s + r.attrition, 0);
    const scheduled = rows.reduce((s, r) => s + r.scheduled, 0);
    const actualUl = rows.reduce((s, r) => s + r.actualUl, 0);
    const ul = rows.reduce((s, r) => s + r.unplannedLeave, 0);
    return {
      bucket, activeHc: last.hc, openingHc: first.hc, avgHc, attrition,
      attritionPct: avgHc > 0 ? round2((attrition / avgHc) * 100) : null,
      scheduled,
      shrinkagePct: scheduled > 0 ? round2((actualUl / scheduled) * 100) : null,
      ulShrinkagePct: scheduled > 0 ? round2((ul / scheduled) * 100) : null,
      lastDay: last.day,
    };
  });
}

// ── Task-type grouping ───────────────────────────────────────────────────────

export const DOC_TASK_GROUPS = ["Classification", "EWYS Address", "Consistency", "Extraction", "EWYS", "Labelling", "Other"] as const;
export type DocTaskGroup = (typeof DOC_TASK_GROUPS)[number];

/**
 * Maps a raw task-type string ("process_labelling_document_raw_extraction", ...) to one of
 * the sheet's rows. Order matters: labelling and address tasks also contain "extraction" /
 * "ewys", so the more specific names are tested first. Anything that matches none is
 * reported as "Other" rather than being forced into a row.
 */
export function classifyTaskType(raw: string | null | undefined): DocTaskGroup {
  const t = String(raw ?? "").toLowerCase();
  if (t.includes("label")) return "Labelling";
  if (t.includes("address")) return "EWYS Address";
  if (t.includes("consist")) return "Consistency";
  if (t.includes("classif")) return "Classification";
  if (t.includes("ewys")) return "EWYS";
  if (t.includes("extract")) return "Extraction";
  return "Other";
}

// ── Utilization (Utilization Format.xlsx) ────────────────────────────────────

export interface UtilizationInputs {
  forecastTask: number | null;
  forecastTaskPoa: number | null;
  actualTask: number | null;
  manualFarCases: number | null;
  poaLive: number | null;
  adhocTime: number | null;
  analystQc: number | null;
  facialChecks: number | null;
  crossTrainingTaskPoa: number | null;
  poaLiveAuditsPq: number | null;
  escalatedTask: number | null;
}

export interface UtilizationDerived {
  /** F = D + E*(220/75) */
  utilizationForecast: number | null;
  /** U = G+H+I*(220/75)+J+K*1.2+M*(220/75)+N*(220/75) */
  utilizationWithAdhoc: number | null;
  /** V = G + I*(220/75) */
  utilizationWithoutAdhoc: number | null;
  /** W = U / F, in percent */
  utilizationWithAdhocPct: number | null;
  /** X = V / F, in percent */
  utilizationWithoutAdhocPct: number | null;
  /** Y = I / E, in percent */
  poaAnsweringPct: number | null;
  /** AA = Z / G, in percent */
  escalatedPct: number | null;
}

type Num = number | null;

/** Evaluates `fn` only when every argument is a number; otherwise the result is unknown. */
function whenKnown(args: readonly Num[], fn: (v: number[]) => number): number | null {
  if (args.some((a) => a === null || !Number.isFinite(a))) return null;
  const out = fn(args as number[]);
  return Number.isFinite(out) ? out : null;
}

function ratioPct(n: Num, d: Num): number | null {
  if (n === null || d === null || d === 0) return null;
  return (n / d) * 100;
}

export function computeUtilization(i: UtilizationInputs): UtilizationDerived {
  const F = whenKnown([i.forecastTask, i.forecastTaskPoa], ([d, e]) => d + e * POA_TASK_FACTOR);
  const U = whenKnown(
    [i.actualTask, i.manualFarCases, i.poaLive, i.adhocTime, i.analystQc, i.crossTrainingTaskPoa, i.poaLiveAuditsPq],
    ([g, h, poa, j, k, m, n]) => g + h + poa * POA_TASK_FACTOR + j + k * ANALYST_QC_FACTOR + m * POA_TASK_FACTOR + n * POA_TASK_FACTOR,
  );
  const V = whenKnown([i.actualTask, i.poaLive], ([g, poa]) => g + poa * POA_TASK_FACTOR);
  return {
    utilizationForecast: F,
    utilizationWithAdhoc: U,
    utilizationWithoutAdhoc: V,
    utilizationWithAdhocPct: ratioPct(U, F),
    utilizationWithoutAdhocPct: ratioPct(V, F),
    poaAnsweringPct: ratioPct(i.poaLive, i.forecastTaskPoa),
    escalatedPct: ratioPct(i.escalatedTask, i.actualTask),
  };
}

/** Column total for the MTD row: the sum, or null when any day is missing (a partial sum would mislead). */
export function sumComplete(values: readonly Num[]): number | null {
  if (values.length === 0 || values.some((v) => v === null)) return null;
  return (values as number[]).reduce((a, b) => a + b, 0);
}

/** Excel AVERAGE: blanks are ignored. */
export function averageKnown(values: readonly Num[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0) / known.length;
}

// ── Chart / table matrices ───────────────────────────────────────────────────

/** One labelled series across the shared bucket axis; null = no data for that bucket. */
export interface MatrixRow { label: string; values: (number | null)[] }
export interface Matrix { buckets: string[]; rows: MatrixRow[] }

/**
 * Aligns several sparse series onto one sorted bucket axis. A series with no point for a
 * bucket gets null there (a gap in the line), never 0.
 */
export function buildMatrix(series: readonly { label: string; points: ReadonlyMap<string, number | null> }[]): Matrix {
  const buckets = [...new Set(series.flatMap((s) => [...s.points.keys()]))].sort();
  return {
    buckets,
    rows: series.map((s) => ({ label: s.label, values: buckets.map((b) => s.points.get(b) ?? null) })),
  };
}

export interface TaskTypeAccumulator { taskCount: number; ahtWeighted: number; ahtCount: number }

/** Sums counts and count-weights AHTs per task-type group for one bucket's raw task types. */
export function groupTaskTypes(
  byTaskType: Readonly<Record<string, { taskCount: number; avgAht: number | null }>>,
): Map<DocTaskGroup, TaskTypeAccumulator> {
  const out = new Map<DocTaskGroup, TaskTypeAccumulator>();
  for (const [raw, v] of Object.entries(byTaskType)) {
    const group = classifyTaskType(raw);
    const acc = out.get(group) ?? { taskCount: 0, ahtWeighted: 0, ahtCount: 0 };
    acc.taskCount += v.taskCount;
    if (v.avgAht !== null) { acc.ahtWeighted += v.avgAht * v.taskCount; acc.ahtCount += v.taskCount; }
    out.set(group, acc);
  }
  return out;
}

/** MTD inputs = per-column complete sums over the days shown. */
export function sumInputs(rows: readonly UtilizationInputs[]): UtilizationInputs {
  const col = (pick: (r: UtilizationInputs) => Num): Num => sumComplete(rows.map(pick));
  return {
    forecastTask: col((r) => r.forecastTask),
    forecastTaskPoa: col((r) => r.forecastTaskPoa),
    actualTask: col((r) => r.actualTask),
    manualFarCases: col((r) => r.manualFarCases),
    poaLive: col((r) => r.poaLive),
    adhocTime: col((r) => r.adhocTime),
    analystQc: col((r) => r.analystQc),
    facialChecks: col((r) => r.facialChecks),
    crossTrainingTaskPoa: col((r) => r.crossTrainingTaskPoa),
    poaLiveAuditsPq: col((r) => r.poaLiveAuditsPq),
    escalatedTask: col((r) => r.escalatedTask),
  };
}
