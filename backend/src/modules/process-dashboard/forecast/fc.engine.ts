/**
 * Process Dashboard forecast -- month-end projection + target pacing (pure: no DB, no clock, deterministic).
 *
 * ADDITIVE KPIs (calls, sales, amount, ptp ...: a month total is the sum of daily values)
 *   mtd        = sum of COMPLETE working days of the month up to the cutoff. Today's partial day is EXCLUDED from mtd and from the
 *                history (it is reported separately as `partial`); it is never scaled, because the source has no intraday coverage curve.
 *   expected_d = mean of the last <= 8 same-weekday WORKED days in the 8 week lookback (weekday seasonality). A weekday with < 2
 *                observations falls back to the pooled mean of all worked days (method "pooled-run-rate").
 *   projected  = mtd + sum(expected_d over the remaining working days, today included). If today already has partial data above
 *                its expectation, the partial value is used for today (the day cannot finish below what it already has).
 *   band       = 80% interval (p10..p90) of a seeded bootstrap: residuals (value - same-weekday mean, corrected by sqrt(n/(n-1)))
 *                of the lookback days are resampled with replacement for each remaining day, clamped at 0, summed, and added to
 *                mtd + expectation. Zero variance collapses the band to the point estimate. Day-to-day independence is assumed.
 *   required   = (target - mtd) / remaining working days (0 when mtd already meets the target).
 *
 * RATE KPIs (utilization, AHT, QA, conversion ... : a ratio, not summable)
 *   Daily values of the last <= 14 worked days are fitted with a straight line (OLS, only when >= 10 points, else a flat mean) and
 *   extrapolated over the remaining days, each forecast clamped to the min..max seen in that window (and to [0,100] for percentages).
 *   projected  = (mtdValue * elapsedDays + sum(forecast)) / (elapsedDays + remainingDays)  -- every working day weighs the same (an
 *                approximation: true ratio-of-sums weights days by their denominators, which are not available per KPI here).
 *   band       = same bootstrap, over the OLS residuals, of the mean of the remaining days.
 *   required   = (target * totalDays - mtdValue * elapsedDays) / remaining days: the average the rest of the month must average
 *                (0 when already secured for a higher-is-better KPI; null when unreachable for a lower-is-better one).
 *
 * STATUS (target always comes from KPI config; never invented -- no target => "no_target", projection still shown)
 *   higher-is-better:  projected >= target -> on_track; else band.high >= target (additive) / required <= the best-decile day (rate) -> at_risk; else off_track.
 *   lower-is-better:   mirrored.  Month over (no remaining days): compares the final value only (on_track | off_track).
 *   Zero / insufficient history, or no usable value -> "nodata": projected and band are null, never a guess.
 */
import { addDaysIso, weekdayOf, type Calendar } from "./fc.calendar.js";

export const BAND_LEVEL = 0.8;
export const BOOTSTRAP_RUNS = 400;
export const MIN_HISTORY_DAYS = 7;       // worked days with a value needed before any projection is shown
export const MIN_WEEKDAY_OBS = 2;
export const MAX_WEEKDAY_OBS = 8;
export const RATE_WINDOW = 14;
export const RATE_TREND_MIN = 10;

export type KpiKind = "additive" | "rate";
export type ForecastStatus = "on_track" | "at_risk" | "off_track" | "nodata" | "no_target";
export interface KpiSpec { key: string; label: string; unit: string; direction: "higher" | "lower"; kind: KpiKind; target: number | null }
export interface DailyPoint { date: string; value: number | null }
export interface PathPoint { date: string; actual: number | null; projected: number | null; low: number | null; high: number | null }

export interface ForecastInput {
  month: string; monthFirst: string; monthLast: string;
  /** Last complete day; days after it (up to monthLast) are forecast. */
  cutoff: string;
  calendar: Calendar;
  spec: KpiSpec;
  /** Values of WORKED days (those with source rows) from the lookback window, ascending. null = worked but the KPI is undefined that day. */
  daily: DailyPoint[];
  /** Rate KPIs: the true month-to-date value (ratio of sums) over complete days. */
  mtdValue?: number | null;
  /** Today's incomplete day, reported but never used as history. */
  partial?: { date: string; value: number | null } | null;
  withPath?: boolean;
  seed?: number;
}
export interface ForecastKpi {
  key: string; label: string; unit: string; direction: "higher" | "lower"; kind: KpiKind;
  mtd: number | null; projected: number | null; band: { low: number; high: number; level: number } | null;
  target: number | null; pacingPct: number | null; status: ForecastStatus; requiredDailyRate: number | null;
  daysElapsed: number; daysRemaining: number; method: string; reason?: string;
  expectedDaily: number | null; partial: { date: string; value: number | null } | null;
  pathKind?: "cumulative" | "daily"; path?: PathPoint[];
}

