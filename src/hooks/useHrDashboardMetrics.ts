import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Exit Analytics Types ─────────────────────────────────────────────────────

interface ExitAnalytics {
  resignations_this_month: number;
  resignations_ytd: number;
  avg_notice_period_days: number;
  ff_pending_count: number;
  ff_pending_over_45_days: number;
  avg_clearance_tat_days: number;
  exits_by_month: Array<{ month: string; count: number }>;
  ff_aging_buckets: {
    under_30: number;
    "30_to_45": number;
    over_45: number;
  };
}

export function useExitAnalytics(enabled = true) {
  return useQuery<ExitAnalytics>({
    queryKey: ["hr", "exit", "analytics"],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success?: boolean; data?: ExitAnalytics }>("/exit/analytics");
      // The route returns the { success, data } envelope; the fallback tolerates a bare payload.
      return response.data ?? (response as unknown as ExitAnalytics);
    },
    enabled,
    staleTime: 10 * 60 * 1000, // 10 min
    gcTime: 15 * 60 * 1000,
  });
}
