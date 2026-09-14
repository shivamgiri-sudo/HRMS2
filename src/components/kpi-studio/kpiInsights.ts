/**
 * Turns a KPI's raw trend into the three things somebody opening their dashboard actually wants to
 * know: what got better, what got worse, and what needs doing something about.
 *
 * Pure functions in their own module so the direction handling can be unit-tested exhaustively. It
 * has to be: for a lower-is-better KPI like handle time a FALLING number is an improvement, and
 * getting that backwards would congratulate an agent for a metric that deteriorated. That is the
 * kind of bug that survives code review and is caught only by someone noticing the dashboard is
 * praising the wrong thing.
 */

export interface TrendPoint {
  date: string;
  value: number;
  source?: string;
}

export interface KpiLike {
  metric_id: string;
  metric_code: string;
  metric_name: string;
  unit: string;
  direction: string;
  target_value: number;
  min_threshold: number | null;
  actual_value: number | null;
  score_pct: number;
  trend_data: TrendPoint[];
}

export interface MetricMovement {
  metric_id: string;
  metric_code: string;
  metric_name: string;
  unit: string;
  /** Most recent measured value. */
  latest: number;
  /** The measured value before it, on whatever the previous measured day was. */
  previous: number;
  /** Signed change in the raw value. Negative means the number went down. */
  change: number;
  /** Change as a percentage of the previous value. Null when previous was zero. */
  changePct: number | null;
  /** True when the change is in the direction that counts as better for this KPI. */
  improved: boolean;
  latestDate: string;
  previousDate: string;
}

/** Why a KPI is flagged. Ordered by how urgently it needs a human. */
export type AttentionKind = "breached" | "far_below" | "declining" | "stale" | "never";

export interface AttentionItem {
  metric_id: string;
  metric_code: string;
  metric_name: string;
  kind: AttentionKind;
  /** One sentence, written to be read by the person being measured. */
  message: string;
  scorePct: number | null;
}

/**
 * Compares the two most recent measured days.
 *
 * Deliberately NOT "yesterday versus the day before" by calendar: an agent on week-off yesterday has
 * no row for it, and comparing against a missing day would either invent a zero or report no
 * movement. Comparing the last two days that actually have data answers the real question — "am I
 * doing better than last time I worked" — and reports the dates so the user can see what was
 * compared.
 */
export function computeMovement(kpi: KpiLike): MetricMovement | null {
  const points = [...(kpi.trend_data ?? [])]
    .filter((point) => Number.isFinite(Number(point.value)))
    .sort((left, right) => left.date.localeCompare(right.date));

  if (points.length < 2) return null;

  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  const latestValue = Number(latest.value);
  const previousValue = Number(previous.value);
  const change = latestValue - previousValue;

  // No movement is not an improvement and not a decline; excluding it keeps both lists meaningful.
  if (change === 0) return null;

  const lowerIsBetter = kpi.direction === "lower_is_better";

  return {
    metric_id: kpi.metric_id,
    metric_code: kpi.metric_code,
    metric_name: kpi.metric_name,
    unit: kpi.unit,
    latest: latestValue,
    previous: previousValue,
    change,
    changePct: previousValue === 0 ? null : (change / Math.abs(previousValue)) * 100,
    improved: lowerIsBetter ? change < 0 : change > 0,
    latestDate: latest.date,
    previousDate: previous.date,
  };
}

/** Improvements and declines, each biggest-first. */
export function splitMovements(kpis: readonly KpiLike[]): { improved: MetricMovement[]; declined: MetricMovement[] } {
  const movements = kpis.map(computeMovement).filter((movement): movement is MetricMovement => movement !== null);

  // Ranked by relative change, not absolute: 40 seconds on a 4,000-second total is noise, while 40
  // seconds on a 200-second average is a third of the metric. Absolute ranking would put every
  // large-magnitude KPI at the top regardless of significance.
  const magnitude = (movement: MetricMovement) =>
    movement.changePct === null ? Math.abs(movement.change) : Math.abs(movement.changePct);

  return {
    improved: movements.filter((movement) => movement.improved).sort((left, right) => magnitude(right) - magnitude(left)),
    declined: movements.filter((movement) => !movement.improved).sort((left, right) => magnitude(right) - magnitude(left)),
  };
}

/**
 * Threshold below which a score is called out rather than merely shown.
 *
 * 60 matches the existing rating bands in this system, where below 60 is the bottom band. Choosing a
 * different number here would mean the dashboard flags a KPI the rating scale calls acceptable.
 */
const FAR_BELOW_SCORE = 60;

/** Days without a value before a KPI is reported as stale rather than simply low. */
const STALE_DAYS = 3;

