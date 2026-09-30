/**
 * Pure statistics behind the metric drill-down: everything the hero, charts and "what this says"
 * text derive from the day-by-day readings, so the maths is testable and the components stay dumb.
 * Reads only what GET /api/process-operations/:id/metric/:key already returns.
 */

export interface DrillReading { date: string; value: number | null; numerator: number | null; denominator: number | null; note?: string | null; source?: string | null }
export type DayStatus = "pass" | "fail" | "none";

export interface DrillPoint {
  date: string; value: number; numerator: number | null; denominator: number | null;
  status: DayStatus; gap: number | null; ma: number | null; weekday: number;
}
export interface DrillInput { readings: DrillReading[]; target: number | null; direction: string | null }

export interface Extreme { date: string; value: number }
export interface WeekdayStat { weekday: number; label: string; avg: number | null; n: number; pass: number; fail: number }
export interface CalendarCell { date: string; value: number | null; status: DayStatus | "missing" }
export interface Bin { from: number; to: number; count: number; hasTarget: boolean; label: string }
export interface Insight { tone: "good" | "warn" | "bad" | "info"; text: string }

export interface DrillStats {
  points: DrillPoint[];
  n: number;
  latest: DrillPoint | null;
  mean: number | null; median: number | null; stdDev: number | null;
  best: Extreme | null; worst: Extreme | null;
  passDays: number; failDays: number; noTargetDays: number; passPct: number | null;
  streak: { status: DayStatus; length: number } | null;
  slopePerDay: number | null; r2: number | null;
  last7Avg: number | null; prev7Avg: number | null;
  volumeTotal: number | null; volumeAvg: number | null; numeratorTotal: number | null;
  weekdays: WeekdayStat[];
  calendar: CalendarCell[][];
  bins: Bin[];
  insights: Insight[];
}

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday=0 … Sunday=6, from a local YYYY-MM-DD (never toISOString, which shifts a day in IST). */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

export function statusOn(value: number, target: number | null, direction: string | null): DayStatus {
  if (target === null || !direction) return "none";
  return (direction === "higher_is_better" ? value >= target : value <= target) ? "pass" : "fail";
}

function mean(xs: number[]): number | null { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function stdDev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const mu = mean(xs) as number;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (xs.length - 1));
}

/** Least-squares slope of value against day index, and how much of the variance that line explains. */
export function trendLine(values: number[]): { slope: number; r2: number } | null {
  const n = values.length;
  if (n < 4) return null;
  const xs = values.map((_, i) => i);
  const mx = mean(xs) as number, my = mean(values) as number;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (values[i] - my); syy += (values[i] - my) ** 2; }
  if (sxx === 0) return null;
  return { slope: sxy / sxx, r2: syy === 0 ? 0 : (sxy * sxy) / (sxx * syy) };
}

