import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export interface LeaveBalance {
  id: string;
  leave_code: string;
  leave_type: { name: string; is_paid: boolean | null };
  allocated_days: number;
  used_days: number;
  adjusted_days: number;
  available_days: number;
  annual_entitlement: number | null;
  year: number;
  // EL-specific: current year's accumulation (not yet spendable)
  el_accruing_days?: number;
  el_last_credited_month?: number;
}

export function useLeaveBalances(employeeId: string | undefined) {
  const currentYear = new Date().getFullYear();

  return useQuery({
    queryKey: ["leave-balances", employeeId, currentYear],
    queryFn: async () => {
      if (!employeeId) return [];

      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
        `/api/leave/balance/${employeeId}?year=${currentYear}`
      );
      const rows = res.data ?? [];

      return rows.map((row: any): LeaveBalance => {
        const allocated = Number(row.allocated_days ?? 0);
        const used = Number(row.used_days ?? 0);
        const adjusted = Number(row.adjusted_days ?? 0);
        // Backend now returns available_days directly; fall back to computed value
        const available = row.available_days != null
          ? Number(row.available_days)
          : allocated + adjusted - used;

        return {
          id: row.id ?? row.leave_type_id,
          leave_code: row.leave_code ?? "",
          leave_type: {
            name: row.leave_name ?? row.leave_code ?? "Unknown",
            is_paid: row.paid_leave != null ? Boolean(row.paid_leave) : null,
          },
          allocated_days: allocated,
          used_days: used,
          adjusted_days: adjusted,
          available_days: available,
          annual_entitlement: row.annual_entitlement != null ? Number(row.annual_entitlement) : null,
          year: Number(row.balance_year ?? currentYear),
          el_accruing_days: row.el_accruing_days != null ? Number(row.el_accruing_days) : undefined,
          el_last_credited_month: row.el_last_credited_month != null ? Number(row.el_last_credited_month) : undefined,
        };
      });
    },
    enabled: !!employeeId,
  });
}
