/**
 * Shared types and small helpers for the business-datapoint adapters (see business-datapoints.service.ts and
 * business-datapoints.more.ts). Read-only, no I/O.
 */
export type DatapointUnit =
  "currency" | "percentage" | "count" | "seconds" | "rating";
export type DatapointTheme =
  "sales" | "calls" | "leads" | "workforce" | "quality";
export interface DatapointCard {
  key: string;
  label: string;
  value: number | null;
  unit: DatapointUnit;
  target?: number | null;
  direction?: "higher_is_better" | "lower_is_better";
  hint?: string;
  /** Daily series behind the number (drawn as a sparkline). */
  trend?: Array<{ date: string; value: number }>;
  /** One of the few headline figures shown large at the top. */
  hero?: boolean;
}
export interface FunnelStage {
  stage: string;
  count: number;
  pctOfBase: number;
}
export interface DatapointGroup {
  key: string;
  title: string;
  source: string;
  theme?: DatapointTheme;
  cards: DatapointCard[];
  funnel?: FunnelStage[];
}

export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const n = (v: unknown): number | null => {
  const x = Number(v);
  return v === null || v === undefined || !Number.isFinite(x) ? null : x;
};
export const card = (
  key: string,
  label: string,
  value: unknown,
  unit: DatapointUnit,
  extra: Partial<DatapointCard> = {},
): DatapointCard => ({ key, label, value: n(value), unit, ...extra });
export const hasAny = (cards: DatapointCard[]) =>
  cards.some((c) => c.value !== null && c.value !== 0);

export type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const series = (
  rows: Loose[] | undefined,
  pick: (r: Loose) => unknown,
  last = 31,
): Array<{ date: string; value: number }> =>
  (rows ?? [])
    .slice(-last)
    .map((r) => ({ date: String(r.date), value: Number(pick(r)) }))
    .filter((p) => Number.isFinite(p.value));
export const round1 = (v: unknown) =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? null
    : Math.round(Number(v) * 10) / 10;
