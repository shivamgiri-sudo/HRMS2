/** Root-cause "why did it change" endpoint logic: loads both periods, segments them by a dimension, decomposes, explains. */
import { smallCache } from "../pd.cache.js";
import { METRIC_BY_KEY } from "../pd.fields.js";
import { addQa, addRow, emptyAcc, metricAvailable, totalAcc, type Acc, type NormRow, type QaBucket } from "../pd.metrics.js";
import { PdError } from "../pd.source.js";
import { MAX_RANGE_DAYS, applyFilters, daysBetween, getFreshness, inRange, isIso, loadDataset, previousRange, resolveRange, type Loaded } from "../pd.dataset.js";
import { filtersOf, type RangeQuery } from "../pd.service.js";
import { decomposeAdditive, decomposeRatio, rollUpTail, type Decomposition, type RatioIn, type SegOut } from "./decompose.js";
import { explain, type SubDriver } from "./explain.js";
import { SPECS, ctxOf, denominator, numerator, type MetricSpec, type SpecCtx } from "./metricSpec.js";

export const DIMENSIONS = ["tl", "lob", "agent", "hour"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
const NOUN: Record<Dimension, string> = { tl: "team leader", lob: "LOB", agent: "agent", hour: "hour" };
export const MAX_SEGMENTS = 40;

export interface WhyQuery extends RangeQuery { metric?: unknown; compareFrom?: unknown; compareTo?: unknown; by?: unknown; minVolume?: unknown }

interface Part { label: string; tl: string | null; a?: Acc; b?: Acc }
type Side = "a" | "b";
interface Rows { rows: NormRow[]; qa: QaBucket[] }

const keyFns: Record<Dimension, { key: (r: NormRow) => string; label: (k: string, r: NormRow) => string }> = {
  tl: { key: (r) => r.tl_name ?? "Unassigned", label: (k) => k },
  lob: { key: (r) => r.lob ?? "Unassigned", label: (k) => k },
  agent: { key: (r) => r.agent_code, label: (k, r) => (r.agent_name && !r.agent_name.toUpperCase().includes(k) ? `${r.agent_name} (${k})` : r.agent_name ?? k) },
  hour: { key: (r) => (r.hour === null ? "Unknown" : String(r.hour)), label: (k) => (k === "Unknown" ? "Unknown hour" : `${k.padStart(2, "0")}:00`) },
};
const qaOf = (qa: QaBucket[], rows: NormRow[]): QaBucket[] => { const s = new Set(rows.map((r) => r.agent_code)); return qa.filter((q) => s.has(q.agentCode)); };

/** Segment both periods with the same key function. A QA bucket belongs to its agent's first segment in that period (never double counted). */
function segment(A: Rows, B: Rows, keyOf: (r: NormRow) => string, labelOf: (k: string, r: NormRow) => string, withQa: boolean): Map<string, Part> {
  const m = new Map<string, Part>();
  for (const [side, src] of [["a", A], ["b", B]] as Array<[Side, Rows]>) {
    const agentKey = new Map<string, string>();
    for (const r of src.rows) {
      const k = keyOf(r);
      let p = m.get(k); if (!p) { p = { label: labelOf(k, r), tl: null }; m.set(k, p); }
      const acc = (p[side] ??= emptyAcc()); addRow(acc, r);
      if (r.tl_name) p.tl = r.tl_name;
      if (!agentKey.has(r.agent_code)) agentKey.set(r.agent_code, k);
    }
    if (withQa) for (const q of src.qa) { const k = agentKey.get(q.agentCode); const acc = k === undefined ? undefined : m.get(k)?.[side]; if (acc) addQa(acc, q); }
  }
  return m;
}

function inputsFor(spec: MetricSpec, parts: Map<string, Part>, ctxA: SpecCtx, ctxB: SpecCtx, off: { a: boolean; b: boolean }) {
  const ratios: RatioIn[] = []; const adds: Array<{ key: string; label: string; vA: number; vB: number; presentA: boolean; presentB: boolean }> = [];
  for (const [key, p] of parts) {
    const val = (acc: Acc | undefined, ctx: SpecCtx, dead: boolean) => {
      if (!acc || dead) return { n: 0, d: 0 };
      return { n: numerator(spec, acc, false) ?? 0, d: spec.kind === "ratio" ? denominator(spec, acc, ctx, false) ?? 0 : 0 };
    };
    const A = val(p.a, ctxA, off.a), B = val(p.b, ctxB, off.b);
    if (spec.kind === "additive") adds.push({ key, label: p.label, vA: A.n * spec.scale, vB: B.n * spec.scale, presentA: !!p.a && !off.a, presentB: !!p.b && !off.b });
    else ratios.push({ key, label: p.label, nA: A.n, dA: A.d, nB: B.n, dB: B.d, presentA: !!p.a && !off.a, presentB: !!p.b && !off.b });
  }
  return { ratios, adds };
}

function run(spec: MetricSpec, parts: Map<string, Part>, ctxA: SpecCtx, ctxB: SpecCtx, off: { a: boolean; b: boolean }, minVolume: number) {
  const { ratios, adds } = inputsFor(spec, parts, ctxA, ctxB, off);
  const dec: Decomposition = spec.kind === "additive" ? decomposeAdditive(adds, { aNull: off.a, bNull: off.b })
    : decomposeRatio(ratios, { scale: spec.scale, volumeDiv: spec.volumeDiv, minVolume });
  return { dec, ratios };
}

function parseDates(q: WhyQuery, current: { from: string; to: string }): { from: string; to: string } {
  const has = (v: unknown) => v !== undefined && v !== "";
  if (!has(q.compareFrom) && !has(q.compareTo)) return previousRange(current.from, current.to);
  if (!isIso(q.compareFrom) || !isIso(q.compareTo)) throw new PdError(400, "BAD_DATE", "compareFrom and compareTo must both be YYYY-MM-DD");
  let { compareFrom: from, compareTo: to } = q as { compareFrom: string; compareTo: string };
  if (to < from) [from, to] = [to, from];
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) throw new PdError(400, "RANGE_TOO_LARGE", `Comparison range too large (max ${MAX_RANGE_DAYS} days)`);
  return { from, to };
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function getWhy(l: Loaded, q: WhyQuery) {
  const metricKey = str(q.metric); const def = METRIC_BY_KEY.get(metricKey); const spec = SPECS[metricKey];
  if (!def || !spec) throw new PdError(400, "BAD_METRIC", `Unknown metric "${metricKey.slice(0, 40)}"`);
  if (!metricAvailable(metricKey, l.resolved.mapped)) throw new PdError(409, "METRIC_UNAVAILABLE", `${def.label} is not available for this process`);
  const byRaw = str(q.by).toLowerCase() || "tl"; const by = (byRaw === "campaign" ? "lob" : byRaw) as Dimension;
  if (!DIMENSIONS.includes(by)) throw new PdError(400, "BAD_DIMENSION", "by must be one of tl, lob, agent, hour");
  const mapped = l.resolved.mapped;
  if ((by === "tl" && !mapped.has("tl_name")) || (by === "lob" && !mapped.has("lob")) || (by === "hour" && !mapped.has("hour")))
    throw new PdError(400, "DIMENSION_UNAVAILABLE", `This process has no ${NOUN[by]} column mapped`);
  if (by === "hour" && metricKey === "qa_score") throw new PdError(400, "DIMENSION_UNAVAILABLE", "QA scores are per audit, not per hour");
  const mv = Number(q.minVolume);
  const f = filtersOf(q);
  const fresh = await getFreshness(l);
  const cur = resolveRange(q, fresh); const base = parseDates(q, cur);
  const cacheKey = `${l.cfg.processId}|why|${l.cfg.updatedAt}|${metricKey}|${by}|${cur.from}|${cur.to}|${base.from}|${base.to}|${f.tl ?? ""}|${f.lob ?? ""}|${Number.isFinite(mv) ? mv : ""}`;
  return smallCache.wrap(cacheKey, async () => {
    const lo = base.from < cur.from ? base.from : cur.from; const hi = base.to > cur.to ? base.to : cur.to;
    const ds = await loadDataset(l, lo, hi);
    const slice = (r: { from: string; to: string }): Rows => { const rows = applyFilters(inRange(ds.rows, r.from, r.to), f); return { rows, qa: qaOf(inRange(ds.qa, r.from, r.to), rows) }; };
    const A = slice(base), B = slice(cur);
    const totA = totalAcc(A.rows, A.qa), totB = totalAcc(B.rows, B.qa);
    const ctxA = ctxOf(totA), ctxB = ctxOf(totB);
    // A period whose totals cannot be computed (a required field has no data at all, or no denominator) has no value: null, never 0.
    const dead = (acc: Acc, ctx: SpecCtx) => numerator(spec, acc, true) === null || (spec.kind === "ratio" && denominator(spec, acc, ctx, true) === null);
    const off = { a: dead(totA, ctxA), b: dead(totB, ctxB) };
    const minVolume = Number.isFinite(mv) && mv >= 0 ? Math.min(mv, 1e9) : spec.minVolume;
    const withQa = metricKey === "qa_score";
    const k = keyFns[by];
    const parts = segment(A, B, k.key, k.label, withQa);
    const { dec: full, ratios } = run(spec, parts, ctxA, ctxB, off, minVolume);

    // Secondary cut: which cell of the other dimension (TL -> LOB, LOB -> TL) carries the top driver.
    let sub: Map<string, SubDriver> | undefined; let subNoun: string | undefined;
    const subDim: Dimension | null = by === "tl" && mapped.has("lob") ? "lob" : by === "lob" && mapped.has("tl_name") ? "tl" : null;
    if (subDim) {
      const sk = keyFns[subDim]; subNoun = NOUN[subDim];
      const cells = segment(A, B, (r) => `${k.key(r)}\u0001${sk.key(r)}`, (key, r) => sk.label(key.split("\u0001")[1], r), withQa);
      const cd = run(spec, cells, ctxA, ctxB, off, minVolume).dec;
      sub = new Map();
      for (const c of cd.segments) {
        if (c.lowSample || c.status === "unattributed") continue;
        const pk = c.key.split("\u0001")[0];
        if (!sub.has(pk)) sub.set(pk, { segKey: pk, subLabel: c.label, contribution: c.contribution, contributionPct: c.contributionPct, shareDeltaPp: c.shareA !== null && c.shareB !== null ? (c.shareB - c.shareA) * 100 : null });
      }
    }
    const explanation = explain({ metric: { key: metricKey, label: def.label, unit: def.unit, direction: def.direction }, dimension: by, dimensionNoun: NOUN[by], dec: full,
      volumeUnit: spec.kind === "ratio" ? spec.volumeUnit : def.label.toLowerCase(), minVolume, baselineLabel: "in the baseline period", sub, subNoun });

    const tlOf = new Map([...parts].map(([key, p]) => [key, p.tl]));
    const parted = new Map(ratios.map((r) => [r.key, r]));
    const trimmed = rollUpTail(full, MAX_SEGMENTS, spec.kind === "ratio" ? { scale: spec.scale, parts: parted } : undefined);
    const segments = trimmed.segments.map((s: SegOut) => ({ ...s, ...(by === "agent" ? { tl: tlOf.get(s.key) ?? null } : {}) }));
    const trusted = full.segments.filter((s) => !s.lowSample && s.status !== "unattributed");
    const warnings: string[] = [];
    if (ds.truncated) warnings.push("Source rows exceeded the read limit; figures may be partial. Narrow the date range.");
    return {
      processId: l.cfg.processId, metric: { key: metricKey, label: def.label, unit: def.unit, direction: def.direction, kind: spec.kind },
      dimension: by, periods: { current: cur, baseline: base }, filters: f,
      total: full.total, segments, explanation, sumCheck: trimmed.sumCheck, fullSumCheck: full.sumCheck,
      volumeUnit: spec.kind === "ratio" ? spec.volumeUnit : null, minVolume: spec.kind === "ratio" ? minVolume : null, segmentCount: full.segments.length,
      topDrivers: { increase: trusted.filter((s) => s.contribution > 0).slice(0, 3).map((s) => s.key), decrease: trusted.filter((s) => s.contribution < 0).slice(0, 3).map((s) => s.key) },
      warnings,
    };
  });
}