export function movingAverage(values: number[], window = 7): Array<number | null> {
  return values.map((_, i) => (i + 1 < Math.min(window, 3) ? null : (mean(values.slice(Math.max(0, i - window + 1), i + 1)) as number)));
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/** Weeks (Mon..Sun columns) covering the first to the last reading, so missing days show as gaps. */
export function buildCalendar(points: DrillPoint[]): CalendarCell[][] {
  if (!points.length) return [];
  const byDate = new Map(points.map((p) => [p.date, p]));
  const first = points[0].date, last = points[points.length - 1].date;
  let cursor = addDays(first, -weekdayOf(first));
  const weeks: CalendarCell[][] = [];
  while (cursor <= last) {
    const week: CalendarCell[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(cursor, i);
      const p = byDate.get(date);
      week.push(date < first || date > last ? { date, value: null, status: "missing" } : p ? { date, value: p.value, status: p.status } : { date, value: null, status: "missing" });
    }
    weeks.push(week);
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

export function buildBins(values: number[], target: number | null, count = 8): Bin[] {
  if (values.length < 3) return [];
  let lo = Math.min(...values), hi = Math.max(...values);
  if (target !== null) { lo = Math.min(lo, target); hi = Math.max(hi, target); }
  if (hi === lo) return [];
  const step = (hi - lo) / count;
  const bins: Bin[] = Array.from({ length: count }, (_, i) => ({ from: lo + i * step, to: lo + (i + 1) * step, count: 0, hasTarget: false, label: "" }));
  for (const v of values) bins[Math.min(count - 1, Math.floor((v - lo) / step))].count++;
  if (target !== null) bins[Math.min(count - 1, Math.floor((target - lo) / step))].hasTarget = true;
  const dec = step >= 10 ? 0 : step >= 1 ? 1 : 2;
  bins.forEach((b) => { b.label = `${b.from.toFixed(dec)}–${b.to.toFixed(dec)}`; });
  return bins;
}

/** `gapFmt` formats a distance to target (percent metrics say "pt", not "%"); defaults to `fmt`. */
export function computeDrillStats({ readings, target, direction }: DrillInput, fmt: (v: number) => string = (v) => v.toFixed(1), gapFmt: (v: number) => string = fmt): DrillStats {
  const clean = readings.filter((r) => r.value !== null).map((r) => ({ ...r, value: r.value as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const ma = movingAverage(clean.map((r) => r.value));
  const points: DrillPoint[] = clean.map((r, i) => ({
    date: r.date, value: r.value, numerator: r.numerator, denominator: r.denominator,
    status: statusOn(r.value, target, direction), ma: ma[i], weekday: weekdayOf(r.date),
    gap: target === null ? null : (direction === "higher_is_better" ? target - r.value : r.value - target),
  }));
  const values = points.map((p) => p.value);
  const latest = points.length ? points[points.length - 1] : null;
  const best = points.length ? points.reduce((b, p) => (better(p.value, b.value, direction) ? p : b)) : null;
  const worst = points.length ? points.reduce((b, p) => (better(b.value, p.value, direction) ? p : b)) : null;
  const passDays = points.filter((p) => p.status === "pass").length;
  const failDays = points.filter((p) => p.status === "fail").length;
  const noTargetDays = points.filter((p) => p.status === "none").length;

  let streak: DrillStats["streak"] = null;
  if (latest) {
    let len = 0;
    for (let i = points.length - 1; i >= 0 && points[i].status === latest.status; i--) len++;
    streak = { status: latest.status, length: len };
  }

  const tl = trendLine(values);
  const last7 = values.slice(-7), prev7 = values.slice(-14, -7);
  const vols = points.map((p) => p.denominator).filter((x): x is number => x !== null);
  const nums = points.map((p) => p.numerator).filter((x): x is number => x !== null);

  const weekdays: WeekdayStat[] = WEEKDAY_LABELS.map((label, weekday) => {
    const ps = points.filter((p) => p.weekday === weekday);
    return { weekday, label, avg: mean(ps.map((p) => p.value)), n: ps.length, pass: ps.filter((p) => p.status === "pass").length, fail: ps.filter((p) => p.status === "fail").length };
  });

  const stats: DrillStats = {
    points, n: points.length, latest,
    mean: mean(values), median: median(values), stdDev: stdDev(values), best, worst: worst,
    passDays, failDays, noTargetDays, passPct: passDays + failDays > 0 ? Math.round((100 * passDays) / (passDays + failDays)) : null,
    streak, slopePerDay: tl?.slope ?? null, r2: tl?.r2 ?? null,
    last7Avg: mean(last7), prev7Avg: prev7.length >= 3 ? mean(prev7) : null,
    volumeTotal: vols.length ? vols.reduce((a, b) => a + b, 0) : null, volumeAvg: mean(vols), numeratorTotal: nums.length ? nums.reduce((a, b) => a + b, 0) : null,
    weekdays, calendar: buildCalendar(points), bins: buildBins(values, target), insights: [],
  };
  stats.insights = buildInsights(stats, target, direction, fmt, gapFmt);
  return stats;
}

function better(a: number, b: number, direction: string | null): boolean {
  return direction === "lower_is_better" ? a < b : a > b;
}

export function buildInsights(s: DrillStats, target: number | null, direction: string | null, fmt: (v: number) => string, gapFmt: (v: number) => string = fmt): Insight[] {
  const out: Insight[] = [];
  if (!s.latest) return out;
  const higher = direction !== "lower_is_better";
  if (target !== null && direction) {
    if (s.latest.status === "fail") {
      out.push({ tone: "bad", text: `Latest reading ${fmt(s.latest.value)} is ${gapFmt(Math.abs(s.latest.gap as number))} ${higher ? "under" : "over"} the target of ${fmt(target)}.` });
    } else {
      out.push({ tone: "good", text: `Latest reading ${fmt(s.latest.value)} meets the target of ${fmt(target)}.` });
    }
    if (s.streak && s.streak.status !== "none" && s.streak.length >= 3) {
      out.push(s.streak.status === "fail"
        ? { tone: "bad", text: `${s.streak.length} readings in a row have missed the target. This is a pattern, not a one-off day.` }
        : { tone: "good", text: `${s.streak.length} readings in a row have met the target.` });
    }
    if (s.passPct !== null && s.n >= 5) {
      out.push({ tone: s.passPct >= 80 ? "good" : s.passPct >= 50 ? "warn" : "bad", text: `Met the target on ${s.passDays} of ${s.passDays + s.failDays} days (${s.passPct}%).` });
    }
  } else {
    out.push({ tone: "info", text: "No target is set for this metric, so days cannot be marked as passing or failing. Set one in KPI Studio to unlock the status views." });
  }
  if (s.last7Avg !== null && s.prev7Avg !== null && s.prev7Avg !== 0) {
    const d = s.last7Avg - s.prev7Avg;
    if (Math.abs(d) / Math.abs(s.prev7Avg) >= 0.03) {
      const good = higher ? d > 0 : d < 0;
      out.push({ tone: good ? "good" : "warn", text: `The last 7 readings average ${fmt(s.last7Avg)}, ${d > 0 ? "up" : "down"} ${gapFmt(Math.abs(d))} from the 7 before.` });
    }
  }
  const ranked = s.weekdays.filter((w) => w.n >= 2 && w.avg !== null);
  if (ranked.length >= 4) {
    const w = ranked.reduce((a, b) => (better(a.avg as number, b.avg as number, direction) ? b : a));
    const bestW = ranked.reduce((a, b) => (better(a.avg as number, b.avg as number, direction) ? a : b));
    if (w.weekday !== bestW.weekday) out.push({ tone: "info", text: `${w.label} is the weakest weekday (avg ${fmt(w.avg as number)}); ${bestW.label} is the strongest (avg ${fmt(bestW.avg as number)}).` });
  }
  if (s.stdDev !== null && s.mean !== null && s.mean !== 0 && s.stdDev / Math.abs(s.mean) > 0.25) {
    out.push({ tone: "warn", text: "Day-to-day swings are large relative to the average, so a single day is a poor guide to how this is really performing." });
  }
  if (s.n < 5) out.push({ tone: "info", text: `Only ${s.n} reading${s.n === 1 ? "" : "s"} so far, so trend and weekday patterns are not reliable yet.` });
  return out;
}
