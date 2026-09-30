import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

interface PayrollAnalytics {
  salary_disputes: { open: number; in_review: number; resolved: number; avg_resolution_days: number };
  reimbursement_backlog: { total_pending: number; under_7_days: number; "7_to_15_days": number; over_15_days: number };
  payroll_readiness: { attendance_finalized_pct: number; cosec_synced_pct: number; roster_locked_pct: number; overall_readiness_pct: number };
  tds_status: { last_filed_quarter: string | null; next_deadline: string | null; projections_ready: boolean };
  gratuity_liability: { total_accrued: number; employees_eligible_this_year: number };
  ff_settlement: { pending_count: number; avg_tat_days: number; overdue_count: number };
}

export function usePayrollAnalytics(enabled = true) {
  return useQuery<PayrollAnalytics>({
    queryKey: ["payroll", "analytics"],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success?: boolean; data?: PayrollAnalytics }>("/payroll/analytics");
      // The route returns the { success, data } envelope; the fallback tolerates a bare payload.
      return response.data ?? (response as unknown as PayrollAnalytics);
    },
    enabled,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
}
