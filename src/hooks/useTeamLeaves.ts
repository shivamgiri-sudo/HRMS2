import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";

export interface TeamLeave {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_avatar: string | null;
  leave_type: string;
  start_date: string;
  end_date: string;
  days_count: number;
}

export function useTeamLeaves(month: Date) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["team-leaves", user?.id, month.getMonth(), month.getFullYear()],
    queryFn: async () => {
      if (!user?.id) return [];
      const start = new Date(month.getFullYear(), month.getMonth(), 1).toISOString().slice(0, 10);
      const end = new Date(month.getFullYear(), month.getMonth() + 1, 0).toISOString().slice(0, 10);
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(`/api/leave/requests?fromDate=${start}&toDate=${end}&status=approved`);
      return (res.data || []).map((r: any): TeamLeave => ({
        id: r.id,
        employee_id: r.employee_id,
        employee_name: r.employee_name ?? "",
        employee_avatar: null,
        leave_type: r.leave_type_name ?? "Leave",
        start_date: r.from_date ?? r.start_date,
        end_date: r.to_date ?? r.end_date,
        days_count: r.total_days ?? r.days_count ?? 0,
      }));
    },
    enabled: !!user?.id,
  });
}

export function useIsManager() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["is-manager", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      try {
        const res = await hrmsApi.get<{ success: boolean; data: any }>("/api/employees/me");
        return !!(res as any).data?.is_manager;
      } catch { return false; }
    },
    enabled: !!user?.id,
  });
}
