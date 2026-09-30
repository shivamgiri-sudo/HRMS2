/** How each dashboard metric is built from accumulator sums, so it can be decomposed. Mirrors computeMetrics in ../pd.metrics.ts (tested for equality). */
import type { Acc, NumKey } from "../pd.metrics.js";

export interface SpecCtx { useConnected: boolean }
export interface MetricSpec {
  kind: "additive" | "ratio";
  /** Fields summed into the numerator (additive: the value itself). Denominator: fields, or "conv" (connected else calls), or "qa". */
  num: NumKey[] | "qa";
  den?: NumKey[] | "conv" | "qa";
  /** KPI = scale * N / D (ratio) or scale * N (additive). */
  scale: number;
  /** What the denominator counts, how to display it, and the smallest denominator a segment needs before its rate is trusted. */
  volumeUnit: string; volumeDiv: number; minVolume: number;
}

const ratio = (num: NumKey[], den: NumKey[] | "conv", scale: number, volumeUnit: string, volumeDiv: number, minVolume: number): MetricSpec => ({ kind: "ratio", num, den, scale, volumeUnit, volumeDiv, minVolume });
const add = (k: NumKey, scale = 1): MetricSpec => ({ kind: "additive", num: [k], scale, volumeUnit: "", volumeDiv: 1, minVolume: 0 });

export const MIN_VOLUME_COUNT = 30, MIN_VOLUME_HOURS = 4, MIN_VOLUME_AUDITS = 5;

export const SPECS: Record<string, MetricSpec> = {
  calls: add("calls"), handled: add("handled"), offered: add("offered"), abandoned: add("abandoned"), connected: add("connected"), ptp: add("ptp"),
  sales_count: add("sales_count"), amount: add("amount"), login_hours: add("login_sec", 1 / 3600),
  utilization: ratio(["talk_sec", "wait_sec", "dispo_sec"], ["login_sec"], 100, "login hours", 3600, MIN_VOLUME_HOURS),
  occupancy: ratio(["talk_sec", "dispo_sec"], ["talk_sec", "wait_sec", "dispo_sec"], 100, "busy hours", 3600, MIN_VOLUME_HOURS),
  aht: ratio(["talk_sec", "dispo_sec"], ["calls"], 1, "calls", 1, MIN_VOLUME_COUNT),
  calls_per_login_hr: ratio(["calls"], ["login_sec"], 3600, "login hours", 3600, MIN_VOLUME_HOURS),
  connect_rate: ratio(["connected"], ["calls"], 100, "calls", 1, MIN_VOLUME_COUNT),
  conversion: ratio(["sales_count"], "conv", 100, "connected calls", 1, MIN_VOLUME_COUNT),
  ptp_rate: ratio(["ptp"], ["connected"], 100, "connected calls", 1, MIN_VOLUME_COUNT),
  answer_rate: ratio(["handled"], ["offered"], 100, "offered calls", 1, MIN_VOLUME_COUNT),
  abandon_rate: ratio(["abandoned"], ["offered"], 100, "offered calls", 1, MIN_VOLUME_COUNT),
  qa_score: { kind: "ratio", num: "qa", den: "qa", scale: 1, volumeUnit: "audits", volumeDiv: 1, minVolume: MIN_VOLUME_AUDITS },
};

export const ctxOf = (total: Acc): SpecCtx => ({ useConnected: total.sum.connected !== null });
const denFields = (spec: MetricSpec, ctx: SpecCtx): NumKey[] | "qa" => (spec.den === "conv" ? [ctx.useConnected ? "connected" : "calls"] : (spec.den as NumKey[] | "qa"));

/** Strict: null unless EVERY field has data (same rule as computeMetrics). Used for the period totals. */
function sumFields(acc: Acc, fields: NumKey[], strict: boolean): number | null {
  let t = 0;
  for (const f of fields) { const v = acc.sum[f]; if (v === null) { if (strict) return null; continue; } t += v; }
  return t;
}
export function numerator(spec: MetricSpec, acc: Acc, strict: boolean): number | null {
  return spec.num === "qa" ? (acc.qa.n > 0 ? acc.qa.sum : null) : sumFields(acc, spec.num, strict);
}
export function denominator(spec: MetricSpec, acc: Acc, ctx: SpecCtx, strict: boolean): number | null {
  const f = denFields(spec, ctx);
  return f === "qa" ? (acc.qa.n > 0 ? acc.qa.n : null) : sumFields(acc, f, strict);
}
