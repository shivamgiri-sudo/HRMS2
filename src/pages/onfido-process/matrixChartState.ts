import type { Matrix, MatrixFormat } from "./onfidoReportShared";

/**
 * Pure logic behind the Overview charts (MatrixLineChart): which series are visible, when point
 * labels help rather than clutter, which chart types make sense for a given matrix, and the
 * change-versus-previous-period figure shown on each small multiple. Kept free of React so it
 * is unit tested directly.
 */

export type MatrixView = "lines" | "bars" | "stacked" | "multiples";

/** Show or hide one series; returns a new set. */
export function toggleSeries(
  hidden: ReadonlySet<string>,
  key: string,
): Set<string> {
  const next = new Set(hidden);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function latestValue(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

/** Hides every series except the N with the highest latest value; a series with no data ranks last. */
export function hiddenForTopN(matrix: Matrix, n: number): Set<string> {
  const ranked = matrix.rows
    .map((r) => ({ label: r.label, latest: latestValue(r.values) }))
    .sort(
      (a, b) =>
        (b.latest ?? Number.NEGATIVE_INFINITY) -
        (a.latest ?? Number.NEGATIVE_INFINITY),
    );
  return new Set(ranked.slice(n).map((r) => r.label));
}

/** Point labels help with up to three lines and turn into a smudge beyond that. */
export function autoShowLabels(visibleSeries: number): boolean {
  return visibleSeries <= 3;
}

const DASHES = ["6 3", "2 3", "8 3 2 3", undefined] as const;

/** First four lines solid; later ones alternate dash patterns so similar colours stay distinguishable. */
export function dashFor(index: number): string | undefined {
  return index < 4 ? undefined : DASHES[(index - 4) % DASHES.length];
}

/** Taller chart for more series, capped so it never dominates the page. */
export function chartHeight(base: number, series: number): number {
  return Math.min(base + 80, base + Math.max(0, series - 4) * 14);
}

export interface SeriesDelta {
  latest: number;
  previous: number | null;
  change: number | null;
  pct: number | null;
}

/** Latest real value versus the previous real value (gaps are skipped, never treated as zero). */
export function seriesDelta(values: (number | null)[]): SeriesDelta | null {
  const points = values.filter(
    (v): v is number => v !== null && v !== undefined,
  );
  if (points.length === 0) return null;
  const latest = points[points.length - 1];
  if (points.length === 1)
    return { latest, previous: null, change: null, pct: null };
  const previous = points[points.length - 2];
  return {
    latest,
    previous,
    change: latest - previous,
    pct:
      previous === 0 ? null : ((latest - previous) / Math.abs(previous)) * 100,
  };
}

export interface ViewContext {
  rows: number;
  dual: boolean;
  unit: MatrixFormat["unit"];
  /** True when the series are parts of one whole (see isShareOfWhole); needed to stack percentages. */
  partsOfWhole?: boolean;
}

/**
 * Percent series that add up to about 100 in every period with data (e.g. task-type contribution)
 * are shares of a whole and can be stacked. Independent rates (error %, shrinkage %) cannot.
 */
export function isShareOfWhole(matrix: Matrix, tolerance = 1.5): boolean {
  let periodsWithData = 0;
  for (let i = 0; i < matrix.buckets.length; i++) {
    const values = matrix.rows.map((r) => r.values[i]).filter((v): v is number => v !== null && v !== undefined);
    if (values.length === 0) continue;
    periodsWithData++;
    const sum = values.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 100) > tolerance) return false;
  }
  return periodsWithData > 0;
}

/** Chart types that are meaningful for this matrix. */
export function availableViews({
  rows,
  dual,
  unit,
  partsOfWhole,
}: ViewContext): MatrixView[] {
  const views: MatrixView[] = ["lines"];
  if (!dual) views.push("bars");
  if (!dual && rows > 1 && (unit === "count" || (unit === "percent" && partsOfWhole))) views.push("stacked");
  if (rows > 1) views.push("multiples");
  return views;
}

/** Small multiples where a single chart would overlap (5+ series), otherwise the familiar lines. */
export function defaultView(ctx: ViewContext): MatrixView {
  return ctx.rows >= 5 && availableViews(ctx).includes("multiples")
    ? "multiples"
    : "lines";
}
