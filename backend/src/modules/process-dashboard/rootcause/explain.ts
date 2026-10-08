/** Plain-language explanation of a decomposition. Deterministic templates over structured data; every number printed is a field of the input. */
import type { Decomposition, SegOut } from "./decompose.js";

export interface ExplainMetric { key: string; label: string; unit: string; direction: "higher" | "lower" }
export interface SubDriver { segKey: string; subLabel: string; contribution: number; contributionPct: number | null; shareDeltaPp: number | null }
export interface ExplainInput {
  metric: ExplainMetric; dimension: string; dimensionNoun: string; dec: Decomposition; volumeUnit: string; minVolume: number; baselineLabel: string;
  /** Per primary segment key: its biggest cell in the secondary dimension (e.g. TL_B's LOB Outbound). */
  sub?: Map<string, SubDriver>; subNoun?: string;
}

export const MATERIAL_PCT = 3;
const n1 = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-IN") : String(Math.round(v * 10) / 10));
export function fmtValue(v: number, unit: string): string {
  switch (unit) {
    case "percent": return `${Math.round(v * 10) / 10}%`;
    case "seconds": { const s = Math.round(v); return s >= 600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`; }
    case "hours": return `${Math.round(v * 10) / 10}h`;
    case "currency": return `₹${Math.round(v).toLocaleString("en-IN")}`;
    case "ratio": return String(Math.round(v * 100) / 100);
    default: return n1(v);
  }
}
/** Magnitude of a CHANGE (percentage metrics change in percentage points). */
export function fmtChange(v: number, unit: string): string {
  const m = Math.abs(v);
  switch (unit) {
    case "percent": return `${Math.round(m * 10) / 10} pp`;
    case "seconds": return fmtValue(m, unit);
    default: return fmtValue(m, unit);
  }
}
const signed = (v: number, unit: string) => `${v >= 0 ? "+" : "-"}${fmtChange(v, unit)}`;
const pctTxt = (p: number | null) => (p === null ? "n/a" : `${Math.round(Math.abs(p))}%`);
const pp = (x: number) => `${x >= 0 ? "+" : "-"}${Math.round(Math.abs(x) * 1000) / 10}pp`;

export function explain(i: ExplainInput): string[] {
  const { metric: m, dec, dimensionNoun: noun } = i;
  const t = dec.total, u = m.unit;
  const out: string[] = [];
  if (t.a === null || t.b === null || t.delta === null) {
    out.push(`${m.label} cannot be compared: ${t.a === null ? "the baseline" : "the current"} period has no ${i.volumeUnit || "data"} to compute it from.`);
    return out;
  }
  const word = t.delta > 0 ? "rose" : t.delta < 0 ? "fell" : "did not change";
  const fav = t.delta === 0 ? "" : (m.direction === "higher") === (t.delta > 0) ? " (favourable)" : " (unfavourable)";
  out.push(t.delta === 0
    ? `${m.label} did not change (${fmtValue(t.a, u)} in both periods).`
    : `${m.label} ${word} ${fmtChange(t.delta, u)}${fav}: ${fmtValue(t.a, u)} ${i.baselineLabel} to ${fmtValue(t.b, u)} now${t.deltaPct === null ? "" : ` (${t.deltaPct >= 0 ? "+" : "-"}${Math.round(Math.abs(t.deltaPct) * 10) / 10}%)`}.`);
  if (t.delta === 0) return out;
  const sameSign = (s: SegOut) => Math.sign(s.contribution) === Math.sign(t.delta as number);
  const trusted = dec.segments.filter((s) => !s.lowSample && s.status !== "unattributed" && Math.abs(s.contribution) > 0);
  // Segments below 3% of the change are noise: they are never named as drivers or offsets (they still count in the table and the sum).
  const material = (s: SegOut) => Math.abs(s.contributionPct ?? 0) >= MATERIAL_PCT;
  const drivers = trusted.filter(sameSign).filter(material), offsets = trusted.filter((s) => !sameSign(s)).filter(material);
  const top = drivers[0];
  const name = (s: SegOut) => (s.key === "__other__" ? s.label : s.label);
  if (top) {
    let line = `${pctTxt(top.contributionPct)} of the change comes from ${name(top)} (${signed(top.contribution, u)})`;
    if (dec.kind === "ratio") {
      const bits: string[] = [];
      if (top.a !== null && top.b !== null && top.rateEffect !== null && Math.abs(top.rateEffect) >= 0.05 * Math.abs(top.contribution)) bits.push(`its own ${m.label} moved from ${fmtValue(top.a, u)} to ${fmtValue(top.b, u)} (rate effect ${signed(top.rateEffect, u)})`);
      if (top.shareA !== null && top.shareB !== null && top.mixEffect !== null && Math.abs(top.mixEffect) >= 0.05 * Math.abs(top.contribution)) bits.push(`its share of ${i.volumeUnit} moved from ${Math.round(top.shareA * 1000) / 10}% to ${Math.round(top.shareB * 1000) / 10}% (${pp(top.shareB - top.shareA)}, mix effect ${signed(top.mixEffect, u)})`);
      else if (top.status === "new") bits.push(`it only appears in the current period`);
      if (top.status === "gone") bits.push(`it has no volume in the current period`);
      if (bits.length) line += `: ${bits.join("; ")}`;
    } else {
      line += top.a !== null && top.b !== null ? `: ${fmtValue(top.a, u)} to ${fmtValue(top.b, u)}` : top.status === "new" ? ": new in the current period" : ": no volume in the current period";
    }
    out.push(`${line}.`);
    const sub = i.sub?.get(top.key);
    if (sub && sub.contributionPct !== null && Math.abs(sub.contributionPct) >= MATERIAL_PCT) out.push(`Within ${name(top)}, ${i.subNoun ?? "segment"} ${sub.subLabel} drove ${signed(sub.contribution, u)} (${pctTxt(sub.contributionPct)} of the total change)${sub.shareDeltaPp === null || Math.abs(sub.shareDeltaPp) < 0.5 ? "" : `, where its share of ${i.volumeUnit} moved ${pp(sub.shareDeltaPp / 100)}`}.`);
    if ((top.contributionPct ?? 0) < 25 && drivers.length >= 4) out.push(`The change is spread across many ${noun}s rather than one: the largest explains only ${pctTxt(top.contributionPct)}.`);
  } else out.push(`No single ${noun} explains the change: the movement is spread thinly or sits in low-volume segments.`);
  const more = drivers.slice(1, Math.min(drivers.length, 4));
  if (more.length) out.push(`Next: ${more.map((s) => `${name(s)} (${signed(s.contribution, u)}, ${pctTxt(s.contributionPct)})`).join(", ")}.`);
  if (i.dimension === "agent" && drivers.length > 1) {
    const k = Math.min(4, drivers.length); const share = drivers.slice(0, k).reduce((p, s) => p + (s.contributionPct ?? 0), 0);
    out.push(`${k} agents contributed most (${drivers.slice(0, k).map(name).join(", ")}), together ${pctTxt(share)} of the change.`);
  }
  const off = offsets.slice(0, 3);
  if (off.length) out.push(`Partly offset by ${off.map((s) => `${name(s)} (${signed(s.contribution, u)})`).join(", ")}.`);
  const low = dec.segments.filter((s) => s.lowSample && s.status !== "unattributed");
  if (low.length) {
    const c = low.reduce((p, s) => p + s.contribution, 0);
    const many = low.length > 1;
    out.push(`${low.length} low-volume ${noun}${many ? "s" : ""} (under ${i.minVolume} ${i.volumeUnit}) ${many ? "are" : "is"} not treated as a driver; ${many ? "together they account" : "it accounts"} for ${signed(c, u)} of the change.`);
  }
  const fresh = dec.segments.filter((s) => s.status === "new"), gone = dec.segments.filter((s) => s.status === "gone");
  if (fresh.length) out.push(`${fresh.length} ${noun}${fresh.length > 1 ? "s" : ""} appeared in the current period only (${fresh.slice(0, 3).map((s) => s.label).join(", ")}${fresh.length > 3 ? ", ..." : ""}).`);
  if (gone.length) out.push(`${gone.length} ${noun}${gone.length > 1 ? "s" : ""} from the baseline no longer appear (${gone.slice(0, 3).map((s) => s.label).join(", ")}${gone.length > 3 ? ", ..." : ""}).`);
  if (dec.segments.some((s) => s.status === "unattributed")) out.push("Some time was logged against zero volume in a period; it is shown as an unattributed line.");
  return out;
}
