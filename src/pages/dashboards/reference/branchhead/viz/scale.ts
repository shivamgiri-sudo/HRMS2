/* Pure helpers shared by every chart primitive. No DOM, no React: unit-tested directly. */

export type Tone = "good" | "warning" | "serious" | "critical" | "neutral";

export interface TableSpec {
  caption: string;
  columns: string[];
  rows: Array<Array<string | number | null>>;
}

export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function clamp(v: number, lo: number, hi: number): number {
  if (!isNum(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

/** Linear map; an equal (degenerate) domain maps everything to the range start instead of NaN. */
function linear(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  if (!isNum(span) || span === 0) return () => r0;
  return (v: number) => (isNum(v) ? r0 + ((v - d0) / span) * (r1 - r0) : r0);
}

/** Smallest "clean" bound >= v from the 1 / 2 / 2.5 / 5 / 10 ladder. Never 0, so it is safe as a divisor. */
function niceMax(v: number): number {
  if (!isNum(v) || v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * mag >= v - 1e-9) return m * mag;
  }
  return 10 * mag;
}

/** part / whole as a percentage; 0 when the whole is zero, negative or missing. */
function pct(part: number, whole: number): number {
  if (!isNum(part) || !isNum(whole) || whole <= 0) return 0;
  return (part / whole) * 100;
}

/** count + 1 evenly spaced ticks from 0 to max. */
function ticks(max: number, count = 2): number[] {
  const n = Math.max(1, Math.round(count));
  return Array.from({ length: n + 1 }, (_, i) => (max * i) / n);
}

function sum(values: number[]): number {
  return values.reduce((s, v) => s + (isNum(v) ? v : 0), 0);
}

export const scale = { linear, niceMax, pct, clamp, ticks, sum };

/** Stage i of n mapped onto the validated 5-step ordinal ramp, spread so neighbours stay >= 1 step apart. */
export function ordinalStep(i: number, n: number): number {
  if (n <= 1) return 1;
  if (n > 5) return Math.min(5, i + 1);
  return Math.round((i * 4) / (n - 1)) + 1;
}

const SERIES_SLOTS = 4;

/** Categorical slot colour (1-4); anything beyond the cap wears the "Other" gray. */
export function seriesColor(i: number): string {
  return i >= 0 && i < SERIES_SLOTS ? `var(--bh-s${i + 1})` : "var(--bh-other)";
}

/** Status colour for a tone; no tone means the plain series-1 blue. */
export function toneColor(tone: Tone | undefined): string {
  return tone ? `var(--bh-${tone})` : "var(--bh-s1)";
}

export const TONE_LABEL: Record<Tone, string> = {
  good: "Good",
  warning: "Warning",
  serious: "Serious",
  critical: "Critical",
  neutral: "Neutral",
};

/** Round to one decimal for geometry output (keeps markup and test numbers stable). */
export function r1(v: number): number {
  return Math.round(v * 10) / 10;
}
