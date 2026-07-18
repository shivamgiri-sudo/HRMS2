import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdminOrHR } from "@/hooks/useUserRole";

const EXCLUDE_FROM_DAILY_TOTAL = ['MTRL', 'PTRL', 'LWP'];

async function getEligibleLeaveTotals(empId: string, year: number) {
  try {
    const res = await hrmsApi.get<{ data: any[] }>(`/api/leave/balance/${empId}?year=${year}`);
    const rows = (res.data ?? []).filter(r => !EXCLUDE_FROM_DAILY_TOTAL.includes(r.leave_code));
    return {
      totalLeaves: rows.reduce((s, r) => s + (Number(r.allocated_days) || Number(r.max_days_per_year) || 0), 0),
      usedLeaves: rows.reduce((s, r) => s + (Number(r.used_days) || 0), 0),
      availableLeaves: rows.reduce(
        (s, r) => s + ((Number(r.allocated_days) || 0) - (Number(r.used_days) || 0) + (Number(r.adjusted_days) || 0)),
        0
      ),
    };
  } catch {
    return { totalLeaves: null, usedLeaves: null, availableLeaves: null };
  }
}

export function useDashboardStats() {
  const { user } = useAuth();
  const { isAdminOrHR, isLoading: roleLoading } = useIsAdminOrHR();

  return useQuery({
    queryKey: ["dashboard-stats", user?.id, isAdminOrHR],
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      // Batch 1: resolve the employee record (needed for all subsequent calls)
      let myEmployee: { id: string } | null = null;
      try {
        const meRes = await hrmsApi.get<{ data: any }>("/api/employees/me");
        if (meRes.data?.id) myEmployee = { id: meRes.data.id };
      } catch { /* not an employee */ }

      if (!myEmployee) {
        return { totalEmployees: null, onLeaveToday: 0, assetsAssigned: 0, pendingPayroll: null, pendingApprovals: 0, isEmployee: false };
      }

      const today = new Date().toISOString().split("T")[0];
      const currentYear = new Date().getFullYear();

      // Batch 2: fire all independent calls in parallel
      const [leavesResult, leaveTotals, assetsResult, pendingResult, statsResult] = await Promise.allSettled([
        hrmsApi.get<{ data: any[] }>(`/api/leave/requests?employeeId=${myEmployee.id}&status=approved&activeOn=${today}`),
        getEligibleLeaveTotals(myEmployee.id, currentYear),
        hrmsApi.get<{ data: any[] }>(`/api/assets-mgmt/employee/${myEmployee.id}`),
        isAdminOrHR ? hrmsApi.get<{ data: any[] }>(`/api/leave/requests?status=pending`) : Promise.resolve(null),
        isAdminOrHR ? hrmsApi.get<{ data: any }>("/api/employees/stats") : Promise.resolve(null),
      ]);

      const amOnLeave = leavesResult.status === "fulfilled"
        ? (leavesResult.value?.data ?? []).length > 0
        : false;
      const { totalLeaves, usedLeaves, availableLeaves } = leaveTotals.status === "fulfilled"
        ? leaveTotals.value
        : { totalLeaves: null, usedLeaves: null, availableLeaves: null };
      const myAssetsCount = assetsResult.status === "fulfilled"
        ? (assetsResult.value?.data ?? []).length
        : 0;
      const pendingApprovals = pendingResult.status === "fulfilled"
        ? (pendingResult.value?.data ?? []).length
        : 0;
      const totalEmployees = statsResult.status === "fulfilled"
        ? (statsResult.value?.data?.total_employees ?? null)
        : null;

      return {
        totalEmployees,
        onLeaveToday: amOnLeave ? 1 : 0,
        assetsAssigned: myAssetsCount,
        pendingPayroll: null,
        pendingApprovals,
        isEmployee: true,
        totalLeaves,
        usedLeaves,
        availableLeaves,
      };
    },
    enabled: !!user?.id && !roleLoading,
  });
}

export function useRecentActivity() {
  return useQuery({
    queryKey: ["recent-activity"],
    queryFn: async () => {
      try {
        const res = await hrmsApi.get<{ data: any[] }>("/api/access/audit-log?limit=10");
        return res.data ?? [];
      } catch {
        return [];
      }
    },
  });
}
