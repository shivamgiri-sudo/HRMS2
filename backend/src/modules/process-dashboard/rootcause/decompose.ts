/**
 * Root-cause decomposition (pure, no I/O). Explains HOW a KPI moved between a baseline period (A) and a current period (B) by splitting the
 * total change across segments (TL, LOB, agent, hour, ...). Contributions always sum EXACTLY to the total change (up to float noise).
 *
 * Additive KPI (calls, sales, amount, ...):  total = sum of segment values, so contribution_i = B_i - A_i.
 *
 * Ratio KPI  R = k * N / D  (AHT = talk+dispo over calls, utilization = busy over login, conversion = sales over connected, ...):
 *   R = k * SUM_i w_i * r_i   with volume share w_i = D_i / D and segment rate r_i = N_i / D_i.
 *   Identity (exact, per segment):  w_B r_B - w_A r_A = (w_B - w_A) * (r_A + r_B)/2  +  (w_A + w_B)/2 * (r_B - r_A)
 *   mix effect_i  = k * (w_B - w_A) * ((r_A + r_B)/2 - c)        -- the segment's volume share moved; only matters when its rate differs from
 *                                                                   the overall mid rate c (subtracting c is free because SUM(w_B - w_A) = 0)
 *   rate effect_i = k * (w_A + w_B)/2 * (r_B - r_A)               -- the segment's own rate moved, weighted by its average share
 *   contribution_i = mix_i + rate_i, and SUM contribution_i = R_B - R_A exactly (Kitagawa / two-factor midpoint decomposition).
 * A segment present in only one period has no rate in the other; its missing rate is set to the present one, so its whole effect is mix.
 * A segment with numerator but no denominator in a period (AHT talk time with zero calls) cannot have a rate; its numerator is reported as a
 * separate "unattributed" pseudo-segment so the sum stays exact. Zero total denominator in either period => the change is null (never 0).
 */

export interface AdditiveIn { key: string; label: string; vA: number; vB: number; presentA: boolean; presentB: boolean }
export interface RatioIn { key: string; label: string; nA: number; dA: number; nB: number; dB: number; presentA: boolean; presentB: boolean }
export type SegStatus = "both" | "new" | "gone" | "unattributed";

export interface SegOut {
  key: string; label: string; status: SegStatus;
  /** The segment's own KPI value in the baseline (a) and current (b) period; null when it has no data / denominator there. */
  a: number | null; b: number | null;
  /** The segment's own change b - a (null when either side is missing). */
  delta: number | null;
  /** Signed share of the TOTAL change this segment explains, in KPI units (= rateEffect + mixEffect for ratios, = b - a for additive). */
  contribution: number;
  contributionPct: number | null;
  rateEffect: number | null; mixEffect: number | null;
  /** Volume (the ratio's denominator, or the additive value) in each period, in `volumeDiv` units, and each period's share of the total volume. */
  volumeA: number; volumeB: number; shareA: number | null; shareB: number | null;
  lowSample: boolean;
}
export interface Total { a: number | null; b: number | null; delta: number | null; deltaPct: number | null }
export interface SumCheck { sum: number | null; expected: number | null; diff: number | null; ok: boolean }
export interface Decomposition { kind: "additive" | "ratio"; total: Total; segments: SegOut[]; sumCheck: SumCheck }

const pct = (x: number, total: number | null): number | null => (total === null || total === 0 ? null : (x / total) * 100);
const deltaPct = (a: number | null, b: number | null): number | null => (a === null || b === null || a === 0 ? null : ((b - a) / Math.abs(a)) * 100);
export const SUM_TOLERANCE = 1e-9;
export function checkSum(contribs: number[], expected: number | null, magnitude: number): SumCheck {
  if (expected === null) return { sum: null, expected: null, diff: null, ok: true };
  const sum = contribs.reduce((p, c) => p + c, 0);
  const diff = sum - expected;
  return { sum, expected, diff, ok: Math.abs(diff) <= SUM_TOLERANCE * Math.max(1, Math.abs(magnitude), Math.abs(expected)) };
}
const byImpact = (x: SegOut, y: SegOut) => Math.abs(y.contribution) - Math.abs(x.contribution) || x.key.localeCompare(y.key);
const statusOf = (pa: boolean, pb: boolean): SegStatus => (pa && pb ? "both" : pb ? "new" : "gone");

