import { useQueries } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

const BASE = "/api/branch-head-health";
export const TREND_DAYS = 14;
const FIVE_MINUTES = 5 * 60_000;

export interface TrendRow { date: string; value: unknown }

export function trendQueryKey(branchId: string, metric: string, days = TREND_DAYS) {
  return ["branch-head-health-trend", branchId, metric, days] as const;
}

/** One dated snapshot value (date as YYYY-MM-DD); non-finite values are gaps (null). */
export interface TrendPoint { date: string; value: number | null }

/** Snapshot rows to dated points, oldest first; anything that is not a finite number becomes a gap. */
export function trendPoints(rows: TrendRow[] | null | undefined): TrendPoint[] {
  if (!Array.isArray(rows)) return [];
  return [...rows]
    .sort((a, b) => String(a?.date ?? "").localeCompare(String(b?.date ?? "")))
    .map((r) => ({ date: String(r?.date ?? "").slice(0, 10), value: typeof r?.value === "number" && Number.isFinite(r.value) ? r.value : null }));
}

/** Snapshot rows to values, oldest first; anything that is not a finite number becomes a gap (null). */
export function trendValues(rows: TrendRow[] | null | undefined): Array<number | null> {
  return trendPoints(rows).map((p) => p.value);
}

/** One metric's dated snapshots. Never throws: a failed request or an odd body is an empty trend. */
export async function fetchTrendPoints(branchId: string, metric: string, days = TREND_DAYS): Promise<TrendPoint[]> {
  try {
    const qs = new URLSearchParams({ branchId, metric, days: String(days) });
    const res = await hrmsApi.get<{ success?: boolean; data?: TrendRow[] }>(`${BASE}/trend?${qs.toString()}`);
    return trendPoints(res?.data);
  } catch {
    return [];
  }
}

/** One metric's daily snapshot values (no dates). Never throws. */
export async function fetchTrend(branchId: string, metric: string, days = TREND_DAYS): Promise<Array<number | null>> {
  return (await fetchTrendPoints(branchId, metric, days)).map((p) => p.value);
}

/**
 * Daily snapshot trends for the sparklines, one request per metric. Snapshots accumulate only while the
 * page is used, so most series are short; Sparkline draws nothing below 3 points.
 */
export function useBranchTrends(branchId: string | null, metrics: string[]): {
  data: Record<string, Array<number | null>>; points: Record<string, TrendPoint[]>; isLoading: boolean;
} {
  const results = useQueries({
    queries: metrics.map((metric) => ({
      queryKey: trendQueryKey(branchId ?? "", metric),
      queryFn: () => fetchTrendPoints(branchId ?? "", metric),
      enabled: Boolean(branchId),
      staleTime: FIVE_MINUTES,
      retry: false,
    })),
  });
  const data: Record<string, Array<number | null>> = {};
  const points: Record<string, TrendPoint[]> = {};
  metrics.forEach((m, i) => {
    points[m] = results[i]?.data ?? [];
    data[m] = points[m].map((p) => p.value);
  });
  return { data, points, isLoading: Boolean(branchId) && results.some((r) => r.isLoading) };
}
