import { describe, expect, it } from "vitest";
import { decomposeAdditive, decomposeRatio, rollUpTail, type RatioIn } from "../decompose.js";
import { SPECS, ctxOf, denominator, numerator } from "../metricSpec.js";
import { addRow, computeMetrics, emptyAcc, type NormRow } from "../../pd.metrics.js";
import { METRICS } from "../../pd.fields.js";

/** Deterministic PRNG so a failing property case is reproducible. */
const prng = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const randRatio = (r: () => number, n: number, opts: { zeros?: boolean } = {}): RatioIn[] =>
  Array.from({ length: n }, (_, i) => {
    const z = (x: number) => (opts.zeros && r() < 0.25 ? 0 : x);
    const dA = z(Math.round(r() * 500)), dB = z(Math.round(r() * 500));
    const pa = r() < 0.15 ? false : true, pb = r() < 0.15 ? false : true;
    return { key: `s${i}`, label: `S${i}`, dA: pa ? dA : 0, dB: pb ? dB : 0, nA: pa ? Math.round(dA * (50 + r() * 400)) : 0, nB: pb ? Math.round(dB * (50 + r() * 400)) : 0, presentA: pa, presentB: pb };
  });

describe("decomposeRatio: contributions sum exactly to the total change", () => {
  it("randomized property: 400 cases with new / vanished / zero-volume segments", () => {
    const r = prng(42);
    let compared = 0;
    for (let c = 0; c < 400; c++) {
      const segs = randRatio(r, 1 + Math.floor(r() * 12), { zeros: c % 2 === 0 });
      const k = [1, 100, 3600][c % 3];
      const d = decomposeRatio(segs, { scale: k, volumeDiv: 1, minVolume: 30 });
      if (d.total.delta === null) { expect(d.sumCheck.sum).toBeNull(); continue; }
      compared++;
      expect(d.sumCheck.ok, `case ${c} diff ${d.sumCheck.diff}`).toBe(true);
      const sum = d.segments.reduce((p, s) => p + s.contribution, 0);
      expect(Math.abs(sum - d.total.delta)).toBeLessThan(1e-7 * Math.max(1, Math.abs(d.total.delta)));
      // rate + mix == contribution for every segment
      for (const s of d.segments) expect(Math.abs((s.rateEffect ?? 0) + (s.mixEffect ?? 0) - s.contribution)).toBeLessThan(1e-9);
      // percentages add to 100 when the change is non-zero
      if (Math.abs(d.total.delta) > 1e-9) expect(Math.abs(d.segments.reduce((p, s) => p + (s.contributionPct ?? 0), 0) - 100)).toBeLessThan(1e-6);
    }
    expect(compared).toBeGreaterThan(300);
  });
  it("total a/b equal the pooled ratio computed independently", () => {
    const segs: RatioIn[] = [
      { key: "x", label: "X", nA: 6000, dA: 20, nB: 12000, dB: 20, presentA: true, presentB: true },
      { key: "y", label: "Y", nA: 4000, dA: 20, nB: 4000, dB: 20, presentA: true, presentB: true },
    ];
    const d = decomposeRatio(segs, { scale: 1 });
    expect(d.total.a).toBeCloseTo(250, 9); expect(d.total.b).toBeCloseTo(400, 9); expect(d.total.delta).toBeCloseTo(150, 9);
    const x = d.segments.find((s) => s.key === "x")!;
    expect(x.rateEffect).toBeCloseTo(150, 9); expect(x.mixEffect).toBeCloseTo(0, 9); expect(x.contributionPct).toBeCloseTo(100, 9);
    expect(d.segments.find((s) => s.key === "y")!.contribution).toBeCloseTo(0, 9);
  });
  it("pure mix shift (same rates, volume moves to the slower segment) is attributed to mix, not rate", () => {
    const segs: RatioIn[] = [
      { key: "fast", label: "Fast", nA: 200 * 70, dA: 70, nB: 200 * 30, dB: 30, presentA: true, presentB: true },
      { key: "slow", label: "Slow", nA: 400 * 30, dA: 30, nB: 400 * 70, dB: 70, presentA: true, presentB: true },
    ];
    const d = decomposeRatio(segs, { scale: 1 });
    expect(d.total.delta).toBeCloseTo(80, 9);
    for (const s of d.segments) { expect(s.rateEffect).toBeCloseTo(0, 9); }
    expect(d.segments.find((s) => s.key === "slow")!.mixEffect).toBeCloseTo(40, 9);
    expect(d.segments.find((s) => s.key === "fast")!.mixEffect).toBeCloseTo(40, 9);
  });
  it("zero denominator in a period gives null, never 0", () => {
    const d = decomposeRatio([{ key: "a", label: "A", nA: 0, dA: 0, nB: 100, dB: 10, presentA: false, presentB: true }], { scale: 1 });
    expect(d.total.a).toBeNull(); expect(d.total.delta).toBeNull(); expect(d.total.deltaPct).toBeNull();
    expect(d.segments[0].contributionPct).toBeNull();
  });
  it("new and vanished segments are handled and labelled", () => {
    const d = decomposeRatio([
      { key: "old", label: "Old", nA: 300, dA: 10, nB: 0, dB: 0, presentA: true, presentB: false },
      { key: "new", label: "New", nA: 0, dA: 0, nB: 600, dB: 10, presentA: false, presentB: true },
      { key: "stay", label: "Stay", nA: 300, dA: 10, nB: 300, dB: 10, presentA: true, presentB: true },
    ], { scale: 1 });
    expect(d.segments.find((s) => s.key === "old")!.status).toBe("gone"); expect(d.segments.find((s) => s.key === "new")!.status).toBe("new");
    expect(d.segments.find((s) => s.key === "new")!.a).toBeNull();
    expect(d.sumCheck.ok).toBe(true); expect(d.total.delta).toBeCloseTo(15, 9);
  });
  it("flags small-sample segments but still keeps the sum exact", () => {
    const d = decomposeRatio([
      { key: "big", label: "Big", nA: 300 * 500, dA: 500, nB: 310 * 500, dB: 500, presentA: true, presentB: true },
      { key: "tiny", label: "Tiny", nA: 100 * 3, dA: 3, nB: 900 * 4, dB: 4, presentA: true, presentB: true },
    ], { scale: 1, minVolume: 30 });
    expect(d.segments.find((s) => s.key === "tiny")!.lowSample).toBe(true); expect(d.segments.find((s) => s.key === "big")!.lowSample).toBe(false);
    expect(d.sumCheck.ok).toBe(true);
  });
  it("numerator with no denominator becomes an unattributed line and the sum stays exact", () => {
    const d = decomposeRatio([
      { key: "a", label: "A", nA: 1000, dA: 10, nB: 1000, dB: 10, presentA: true, presentB: true },
      { key: "idle", label: "Idle", nA: 0, dA: 0, nB: 500, dB: 0, presentA: true, presentB: true },
    ], { scale: 1 });
    expect(d.segments.some((s) => s.key === "__unattributed__")).toBe(true); expect(d.sumCheck.ok).toBe(true); expect(d.total.delta).toBeCloseTo(50, 9);
  });
});