/**
 * KPIs that need a human to do something, worst first.
 *
 * "Needs attention" deliberately includes the two cases a score alone cannot express:
 *
 *  - stale: no data for several days. A KPI with no recent data is not a good score or a bad one,
 *    and showing it as 0 or as its week-old average both mislead. This is the case that catches a
 *    broken source or a mis-mapped column, which is otherwise invisible.
 *  - never: no data at all. Usually means the KPI is configured but nothing feeds it yet — an
 *    actionable configuration gap, not a performance problem, and it must not read as one.
 */
export function findAttentionItems(kpis: readonly KpiLike[], today = new Date()): AttentionItem[] {
  const items: AttentionItem[] = [];
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  for (const kpi of kpis) {
    const lowerIsBetter = kpi.direction === "lower_is_better";
    const points = [...(kpi.trend_data ?? [])].sort((left, right) => left.date.localeCompare(right.date));
    const latest = points[points.length - 1];

    if (kpi.actual_value === null || !latest) {
      items.push({
        metric_id: kpi.metric_id,
        metric_code: kpi.metric_code,
        metric_name: kpi.metric_name,
        kind: "never",
        message: `No data has arrived for ${kpi.metric_name} in this period.`,
        scorePct: null,
      });
      continue;
    }

    const latestMs = Date.parse(`${latest.date}T00:00:00Z`);
    const daysStale = Number.isFinite(latestMs) ? Math.floor((todayMs - latestMs) / 86_400_000) : 0;

    if (daysStale >= STALE_DAYS) {
      items.push({
        metric_id: kpi.metric_id,
        metric_code: kpi.metric_code,
        metric_name: kpi.metric_name,
        kind: "stale",
        message: `${kpi.metric_name} has had no new data for ${daysStale} days. The figure shown is from ${latest.date}.`,
        scorePct: kpi.score_pct,
      });
      continue;
    }

    // The threshold sits on the worse side of the target, so which comparison counts as a breach
    // depends on the direction. Getting this the wrong way round would flag everybody doing well.
    const breached =
      kpi.min_threshold !== null &&
      (lowerIsBetter ? kpi.actual_value > kpi.min_threshold : kpi.actual_value < kpi.min_threshold);

    if (breached) {
      items.push({
        metric_id: kpi.metric_id,
        metric_code: kpi.metric_code,
        metric_name: kpi.metric_name,
        kind: "breached",
        message: lowerIsBetter
          ? `${kpi.metric_name} is ${kpi.actual_value}, past the ${kpi.min_threshold} limit.`
          : `${kpi.metric_name} is ${kpi.actual_value}, below the ${kpi.min_threshold} minimum.`,
        scorePct: kpi.score_pct,
      });
      continue;
    }

    if (kpi.score_pct < FAR_BELOW_SCORE) {
      items.push({
        metric_id: kpi.metric_id,
        metric_code: kpi.metric_code,
        metric_name: kpi.metric_name,
        kind: "far_below",
        message: `${kpi.metric_name} is at ${Math.round(kpi.score_pct)}% of target.`,
        scorePct: kpi.score_pct,
      });
      continue;
    }

    // A KPI still above target but sliding for three consecutive readings is the one worth catching
    // early, since by the time the score drops it is already a problem.
    if (points.length >= 3) {
      const [third, second, first] = [points[points.length - 3], points[points.length - 2], points[points.length - 1]];
      const consistentlyWorse = lowerIsBetter
        ? Number(first.value) > Number(second.value) && Number(second.value) > Number(third.value)
        : Number(first.value) < Number(second.value) && Number(second.value) < Number(third.value);
      if (consistentlyWorse) {
        items.push({
          metric_id: kpi.metric_id,
          metric_code: kpi.metric_code,
          metric_name: kpi.metric_name,
          kind: "declining",
          message: `${kpi.metric_name} has moved the wrong way three readings in a row, though it is still on target.`,
          scorePct: kpi.score_pct,
        });
      }
    }
  }

  const ORDER: Record<AttentionKind, number> = { breached: 0, far_below: 1, stale: 2, declining: 3, never: 4 };
  return items.sort((left, right) => ORDER[left.kind] - ORDER[right.kind]);
}

/** Formats a value for display, matching how the existing KPI cards render each unit. */
export function formatKpiValue(value: number | null, unit: string): string {
  if (value === null) return "—";
  if (unit === "seconds") {
    const minutes = Math.floor(value / 60);
    const seconds = Math.round(value % 60);
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }
  if (unit === "percent") return `${Math.round(value * 10) / 10}%`;
  if (unit === "currency") return `₹${value.toLocaleString()}`;
  if (unit === "hours") return `${Math.round(value * 10) / 10}h`;
  return String(Math.round(value * 10) / 10);
}
