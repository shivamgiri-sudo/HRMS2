import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export interface MetricTrendResult {
  data: number[];
  isLoading: boolean;
}

/**
 * Fetches the last 7 data points for a dashboard metric's trend line.
 * Gracefully returns an empty array on error (no error state exposed).
 */
export function useMetricTrend(
  dashboardCode: string | undefined,
  metricCode: string | undefined
): MetricTrendResult {
  const { data, isLoading } = useQuery<number[]>({
    queryKey: ["metric-trend", dashboardCode, metricCode],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: { values: number[] } }>(
        `/api/dashboard/${dashboardCode}/metric/${metricCode}/trend`
      );
      // Backend may return values as an array directly or nested
      const values = res.data?.values ?? res.data ?? [];
      if (!Array.isArray(values)) return [];
      // Take last 7 numeric points
      return values
        .slice(-7)
        .map((v: unknown) => (typeof v === "number" ? v : Number(v)))
        .filter((v: number) => !isNaN(v));
    },
    enabled: !!dashboardCode && !!metricCode,
    staleTime: 300000, // 5 min cache
    retry: false, // graceful degradation — no retries on fail
    placeholderData: [],
  });

  return { data: data ?? [], isLoading };
}
