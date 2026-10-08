import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export interface EmployeeBreakSummary {
  shift_date: string;
  break_count: number;
  completed_break_minutes: number;
  active_break_minutes: number;
  total_break_minutes: number;
  on_break: boolean;
  active_break_since: string | null;
  daily_limit_minutes: number;
  exceeded: boolean;
}

/**
 * Shared break summary for any page listing employees (max 200 ids per call).
 * Night-shift aware: each employee is summarised for their own working date unless `date` is forced.
 */
export function useBreakSummaries(employeeIds: string[], opts?: { date?: string; live?: boolean }) {
  const ids = Array.from(new Set(employeeIds.filter(Boolean))).sort().slice(0, 200);
  return useQuery({
    queryKey: ["break-summaries", ids.join(","), opts?.date ?? null],
    enabled: ids.length > 0,
    refetchInterval: opts?.live ? 30_000 : false,
    staleTime: 15_000,
    queryFn: async () => {
      const qs = new URLSearchParams({ employee_ids: ids.join(","), ...(opts?.date ? { date: opts.date } : {}) });
      const res = await hrmsApi.get(`/api/break-management/summary?${qs.toString()}`);
      return (res.data ?? {}) as Record<string, EmployeeBreakSummary>;
    },
  });
}