/* ---------- small numeric helpers ---------- */
const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p; const lo = Math.floor(i); const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
const rnd = (n: number, dp = 2): number => Math.round(n * 10 ** dp) / 10 ** dp;
export function hashSeed(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** OLS fit y = a + b*x over x = 0..n-1; returns null when n < 2. */
export function linearFit(y: number[]): { a: number; b: number } | null {
  const n = y.length; if (n < 2) return null;
  const mx = (n - 1) / 2; const my = mean(y);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (i - mx) * (y[i] - my); sxx += (i - mx) ** 2; }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b };
}

const shell = (inp: ForecastInput, extra: Partial<ForecastKpi>): ForecastKpi => {
  const s = inp.spec;
  return { key: s.key, label: s.label, unit: s.unit, direction: s.direction, kind: s.kind, mtd: null, projected: null, band: null, target: s.target, pacingPct: null,
    status: "nodata", requiredDailyRate: null, daysElapsed: 0, daysRemaining: 0, method: "none", expectedDaily: null, partial: inp.partial ?? null, ...extra };
};

/** Days of the month: elapsed (worked, <= cutoff) and remaining (working per calendar, > cutoff). */
export function monthDays(inp: Pick<ForecastInput, "monthFirst" | "monthLast" | "cutoff" | "calendar">): { elapsed: string[]; remaining: string[] } {
  const cal = inp.calendar;
  const elapsedEnd = inp.cutoff < inp.monthLast ? inp.cutoff : inp.monthLast;
  const elapsed = elapsedEnd >= inp.monthFirst ? cal.workingDaysBetween(inp.monthFirst, elapsedEnd) : [];
  const from = addDaysIso(elapsedEnd < inp.monthFirst ? addDaysIso(inp.monthFirst, -1) : elapsedEnd, 1);
  const remaining = from <= inp.monthLast ? cal.workingDaysBetween(from, inp.monthLast) : [];
  return { elapsed, remaining };
}

function statusFor(spec: KpiSpec, projected: number, band: { low: number; high: number } | null, required: number | null, remaining: number, mtd: number | null, bestDay: number | null): ForecastStatus {
  const t = spec.target;
  if (t === null || !Number.isFinite(t)) return "no_target";
  const hi = spec.direction === "higher";
  const final = remaining === 0 ? (mtd ?? projected) : projected;
  if (hi ? final >= t : final <= t) return "on_track";
  if (remaining === 0) return "off_track";
  if (spec.kind === "additive") { if (band && (hi ? band.high >= t : band.low <= t)) return "at_risk"; return "off_track"; }
  if (required !== null && bestDay !== null && (hi ? required <= bestDay : required >= bestDay)) return "at_risk";
  return "off_track";
}
const pacing = (projected: number | null, target: number | null): number | null => (projected === null || target === null || target === 0 ? null : rnd((projected / target) * 100, 1));

export function forecastKpi(inp: ForecastInput): ForecastKpi {
  return inp.spec.kind === "additive" ? forecastAdditive(inp) : forecastRate(inp);
}

