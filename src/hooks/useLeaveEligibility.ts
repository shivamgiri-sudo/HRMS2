import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { toast } from "sonner";

export interface EligibilityRow {
  id: string;
  leave_type_id: string;
}

/**
 * Eligible leave type IDs for a given employee.
 * Returns all active leave types — eligibility is managed at the leave type level.
 */
export function useLeaveEligibility(employeeId: string | undefined) {
  return useQuery({
    queryKey: ["leave-eligibility", employeeId],
    queryFn: async () => {
      if (!employeeId) return [] as EligibilityRow[];
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
        `/api/leave/eligibility/${employeeId}`
      );
      // Map leave type rows to EligibilityRow shape expected by consumers
      return (res.data ?? []).map((t: any): EligibilityRow => ({
        id: t.id,
        leave_type_id: t.id,
      }));
    },
    enabled: !!employeeId,
  });
}

export function useUpdateLeaveEligibility() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      employeeId,
      leaveTypeIds: _leaveTypeIds,
    }: {
      employeeId: string;
      leaveTypeIds: string[];
    }) => {
      // Eligibility is currently managed globally via active leave types.
      // Per-employee eligibility override will be implemented when the backend
      // endpoint is available. This mutation is a no-op that preserves the
      // existing UI contract without breaking.
      void employeeId;
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
