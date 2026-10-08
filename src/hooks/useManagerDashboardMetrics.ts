import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

interface ManagerAnalytics {
  team_size: number;
  team_quality_avg: number;
  team_kpi_avg: number;
  one_on_one_completion: {
    scheduled: number;
    completed: number;
    completion_rate: number;
  };
  pip_tracking: {
    active_pips: number;
    completed_this_month: number;
    at_risk_count: number;
  };
  performance_bands: {
    s_rating: number;
    a_rating: number;
    b_rating: number;
    c_rating: number;
    d_rating: number;
  };
  attrition_risk: Array<{
    employee_id: number;
    employee_name: string;
    quality_score: number;
    attendance_pct: number;
    risk_level: string;
  }>;
  team_kpi_by_process: Array<{
    process_id: number;
    process_name: string;
    target: number;
    actual: number;
    achievement_pct: number;
    status: string;
  }>;
  quality_distribution: Array<{
    score_range: string;
    count: number;
  }>;
}

export function useManagerAnalytics(enabled = true) {
  return useQuery<ManagerAnalytics>({
    queryKey: ["manager", "analytics"],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success?: boolean; data?: ManagerAnalytics }>("/management/manager-analytics");
      // The route returns the { success, data } envelope; the fallback tolerates a bare payload.
      return response.data ?? (response as unknown as ManagerAnalytics);
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 min
    gcTime: 10 * 60 * 1000,
  });
}