function forecastAdditive(inp: ForecastInput): ForecastKpi {
  const { spec, calendar: cal } = inp;
  const { elapsed, remaining } = monthDays(inp);
  const inMonth = inp.daily.filter((d) => d.date >= inp.monthFirst && d.date <= inp.cutoff && d.value !== null);
  const mtd = inMonth.length ? inMonth.reduce((a, d) => a + (d.value as number), 0) : elapsed.length === 0 ? 0 : null;
  const base = { daysElapsed: elapsed.length, daysRemaining: remaining.length, mtd: mtd === null ? null : rnd(mtd) };
  const required = spec.target !== null && mtd !== null && remaining.length > 0 ? rnd(Math.max(0, (spec.target - mtd) / remaining.length)) : null;

  const hist = inp.daily.filter((d): d is { date: string; value: number } => d.value !== null && d.date <= inp.cutoff && cal.isWorked(d.date));
  const histAll = hist.length;
  const positive = hist.some((d) => d.value !== 0);
  if (remaining.length === 0) {
    // Month over (or nothing left to work): the projection IS the actual.
    if (mtd === null || elapsed.length === 0) return shell(inp, { ...base, reason: "No data for this month", method: "actual" });
    const st = statusFor(spec, mtd, null, null, 0, mtd, null);
    return shell(inp, { ...base, projected: rnd(mtd), band: { low: rnd(mtd), high: rnd(mtd), level: BAND_LEVEL }, pacingPct: pacing(mtd, spec.target), status: st, method: "actual", requiredDailyRate: null });
  }
  if (histAll < MIN_HISTORY_DAYS) return shell(inp, { ...base, requiredDailyRate: required, reason: `Only ${histAll} worked day(s) of history; at least ${MIN_HISTORY_DAYS} are needed`, method: "insufficient-history" });
  if (!positive) return shell(inp, { ...base, requiredDailyRate: required, reason: "History is all zero; nothing to extrapolate", method: "insufficient-history" });

  // Same-weekday observations, most recent first, capped at 8 (the 8 week lookback holds at most 8 of each weekday).
  const obs: Record<number, number[]> = {};
  for (const d of [...hist].reverse()) { const w = weekdayOf(d.date); (obs[w] ??= []); if (obs[w].length < MAX_WEEKDAY_OBS) obs[w].push(d.value); }
  const pooled = mean(hist.map((d) => d.value));
  let usedPooled = false;
  const expect = (date: string): number => {
    const o = obs[weekdayOf(date)];
    if (o && o.length >= MIN_WEEKDAY_OBS) return mean(o);
    usedPooled = true; return pooled;
  };
  // Residual pool: value - its weekday mean (same rule), unbiased by sqrt(n/(n-1)) for that weekday.
  const resid: number[] = [];
  for (const d of hist) {
    const o = obs[weekdayOf(d.date)]; const m = o && o.length >= MIN_WEEKDAY_OBS ? mean(o) : pooled; const n = o && o.length >= MIN_WEEKDAY_OBS ? o.length : hist.length;
    resid.push((d.value - m) * Math.sqrt(n / Math.max(1, n - 1)));
  }
  const exp = remaining.map(expect);
  const partialOk = inp.partial && inp.partial.value !== null && remaining.includes(inp.partial.date);
  if (partialOk) { const i = remaining.indexOf(inp.partial!.date); exp[i] = Math.max(exp[i], inp.partial!.value as number); }
  const expSum = exp.reduce((a, b) => a + b, 0);
  const projected = (mtd ?? 0) + expSum;

  const rand = mulberry32(inp.seed ?? hashSeed(`${spec.key}|${inp.month}|${inp.cutoff}`));
  const runs: number[][] = []; // runs[r][i] = cumulative remaining sum after day i
  for (let r = 0; r < BOOTSTRAP_RUNS; r++) {
    let cum = 0; const row: number[] = [];
    for (let i = 0; i < remaining.length; i++) { cum += Math.max(0, exp[i] + resid[Math.floor(rand() * resid.length)]); row.push(cum); }
    runs.push(row);
  }
  const at = (i: number, p: number) => percentile(runs.map((r) => r[i]).sort((a, b) => a - b), p);
  const lastI = remaining.length - 1;
  const lo = (1 - BAND_LEVEL) / 2;
  const band = { low: rnd(Math.min((mtd ?? 0) + at(lastI, lo), projected)), high: rnd(Math.max((mtd ?? 0) + at(lastI, 1 - lo), projected)), level: BAND_LEVEL };
  const status = statusFor(spec, projected, band, required, remaining.length, mtd, null);
  const out = shell(inp, { ...base, projected: rnd(projected), band, pacingPct: pacing(projected, spec.target), status, requiredDailyRate: required,
    expectedDaily: rnd(expSum / remaining.length), method: usedPooled ? "pooled-run-rate" : "weekday-seasonal-run-rate" });
  if (inp.withPath) {
    const pts: PathPoint[] = []; let cumA = 0;
    const vals = new Map(inMonth.map((d) => [d.date, d.value as number]));
    for (const d of elapsed) { cumA += vals.get(d) ?? 0; pts.push({ date: d, actual: rnd(cumA), projected: null, low: null, high: null }); }
    const m0 = mtd ?? 0; let cumP = 0; const last = pts.length ? pts[pts.length - 1] : null;
    if (last) { last.projected = last.actual; last.low = last.actual; last.high = last.actual; }
    remaining.forEach((d, i) => { cumP += exp[i]; pts.push({ date: d, actual: null, projected: rnd(m0 + cumP), low: rnd(Math.min(m0 + at(i, lo), m0 + cumP)), high: rnd(Math.max(m0 + at(i, 1 - lo), m0 + cumP)) }); });
    out.pathKind = "cumulative"; out.path = pts;
  }
  return out;
}
function forecastRate(inp: ForecastInput): ForecastKpi {
  const { spec, calendar: cal } = inp;
  const { elapsed, remaining } = monthDays(inp);
  const mtdV = inp.mtdValue ?? null;
  const base = { daysElapsed: elapsed.length, daysRemaining: remaining.length, mtd: mtdV === null ? null : rnd(mtdV) };
  const T = elapsed.length + remaining.length;
  const rawReq = spec.target !== null && mtdV !== null && remaining.length > 0 && T > 0 ? (spec.target * T - mtdV * elapsed.length) / remaining.length : null;
  // Already secured (higher is better): 0 needed. Below zero for a lower-is-better KPI means no average can still reach it: no number.
  const required = rawReq === null ? null : rawReq >= 0 ? rnd(rawReq) : spec.direction === "higher" ? 0 : null;
  const hist = inp.daily.filter((d): d is { date: string; value: number } => d.value !== null && d.date <= inp.cutoff && cal.isWorked(d.date));

  if (remaining.length === 0) {
    if (mtdV === null) return shell(inp, { ...base, reason: "No data for this month", method: "actual" });
    return shell(inp, { ...base, projected: rnd(mtdV), band: { low: rnd(mtdV), high: rnd(mtdV), level: BAND_LEVEL }, pacingPct: pacing(mtdV, spec.target), status: statusFor(spec, mtdV, null, null, 0, mtdV, null), method: "actual" });
  }
  if (hist.length < MIN_HISTORY_DAYS) return shell(inp, { ...base, requiredDailyRate: required, reason: `Only ${hist.length} day(s) with a value; at least ${MIN_HISTORY_DAYS} are needed`, method: "insufficient-history" });
  if (mtdV === null && elapsed.length > 0) return shell(inp, { ...base, requiredDailyRate: required, reason: "No month-to-date value", method: "insufficient-history" });

  const win = hist.slice(-RATE_WINDOW).map((d) => d.value);
  const fit = win.length >= RATE_TREND_MIN ? linearFit(win) : null;
  const lo = Math.min(...win); const hi = Math.max(...win);
  const isPct = spec.unit === "percent";
  const ceil = isPct ? Math.min(hi, 100) : hi; const floor = Math.max(lo, 0);
  const clamp = (v: number) => Math.min(ceil, Math.max(floor, v));
  const fitted = (i: number) => (fit ? fit.a + fit.b * i : mean(win));
  const fc = remaining.map((_, k) => clamp(fitted(win.length + k)));
  const resid = win.map((v, i) => { const n = win.length; return (v - fitted(i)) * Math.sqrt(n / Math.max(1, n - (fit ? 2 : 1))); });
  const mtdEff = mtdV ?? 0; const E = elapsed.length;
  const monthEnd = (sum: number) => (mtdEff * E + sum) / T;
  const projected = monthEnd(fc.reduce((a, b) => a + b, 0));

  const rand = mulberry32(inp.seed ?? hashSeed(`${spec.key}|${inp.month}|${inp.cutoff}`));
  const cums: number[][] = [];
  for (let r = 0; r < BOOTSTRAP_RUNS; r++) { let c = 0; const row: number[] = []; for (let i = 0; i < remaining.length; i++) { c += clamp(fc[i] + resid[Math.floor(rand() * resid.length)]); row.push(c); } cums.push(row); }
  const qs = (i: number, p: number) => percentile(cums.map((r) => r[i]).sort((a, b) => a - b), p);
  const q = (1 - BAND_LEVEL) / 2; const last = remaining.length - 1;
  const band = { low: rnd(Math.min(monthEnd(qs(last, q)), projected)), high: rnd(Math.max(monthEnd(qs(last, 1 - q)), projected)), level: BAND_LEVEL };
  // "Best day" the recent history has shown: the top (or bottom) decile of worked days -- a required rate beyond it is off_track, within it at_risk.
  const sortedWin = [...win].sort((a, b) => a - b);
  const bestDay = spec.direction === "higher" ? percentile(sortedWin, 0.9) : percentile(sortedWin, 0.1);
  const status = statusFor(spec, projected, band, required, remaining.length, mtdV, bestDay);
  const out = shell(inp, { ...base, projected: rnd(projected), band, pacingPct: pacing(projected, spec.target), status, requiredDailyRate: required,
    expectedDaily: rnd(mean(fc)), method: fit ? "linear-trend" : "flat-mean" });
  if (inp.withPath) {
    const vals = new Map(hist.map((d) => [d.date, d.value]));
    const pts: PathPoint[] = elapsed.map((d) => ({ date: d, actual: vals.has(d) ? rnd(vals.get(d) as number) : null, projected: null, low: null, high: null }));
    remaining.forEach((d, i) => {
      const res = cums.map((r) => (i === 0 ? r[0] : r[i] - r[i - 1])).sort((a, b) => a - b);
      pts.push({ date: d, actual: null, projected: rnd(fc[i]), low: rnd(Math.min(percentile(res, q), fc[i])), high: rnd(Math.max(percentile(res, 1 - q), fc[i])) });
    });
    out.pathKind = "daily"; out.path = pts;
  }
  return out;
}
