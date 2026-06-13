import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdminOrHR } from "@/hooks/useUserRole";

async function getEligibleLeaveTotals(empId: string, year: number) {
  try {
    const res = await hrmsApi.get<{ data: any[] }>(`/api/leave/balance/${empId}?year=${year}`);
    const rows = res.data ?? [];
    return {
      totalLeaves: rows.reduce((s, r) => s + (Number(r.allocated_days) ?? Number(r.max_days_per_year) ?? 0), 0),
      usedLeaves: rows.reduce((s, r) => s + (Number(r.used_days) ?? 0), 0),
      availableLeaves: rows.reduce(
        (s, r) => s + ((Number(r.allocated_days) ?? 0) - (Number(r.used_days) ?? 0) + (Number(r.adjusted_days) ?? 0)),
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
    refetchInterval: 30000,
    queryFn: async () => {
      let myEmployee: { id: string } | null = null;
      try {
        const meRes = await hrmsApi.get<{ data: any }>("/api/employees/me");
        if (meRes.data?.id) myEmployee = { id: meRes.data.id };
      } catch { /* not an employee */ }

      if (!myEmployee) {
        return { totalEmployees: null, onLeaveToday: 0, assetsAssigned: 0, pendingPayroll: null, pendingApprovals: 0, isEmployee: false };
      }

      const today = new Date().toISOString().split("T")[0];
      let amOnLeave = false;
      try {
        const leavesRes = await hrmsApi.get<{ data: any[] }>(
          `/api/leave/requests?employeeId=${myEmployee.id}&status=approved&activeOn=${today}`
        );
        amOnLeave = (leavesRes.data ?? []).length > 0;
      } catch { /* non-fatal */ }

      const currentYear = new Date().getFullYear();
      const { totalLeaves, usedLeaves, availableLeaves } = await getEligibleLeaveTotals(myEmployee.id, currentYear);

      let myAssetsCount = 0;
      try {
        const assetsRes = await hrmsApi.get<{ data: any[] }>(`/api/assets-mgmt/employee/${myEmployee.id}`);
        myAssetsCount = (assetsRes.data ?? []).length;
      } catch { /* non-fatal */ }

      let pendingApprovals = 0;
      try {
        const pendingRes = await hrmsApi.get<{ data: any[] }>(`/api/leave/requests?status=pending`);
        pendingApprovals = (pendingRes.data ?? []).length;
      } catch { /* non-fatal */ }

      let totalEmployees: number | null = null;
      if (isAdminOrHR) {
        try {
          const statsRes = await hrmsApi.get<{ data: any }>("/api/employees/stats");
          totalEmployees = statsRes.data?.total_employees ?? null;
        } catch { /* non-fatal */ }
      }

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
