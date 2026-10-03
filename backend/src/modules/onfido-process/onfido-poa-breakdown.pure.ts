/**
 * Pure helpers for the POA Internal / External breakdown tables (TL / AM / AON / Client /
 * Document wise). No DB access — unit-testable.
 */

export interface PoaBreakdownOut {
  label: string;
  taskCount: number;
  avgAht: number | null;
  errorRate: number | null;
}

const AON_BUCKETS: { match: RegExp; label: string }[] = [
  { match: /^0\s*(-|to)\s*30$/, label: "0 to 30" },
  { match: /^31\s*(-|to)\s*60$/, label: "31 to 60" },
  { match: /^61\s*(-|to)\s*90$/, label: "61 to 90" },
  { match: /^(above\s*(than|then)?\s*90|90\s*\+|>\s*90)$/, label: "Above 90" },
];

const UNASSIGNED = "(unassigned)";

/** Normalises the several spellings of an AON bucket; unknown labels are kept as-is, blanks become (unassigned). */
export function normaliseAon(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return UNASSIGNED;
  const key = trimmed.toLowerCase().replace(/\s+/g, " ");
  return AON_BUCKETS.find((b) => b.match.test(key))?.label ?? trimmed;
}

export function aonSortIndex(label: string): number {
  const i = AON_BUCKETS.findIndex((b) => b.label === label);
  return i === -1 ? AON_BUCKETS.length : i;
}

export interface VolumeRow {
  label: string;
  n: number;
  aht: number | null;
}
export interface QualityRow {
  label: string;
  errors: number;
  noErrors: number;
}

const rate1 = (err: number, tot: number): number | null =>
  tot > 0 ? Math.round((err / tot) * 1000) / 10 : null;

/**
 * Merge volume rows (POA raw: reports + AHT) with quality rows (POA quality: error / no-error).
 * AHT is volume-weighted across rows that collapse to the same label. A label that only exists in
 * the quality file has no workload and is dropped (same rule as the TL/AM breakdown).
 */
export function mergePoaInternalBreakdown(
  volume: VolumeRow[],
  quality: QualityRow[],
  limit = 50,
): PoaBreakdownOut[] {
  const m = new Map<string, { n: number; ahtSum: number; ahtN: number; err: number; denom: number }>();
  const get = (l: string) => {
    let e = m.get(l);
    if (!e) {
      e = { n: 0, ahtSum: 0, ahtN: 0, err: 0, denom: 0 };
      m.set(l, e);
    }
    return e;
  };
  for (const v of volume) {
    const e = get(v.label);
    e.n += v.n;
    if (v.aht !== null) {
      e.ahtSum += v.aht * v.n;
      e.ahtN += v.n;
    }
  }
  for (const q of quality) {
    const e = get(q.label);
    e.err += q.errors;
    e.denom += q.errors + q.noErrors;
  }
  return [...m.entries()]
    .filter(([, e]) => e.n > 0)
    .map(([label, e]) => ({
      label,
      taskCount: e.n,
      avgAht: e.ahtN > 0 ? Math.round(e.ahtSum / e.ahtN) : null,
      errorRate: rate1(e.err, e.denom),
    }))
    .sort((a, b) => b.taskCount - a.taskCount)
    .slice(0, limit);
}

export interface AnalystAonCount {
  analyst: string;
  aon: string;
  n: number;
}

/** analyst -> most frequent AON label (ties broken alphabetically for determinism). */
export function buildAnalystAonMap(rows: AnalystAonCount[]): Map<string, string> {
  const best = new Map<string, { aon: string; n: number }>();
  for (const r of rows) {
    const key = r.analyst.trim().toLowerCase();
    if (!key) continue;
    const aon = normaliseAon(r.aon);
    const cur = best.get(key);
    if (!cur || r.n > cur.n || (r.n === cur.n && aon < cur.aon)) best.set(key, { aon, n: r.n });
  }
  return new Map([...best.entries()].map(([k, v]) => [k, v.aon]));
}

/** Re-key analyst-level quality rows to AON via the map; unmapped analysts fall to (unassigned). */
export function qualityByAon(
  rows: { analyst: string; errors: number; noErrors: number }[],
  map: Map<string, string>,
): QualityRow[] {
  return rows.map((r) => ({
    label: map.get(r.analyst.trim().toLowerCase()) ?? UNASSIGNED,
    errors: r.errors,
    noErrors: r.noErrors,
  }));
}

/** Collapse volume rows whose raw labels normalise to the same AON bucket (volume-weighted AHT). */
export function normaliseAonVolume(rows: VolumeRow[]): VolumeRow[] {
  return rows.map((r) => ({ ...r, label: normaliseAon(r.label === UNASSIGNED ? "" : r.label) }));
}

/** Order AON rows by bucket order (not volume); other dimensions keep volume order. */
export function sortAonRows(rows: PoaBreakdownOut[]): PoaBreakdownOut[] {
  return [...rows].sort(
    (a, b) => aonSortIndex(a.label) - aonSortIndex(b.label) || b.taskCount - a.taskCount,
  );
}