export function decomposeAdditive(segs: AdditiveIn[], opts: { aNull?: boolean; bNull?: boolean } = {}): Decomposition {
  const A = segs.reduce((p, s) => p + s.vA, 0), B = segs.reduce((p, s) => p + s.vB, 0);
  const a = opts.aNull ? null : A, b = opts.bNull ? null : B;
  const total: Total = { a, b, delta: a !== null && b !== null ? b - a : null, deltaPct: deltaPct(a, b) };
  const out = segs.filter((s) => s.presentA || s.presentB).map((s): SegOut => {
    const d = s.vB - s.vA; const c = total.delta === null ? 0 : d;
    return {
      key: s.key, label: s.label, status: statusOf(s.presentA, s.presentB),
      a: s.presentA && !opts.aNull ? s.vA : null, b: s.presentB && !opts.bNull ? s.vB : null, delta: s.presentA && s.presentB && total.delta !== null ? d : null,
      contribution: c, contributionPct: pct(c, total.delta), rateEffect: null, mixEffect: null,
      volumeA: s.vA, volumeB: s.vB, shareA: A === 0 ? null : s.vA / A, shareB: B === 0 ? null : s.vB / B, lowSample: false,
    };
  }).sort(byImpact);
  return { kind: "additive", total, segments: out, sumCheck: checkSum(out.map((s) => s.contribution), total.delta, Math.max(Math.abs(A), Math.abs(B))) };
}

/** `scale` is the ratio's multiplier k (100 for percentages); `minVolume` is in the same units as volumeA/B (denominator / volumeDiv). */
export function decomposeRatio(segs: RatioIn[], opts: { scale: number; volumeDiv?: number; minVolume?: number }): Decomposition {
  const k = opts.scale, vd = opts.volumeDiv ?? 1, minVol = opts.minVolume ?? 0;
  const DA = segs.reduce((p, s) => p + s.dA, 0), DB = segs.reduce((p, s) => p + s.dB, 0);
  const NA = segs.reduce((p, s) => p + s.nA, 0), NB = segs.reduce((p, s) => p + s.nB, 0);
  const RA = DA > 0 ? (k * NA) / DA : null, RB = DB > 0 ? (k * NB) / DB : null;
  const total: Total = { a: RA, b: RB, delta: RA !== null && RB !== null ? RB - RA : null, deltaPct: deltaPct(RA, RB) };
  const rate = (n: number, d: number): number | null => (d > 0 ? (k * n) / d : null);
  const lowOf = (dA: number, dB: number) => Math.max(dA, dB) / vd < minVol;
  const base = (s: RatioIn) => ({
    key: s.key, label: s.label, a: rate(s.nA, s.dA), b: rate(s.nB, s.dB), volumeA: s.dA / vd, volumeB: s.dB / vd,
    shareA: DA > 0 ? s.dA / DA : null, shareB: DB > 0 ? s.dB / DB : null, lowSample: lowOf(s.dA, s.dB),
  });
  const live = segs.filter((s) => s.presentA || s.presentB);
  if (total.delta === null) {
    // One period has no denominator at all: nothing to attribute. Report each segment's own values, never a fake 0.
    const out = live.map((s): SegOut => { const b = base(s); return { ...b, status: statusOf(s.presentA, s.presentB), delta: b.a !== null && b.b !== null ? b.b - b.a : null, contribution: 0, contributionPct: null, rateEffect: null, mixEffect: null }; }).sort(byImpact);
    return { kind: "ratio", total, segments: out, sumCheck: { sum: null, expected: null, diff: null, ok: true } };
  }
  // Numerators of segments with no denominator in a period cannot carry a rate: pooled into one unattributed term.
  let orphA = 0, orphB = 0;
  const cells = live.map((s) => {
    const wA = s.dA > 0 ? s.dA / DA : 0, wB = s.dB > 0 ? s.dB / DB : 0;
    let rA = s.dA > 0 ? s.nA / s.dA : null, rB = s.dB > 0 ? s.nB / s.dB : null;
    if (s.dA <= 0) orphA += s.nA;
    if (s.dB <= 0) orphB += s.nB;
    if (rA === null) rA = rB; if (rB === null) rB = rA;
    return { s, wA, wB, rA, rB };
  });
  let validA = 0, validB = 0;
  for (const c of cells) { validA += c.wA * (c.rA ?? 0) * (c.s.dA > 0 ? 1 : 0); validB += c.wB * (c.rB ?? 0) * (c.s.dB > 0 ? 1 : 0); }
  const c0 = (validA + validB) / 2; // overall mid rate in raw (un-scaled) units
  const out: SegOut[] = cells.map(({ s, wA, wB, rA, rB }) => {
    const b = base(s);
    const rateEffect = rA === null || rB === null ? 0 : k * ((wA + wB) / 2) * (rB - rA);
    const mixEffect = rA === null || rB === null ? 0 : k * (wB - wA) * ((rA + rB) / 2 - c0);
    const contribution = rateEffect + mixEffect;
    return { ...b, status: statusOf(s.presentA, s.presentB), delta: b.a !== null && b.b !== null ? b.b - b.a : null, contribution, contributionPct: pct(contribution, total.delta), rateEffect, mixEffect };
  });
  if (orphA !== 0 || orphB !== 0) {
    const u = k * ((DB > 0 ? orphB / DB : 0) - (DA > 0 ? orphA / DA : 0));
    out.push({ key: "__unattributed__", label: "Unattributed (time without volume)", status: "unattributed", a: null, b: null, delta: null, contribution: u, contributionPct: pct(u, total.delta),
      rateEffect: u, mixEffect: 0, volumeA: 0, volumeB: 0, shareA: null, shareB: null, lowSample: false });
  }
  out.sort(byImpact);
  return { kind: "ratio", total, segments: out, sumCheck: checkSum(out.map((s) => s.contribution), total.delta, Math.max(Math.abs(RA ?? 0), Math.abs(RB ?? 0))) };
}

