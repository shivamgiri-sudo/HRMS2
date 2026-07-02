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
  status: "pending" | "pending_branch_head" | "approved" | "rejected" | "cancelled";
  submittedAt: string;
  reviewedBy?: {
    name: string;
  };
  reviewedAt?: string;
  reviewNotes?: string;
}

async function fetchAllLeaveRows(): Promise<any[]> {
  const limit = 100;
  const first = await hrmsApi.get<{ success: boolean; data: any[]; total?: number; page?: number; limit?: number }>(
    `/api/leave/requests?page=1&limit=${limit}`
  );
  const rows = first.data ?? [];
  const total = Number(first.total ?? rows.length);
  const totalPages = Math.ceil(total / limit);

  const dedupeRows = (items: any[]) => {
    const byId = new Map<string, any>();
    for (const item of items) {
      const key = String(item?.id ?? "");
      if (!key || byId.has(key)) continue;
      byId.set(key, item);
    }
    return Array.from(byId.values());
  };

  if (totalPages <= 1) return dedupeRows(rows);

  const remaining = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) =>
      hrmsApi.get<{ success: boolean; data: any[] }>(
        `/api/leave/requests?page=${index + 2}&limit=${limit}`
      )
    )
  );
  return dedupeRows(rows.concat(...remaining.map((page) => page.data ?? [])));
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
      const rows = await fetchAllLeaveRows();
      return rows.map(mapRawToLeaveRequest);
    },
    staleTime: 30_000,       // fresh for 30s — mutations invalidate immediately
    gcTime: 2 * 60_000,      // keep in background cache for 2 min
    refetchOnWindowFocus: true,
  });
}

export function useLeaveStats() {
  return useQuery({
    queryKey: ["leave-stats"],
    queryFn: async () => {
      const data = await fetchAllLeaveRows();
      return {
        pending: data.filter((r) => String(r.status ?? "").startsWith("pending")).length,
        approved: data.filter((r) => r.status === "approved").length,
        rejected: data.filter((r) => r.status === "rejected").length,
      };
    },
    staleTime: 30_000,
    gcTime: 2 * 60_000,
    refetchOnWindowFocus: true,
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
