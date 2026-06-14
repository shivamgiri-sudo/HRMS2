import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employee: {
    name: string;
    avatar?: string;
    department: string;
  };
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  submittedAt: string;
  reviewedBy?: {
    name: string;
  };
  reviewedAt?: string;
  reviewNotes?: string;
}

function mapRawToLeaveRequest(req: any): LeaveRequest {
  const empName = req.employee_name
    ?? (req.first_name && req.last_name ? `${req.first_name} ${req.last_name}` : null)
    ?? req.employee?.name
    ?? "Unknown";

  const dept = req.department_name ?? req.employee?.department ?? "Unassigned";
  const avatar = req.avatar_url ?? req.employee?.avatar ?? undefined;

  const startRaw = req.from_date ?? req.start_date;
  const endRaw = req.to_date ?? req.end_date;
  const days = req.total_days ?? req.days_count ?? 0;
  const submittedRaw = req.applied_at ?? req.created_at;
  const typeName = req.leave_type_name ?? req.leave_type?.name ?? req.type ?? "Unknown";
  const reviewerName = req.reviewer_name ?? req.reviewed_by_name ?? undefined;
  const reviewedAtRaw = req.reviewed_at ?? undefined;
  const reviewNotes = req.review_notes ?? req.remarks ?? undefined;

  return {
    id: req.id,
    employeeId: req.employee_id,
    employee: { name: empName, avatar, department: dept },
    type: typeName,
    startDate: startRaw ?? "",
    endDate: endRaw ?? "",
    days,
    reason: req.reason || "",
    status: req.status as LeaveRequest["status"],
    submittedAt: submittedRaw ?? "",
    reviewedBy: reviewerName ? { name: reviewerName } : undefined,
    reviewedAt: reviewedAtRaw ?? undefined,
    reviewNotes: reviewNotes || undefined,
  };
}

export function useLeaveRequests() {
  return useQuery({
    queryKey: ["leave-requests"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>("/api/leave/requests");
      return (res.data || []).map(mapRawToLeaveRequest);
    },
    staleTime: 0, // Always fetch fresh data
    gcTime: 0, // Don't cache (was cacheTime in v4)
  });
}

export function useLeaveStats() {
  return useQuery({
    queryKey: ["leave-stats"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>("/api/leave/requests");
      const data = res.data || [];
      return {
        pending: data.filter((r) => r.status === "pending").length,
        approved: data.filter((r) => r.status === "approved").length,
        rejected: data.filter((r) => r.status === "rejected").length,
      };
    },
    staleTime: 0, // Always fetch fresh data
    gcTime: 0, // Don't cache
  });
}

export function useUpdateLeaveStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      await hrmsApi.patch(`/api/leave/requests/${id}/review`, { status, remarks: null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-stats"] });
    },
  });
}
