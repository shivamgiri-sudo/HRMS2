import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export interface EligibilityRow {
  id: string;
  leave_type_id: string;
}

/**
 * Eligible leave type IDs for a given employee.
 * Used both for the request form (filter) and the eligibility manager.
 */
export function useLeaveEligibility(employeeId: string | undefined) {
  return useQuery({
    queryKey: ["leave-eligibility", employeeId],
    queryFn: async () => {
      if (!employeeId) return [] as EligibilityRow[];
      const { data, error } = await supabase
        .from("employee_leave_eligibility")
        .select("id, leave_type_id")
        .eq("employee_id", employeeId);
      if (error) throw error;
      return (data ?? []) as EligibilityRow[];
    },
    enabled: !!employeeId,
  });
}

export function useUpdateLeaveEligibility() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      employeeId,
      leaveTypeIds,
    }: {
      employeeId: string;
      leaveTypeIds: string[];
    }) => {
      // Fetch current eligibility
      const { data: existing, error: fetchErr } = await supabase
        .from("employee_leave_eligibility")
        .select("id, leave_type_id")
        .eq("employee_id", employeeId);
      if (fetchErr) throw fetchErr;

      const existingIds = new Set((existing ?? []).map((r) => r.leave_type_id));
      const desiredIds = new Set(leaveTypeIds);

      const toInsert = leaveTypeIds.filter((id) => !existingIds.has(id));
      const toDeleteRows = (existing ?? []).filter((r) => !desiredIds.has(r.leave_type_id));

      if (toInsert.length > 0) {
        const rows = toInsert.map((leave_type_id) => ({
          employee_id: employeeId,
          leave_type_id,
          created_by: user?.id ?? null,
        }));
        const { error: insErr } = await supabase
          .from("employee_leave_eligibility")
          .insert(rows);
        if (insErr) throw insErr;
      }

      if (toDeleteRows.length > 0) {
        const { error: delErr } = await supabase
          .from("employee_leave_eligibility")
          .delete()
          .in(
            "id",
            toDeleteRows.map((r) => r.id)
          );
        if (delErr) throw delErr;
      }
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["leave-eligibility", vars.employeeId] });
      toast.success("Leave eligibility updated");
    },
    onError: (err: Error) => {
      toast.error("Failed to update eligibility: " + err.message);
    },
  });
}