/** Rolls the tail of a ranked segment list into one "Other" row so the payload is bounded; the sums are preserved exactly. */
export function rollUpTail(d: Decomposition, keep: number, ratio?: { scale: number; parts: Map<string, RatioIn> }): Decomposition {
  if (d.segments.length <= keep) return d;
  const head = d.segments.slice(0, keep), tail = d.segments.slice(keep);
  const sum = (f: (s: SegOut) => number | null) => tail.reduce((p, s) => p + (f(s) ?? 0), 0);
  const contribution = sum((s) => s.contribution);
  let a: number | null = null, b: number | null = null;
  if (d.kind === "additive") { a = sum((s) => s.a); b = sum((s) => s.b); }
  else if (ratio) {
    let nA = 0, dA = 0, nB = 0, dB = 0;
    for (const s of tail) { const p = ratio.parts.get(s.key); if (p) { nA += p.nA; dA += p.dA; nB += p.nB; dB += p.dB; } }
    a = dA > 0 ? (ratio.scale * nA) / dA : null; b = dB > 0 ? (ratio.scale * nB) / dB : null;
  }
  const other: SegOut = {
    key: "__other__", label: `Other (${tail.length} more)`, status: "both", a, b, delta: a !== null && b !== null ? b - a : null, contribution, contributionPct: pct(contribution, d.total.delta),
    rateEffect: d.kind === "ratio" ? sum((s) => s.rateEffect) : null, mixEffect: d.kind === "ratio" ? sum((s) => s.mixEffect) : null,
    volumeA: sum((s) => s.volumeA), volumeB: sum((s) => s.volumeB), shareA: sum((s) => s.shareA), shareB: sum((s) => s.shareB), lowSample: false,
  };
  const segments = [...head, other];
  return { ...d, segments, sumCheck: checkSum(segments.map((s) => s.contribution), d.total.delta, Math.max(Math.abs(d.total.a ?? 0), Math.abs(d.total.b ?? 0))) };
}
