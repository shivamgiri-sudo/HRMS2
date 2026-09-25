/**
 * Pure logic for the Outliers & Actions view: which analysts are outside target, by how much, whether
 * the same analyst was also outside target in the periods just before (a chronic issue rather than a
 * one-off), and which action - if any - is already logged against them.
 */

/** Metrics that carry a target in the dashboard's own alert thresholds (FAR/FRR are not shown on any dashboard). */
export const OUTLIER_METRICS = ["Overall Error %", "POA Error %"] as const;
export type OutlierMetric = (typeof OUTLIER_METRICS)[number];

/** How many periods of the same length, immediately before the selected one, are checked for a repeat. */
export const REPEAT_LOOKBACK_PERIODS = 3;

export interface AlertLike {
  analystEmail: string;
  tlName: string | null;
  amName: string | null;
  metric: string;
  value: number;
  threshold: number;
  severity: "high" | "medium";
}

export type ActionStatus = "open" | "in_progress" | "closed";

export interface ActionSummary {
  id: string;
  analystEmail: string;
  metric: string;
  status: ActionStatus;
  dueDate: string | null;
  ownerName: string | null;
}

export interface OutlierRow {
  analystEmail: string;
  tlName: string | null;
  amName: string | null;
  metric: OutlierMetric;
  value: number;
  target: number;
  /** value - target, in the metric's own unit (percentage points). Positive = worse than target. */
  variance: number;
  severity: "high" | "medium";
  /** Of the latest WEEKLY_LOOKBACK weekly windows ending at the range end, how many the analyst was over target in. */
  flaggedWeeks: number;
  pattern: OutlierPattern;
  /** Unbroken run of flagged weekly windows counting back from the latest one (0 = latest week was fine). */
  streak: number;
  repeat: boolean;
  action: ActionSummary | null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

const toUtc = (ymd: string): number => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const toYmd = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The `count` equal-length periods immediately before [from, to], nearest first. */
export function previousPeriods(
  from: string,
  to: string,
  count: number = REPEAT_LOOKBACK_PERIODS,
): { from: string; to: string }[] {
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to) || to < from) return [];
  const lengthDays = Math.round((toUtc(to) - toUtc(from)) / MS_PER_DAY) + 1;
  const periods: { from: string; to: string }[] = [];
  let periodEnd = toUtc(from) - MS_PER_DAY;
  for (let i = 0; i < count; i += 1) {
    const periodStart = periodEnd - (lengthDays - 1) * MS_PER_DAY;
    periods.push({ from: toYmd(periodStart), to: toYmd(periodEnd) });
    periodEnd = periodStart - MS_PER_DAY;
  }
  return periods;
}

/** Number of rolling 7-day windows (ending at the range end) used to judge whether an outlier is chronic. */
export const WEEKLY_LOOKBACK = 4;

/** The latest `count` rolling 7-day windows ending at `to`, newest first. Independent of the range length. */
export function recentWeeks(to: string, count: number = WEEKLY_LOOKBACK): { from: string; to: string }[] {
  if (!ISO_DAY.test(to)) return [];
  const weeks: { from: string; to: string }[] = [];
  for (let i = 0; i < count; i += 1) {
    const end = toUtc(to) - i * 7 * MS_PER_DAY;
    weeks.push({ from: toYmd(end - 6 * MS_PER_DAY), to: toYmd(end) });
  }
  return weeks;
}

export type OutlierPattern = "repeat" | "intermittent" | "new" | "recovering";

/** repeat = over target in the latest 2+ weeks running; recovering = over target earlier but fine in the latest week. */
export function patternOf(streak: number, flaggedWeeks: number): OutlierPattern {
  if (streak >= 2) return "repeat";
  if (streak === 0) return "recovering";
  return flaggedWeeks > 1 ? "intermittent" : "new";
}

/** Unbroken run of `true` from the start of the list (nearest period first). */
export function leadingRun(flags: boolean[]): number {
  let run = 0;
  for (const flagged of flags) {
    if (!flagged) break;
    run += 1;
  }
  return run;
}

const keyOf = (analystEmail: string, metric: string): string =>
  `${analystEmail.toLowerCase()}|${metric}`;

const isOutlierMetric = (metric: string): metric is OutlierMetric =>
  (OUTLIER_METRICS as readonly string[]).includes(metric);

/** The newest still-relevant action per analyst+metric: an open/in-progress one beats a closed one. */
function actionIndex(actions: ActionSummary[]): Map<string, ActionSummary> {
  const rank: Record<ActionStatus, number> = {
    open: 2,
    in_progress: 2,
    closed: 1,
  };
  const byKey = new Map<string, ActionSummary>();
  for (const action of actions) {
    const key = keyOf(action.analystEmail, action.metric);
    const existing = byKey.get(key);
    if (!existing || rank[action.status] > rank[existing.status])
      byKey.set(key, action);
  }
  return byKey;
}

export function buildOutlierRows(
  current: AlertLike[],
  priorPeriodAlerts: AlertLike[][],
  actions: ActionSummary[],
): OutlierRow[] {
  const flaggedByPeriod = priorPeriodAlerts.map(
    (alerts) => new Set(alerts.map((a) => keyOf(a.analystEmail, a.metric))),
  );
  const actionByKey = actionIndex(actions);
  const rows: OutlierRow[] = [];
  for (const alert of current) {
    if (!isOutlierMetric(alert.metric)) continue;
    const key = keyOf(alert.analystEmail, alert.metric);
    const flags = flaggedByPeriod.map((set) => set.has(key));
    const flaggedWeeks = flags.filter(Boolean).length;
    const streak = leadingRun(flags);
    rows.push({
      analystEmail: alert.analystEmail,
      tlName: alert.tlName,
      amName: alert.amName,
      metric: alert.metric,
      value: alert.value,
      target: alert.threshold,
      variance: Math.round((alert.value - alert.threshold) * 10) / 10,
      severity: alert.severity,
      flaggedWeeks,
      pattern: patternOf(streak, flaggedWeeks),
      streak,
      repeat: streak >= 2,
      action: actionByKey.get(key) ?? null,
    });
  }
  // Worst first: chronic issues, then the biggest miss.
  return rows.sort(
    (a, b) =>
      Number(b.repeat) - Number(a.repeat) ||
      b.streak - a.streak ||
      b.variance - a.variance,
  );
}

export interface TargetTile {
  key: string;
  label: string;
  /** null = no target has been defined for this metric, so no variance is claimed. */
  target: number | null;
  achievement: number | null;
  variance: number | null;
  unit: "percent" | "seconds";
  /** For error rates lower is better; the tile colours variance accordingly. */
  lowerIsBetter: boolean;
  onTarget: boolean | null;
}

export function buildTargetTile(
  key: string,
  label: string,
  achievement: number | null,
  target: number | null,
  unit: TargetTile["unit"],
  lowerIsBetter: boolean,
): TargetTile {
  const rounded =
    achievement === null ? null : Math.round(achievement * 100) / 100;
  const variance =
    rounded !== null && target !== null
      ? Math.round((rounded - target) * 100) / 100
      : null;
  const onTarget =
    variance === null ? null : lowerIsBetter ? variance <= 0 : variance >= 0;
  return {
    key,
    label,
    target,
    achievement: rounded,
    variance,
    unit,
    lowerIsBetter,
    onTarget,
  };
}
