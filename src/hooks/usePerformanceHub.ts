import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import type {
  PerformanceContext,
  PerformanceEnvelope,
  PerformanceFilters,
  PerformanceMetric,
  PerformancePeople,
  PerformanceTrendPoint,
} from "@/types/performanceHub";

function queryString(filters: PerformanceFilters): string {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  });
  return params.toString();
}

export function usePerformanceContext() {
  return useQuery({
    queryKey: ["performance-hub", "context"],
    queryFn: async () => (
      await hrmsApi.get<PerformanceEnvelope<PerformanceContext>>(
        "/api/performance-hub/context",
      )
    ).data,
  });
}

export function usePerformanceScorecard(filters: PerformanceFilters, enabled = true) {
  return useQuery({
    queryKey: ["performance-hub", "scorecard", filters],
    queryFn: async () => (
      await hrmsApi.get<PerformanceEnvelope<PerformanceMetric[]>>(
        `/api/performance-hub/scorecard?${queryString(filters)}`,
      )
    ).data,
    enabled,
  });
}

export function usePerformanceTrends(filters: PerformanceFilters, enabled = true) {
  return useQuery({
    queryKey: ["performance-hub", "trends", filters],
    queryFn: async () => (
      await hrmsApi.get<PerformanceEnvelope<PerformanceTrendPoint[]>>(
        `/api/performance-hub/trends?${queryString(filters)}`,
      )
    ).data,
    enabled,
  });
}

export function usePerformancePeople(filters: PerformanceFilters, enabled: boolean) {
  return useQuery({
    queryKey: ["performance-hub", "people", filters],
    queryFn: async () => (
      await hrmsApi.get<PerformanceEnvelope<PerformancePeople>>(
        `/api/performance-hub/people?${queryString(filters)}`,
      )
    ).data,
    enabled,
  });
}
