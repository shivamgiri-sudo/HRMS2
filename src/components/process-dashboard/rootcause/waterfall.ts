import type { WhySegment } from "./types";

export interface WfBar { key: string; name: string; lo: number; hi: number; value: number; kind: "delta" | "total"; good: boolean | null }

/** Waterfall of CONTRIBUTIONS: starts at 0, each bar floats from the running sum, and the last bar is the total change (== the running sum). The tail beyond maxBars is pooled into Other. */
export function buildWaterfall(segments: WhySegment[], direction: "higher" | "lower", maxBars = 8): WfBar[] {
  const real = segments.filter((s) => s.key !== "__other__");
  const existingOther = segments.find((s) => s.key === "__other__");
  const head = real.slice(0, maxBars), tail = real.slice(maxBars);
  const items: Array<{ key: string; name: string; value: number }> = head.map((s) => ({ key: s.key, name: s.label, value: s.contribution }));
  const otherCount = existingOther ? parseInt(/\((\d+)/.exec(existingOther.label)?.[1] ?? "0", 10) : 0;
  const more = tail.length + otherCount;
  if (more > 0) items.push({ key: "__other__", name: `Other (${more} more)`, value: tail.reduce((p, s) => p + s.contribution, 0) + (existingOther?.contribution ?? 0) });
  const good = (v: number) => (v === 0 ? null : (v > 0) === (direction === "higher"));
  let run = 0;
  const bars: WfBar[] = items.map((it) => { const lo = Math.min(run, run + it.value), hi = Math.max(run, run + it.value); run += it.value; return { key: it.key, name: it.name, lo, hi, value: it.value, kind: "delta", good: good(it.value) }; });
  bars.push({ key: "__total__", name: "Total change", lo: Math.min(0, run), hi: Math.max(0, run), value: run, kind: "total", good: good(run) });
  return bars;
}