describe("decomposeAdditive", () => {
  it("property: delta per segment sums exactly to the total delta", () => {
    const r = prng(7);
    for (let c = 0; c < 200; c++) {
      const segs = Array.from({ length: 1 + Math.floor(r() * 10) }, (_, i) => { const pa = r() > 0.2, pb = r() > 0.2; return { key: `s${i}`, label: `S${i}`, vA: pa ? Math.round(r() * 1e4) / 7 : 0, vB: pb ? Math.round(r() * 1e4) / 7 : 0, presentA: pa, presentB: pb }; });
      const d = decomposeAdditive(segs);
      expect(d.sumCheck.ok).toBe(true);
      if (Math.abs(d.total.delta ?? 0) > 1e-9) expect(Math.abs(d.segments.reduce((p, s) => p + (s.contributionPct ?? 0), 0) - 100)).toBeLessThan(1e-6);
    }
  });
  it("total delta 0 gives null percentages; a period with no data gives a null change", () => {
    expect(decomposeAdditive([{ key: "a", label: "A", vA: 5, vB: 5, presentA: true, presentB: true }]).segments[0].contributionPct).toBeNull();
    const d = decomposeAdditive([{ key: "a", label: "A", vA: 0, vB: 5, presentA: false, presentB: true }], { aNull: true });
    expect(d.total.a).toBeNull(); expect(d.total.delta).toBeNull(); expect(d.sumCheck.ok).toBe(true);
  });
});

describe("rollUpTail", () => {
  it("keeps the sum exact and pools the tail into Other", () => {
    const r = prng(3); const segs = randRatio(r, 30); const d = decomposeRatio(segs, { scale: 100 });
    const parts = new Map(segs.map((s) => [s.key, s]));
    const t = rollUpTail(d, 5, { scale: 100, parts });
    expect(t.segments).toHaveLength(6); expect(t.segments[5].key).toBe("__other__");
    if (d.total.delta !== null) expect(t.sumCheck.ok).toBe(true);
  });
});

describe("metric specs mirror computeMetrics", () => {
  const R = (date: string, agent: string, o: Partial<NormRow> = {}): NormRow => ({ date, agent_code: agent, agent_name: null, tl_name: null, lob: null, hour: null, calls: 120, login_sec: 28000,
    talk_sec: 30000, wait_sec: 9000, dispo_sec: 5000, break_sec: 1000, connected: 80, ptp: 20, sales_count: 12, amount: 50000, handled: 110, offered: 130, abandoned: 10, ...o });
  it("every spec value equals the tile value (within the tile rounding)", () => {
    const acc = emptyAcc(); for (let i = 0; i < 9; i++) addRow(acc, R("2026-09-01", `A${i}`, { calls: 100 + i * 7, talk_sec: 20000 + i * 911 }));
    acc.qa = { n: 4, sum: 340, fatal: 0 };
    const m = computeMetrics(acc); const ctx = ctxOf(acc);
    for (const def of METRICS) {
      const spec = SPECS[def.key]; expect(spec, def.key).toBeDefined();
      const n = numerator(spec, acc, true); const d = spec.kind === "ratio" ? denominator(spec, acc, ctx, true) : 1;
      const v = spec.kind === "ratio" ? (spec.scale * (n as number)) / (d as number) : (n as number) * spec.scale;
      expect(Math.abs(v - (m[def.key] as number)), def.key).toBeLessThan(0.051 + Math.abs(v) * 1e-4);
    }
  });
  it("conversion falls back to calls when connected is not mapped", () => {
    const acc = emptyAcc(); addRow(acc, R("2026-09-01", "A", { connected: null }));
    expect(denominator(SPECS.conversion, acc, ctxOf(acc), true)).toBe(120);
  });
});
