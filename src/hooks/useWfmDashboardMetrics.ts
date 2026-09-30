import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

interface WfmAnalytics {
  roster_publish_rate: number;
  total_processes: number;
  published_processes: number;
  adherence_pct: number;
  shrinkage_pct: number;
  attendance_exceptions: {
    mismatch_count: number;
    cosec_sync_errors: number;
    manual_entry_count: number;
  };
  real_time_attendance: {
    expected_today: number;
    present: number;
    absent: number;
    late: number;
    on_leave: number;
    attendance_pct: number;
  };
  break_compliance: {
    over_break_count: number;
    avg_over_break_mins: number;
    top_violators: Array<{
      employee_id: number;
      employee_name: string;
      branch_name: string;
      avg_over_break_mins: number;
    }>;
  };
  workforce_forecast: Array<{
    date: string;
    demand: number;
    supply: number;
    gap: number;
  }>;
  adherence_by_process: Array<{
    process_id: number;
    process_name: string;
    rostered: number;
    actual: number;
    adherence_pct: number;
  }>;
}

export function useWfmAnalytics(enabled = true) {
  return useQuery<WfmAnalytics>({
    queryKey: ["wfm", "analytics"],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success?: boolean; data?: WfmAnalytics }>("/wfm/analytics");
      // The route returns the { success, data } envelope; the fallback tolerates a bare payload.
      return response.data ?? (response as unknown as WfmAnalytics);
    },
    enabled,
    staleTime: 2 * 60 * 1000, // 2 min (real-time data)
    gcTime: 5 * 60 * 1000,
  });
}
