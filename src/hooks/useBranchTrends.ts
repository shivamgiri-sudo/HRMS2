import { useQueries } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

const BASE = "/api/branch-head-health";
export const TREND_DAYS = 14;
const FIVE_MINUTES = 5 * 60_000;

export interface TrendRow { date: string; value: unknown }

export function trendQueryKey(branchId: string, metric: string, days = TREND_DAYS) {
  return ["branch-head-health-trend", branchId, metric, days] as const;
}

/** Snapshot rows to values, oldest first; anything that is not a finite number becomes a gap (null). */
export function trendValues(rows: TrendRow[] | null | undefined): Array<number | null> {
  if (!Array.isArray(rows)) return [];
  return [...rows]
    .sort((a, b) => String(a?.date ?? "").localeCompare(String(b?.date ?? "")))
    .map((r) => (typeof r?.value === "number" && Number.isFinite(r.value) ? r.value : null));
}

/** One metric's daily snapshots. Never throws: a failed request or an odd body is an empty trend. */
export async function fetchTrend(branchId: string, metric: string, days = TREND_DAYS): Promise<Array<number | null>> {
  try {
    const qs = new URLSearchParams({ branchId, metric, days: String(days) });
    const res = await hrmsApi.get<{ success?: boolean; data?: TrendRow[] }>(`${BASE}/trend?${qs.toString()}`);
    return trendValues(res?.data);
  } catch {
    return [];
  }
}

/**
 * Daily snapshot trends for the sparklines, one request per metric. Snapshots accumulate only while the
 * page is used, so most series are short; Sparkline draws nothing below 3 points.
 */
export function useBranchTrends(branchId: string | null, metrics: string[]): { data: Record<string, Array<number | null>>; isLoading: boolean } {
  const results = useQueries({
    queries: metrics.map((metric) => ({
      queryKey: trendQueryKey(branchId ?? "", metric),
      queryFn: () => fetchTrend(branchId ?? "", metric),
      enabled: Boolean(branchId),
      staleTime: FIVE_MINUTES,
      retry: false,
    })),
  });
  const data: Record<string, Array<number | null>> = {};
  metrics.forEach((m, i) => { data[m] = results[i]?.data ?? []; });
  return { data, isLoading: Boolean(branchId) && results.some((r) => r.isLoading) };
}
