import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { format } from "date-fns";

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
  // Backend MySQL rows use from_date/to_date/total_days/applied_at
  // and include joined employee fields at top level or nested
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
    employee: {
      name: empName,
      avatar,
      department: dept,
    },
    type: typeName,
    startDate: startRaw ? format(new Date(startRaw), "MMM d, yyyy") : "",
    endDate: endRaw ? format(new Date(endRaw), "MMM d, yyyy") : "",
    days,
    reason: req.reason || "",
    status: req.status as LeaveRequest["status"],
    submittedAt: submittedRaw ? format(new Date(submittedRaw), "MMM d, yyyy 'at' h:mm a") : "",
    reviewedBy: reviewerName ? { name: reviewerName } : undefined,
    reviewedAt: reviewedAtRaw ? format(new Date(reviewedAtRaw), "MMM d, yyyy 'at' h:mm a") : undefined,
    reviewNotes: reviewNotes || undefined,
  };
}

export function useLeaveRequests() {
  return useQuery({
    queryKey: ["leave-requests"],
    queryFn: async () => {
      // Local demo mode bypass
      if (localStorage.getItem("hrms_demo_session")) {
        return [
          {
            id: "leave-1",
            employeeId: "emp-2",
            employee: {
              name: "Ananya Sharma",
              department: "Operations",
            },
            type: "Sick Leave",
            startDate: "May 24, 2026",
            endDate: "May 26, 2026",
            days: 3,
            reason: "Doctor advised rest due to fever",
            status: "pending",
            submittedAt: "May 23, 2026 at 10:15 AM",
          },
          {
            id: "leave-2",
            employeeId: "emp-3",
            employee: {
              name: "Rajesh Kumar",
              department: "Technical Support",
            },
            type: "Casual Leave",
            startDate: "May 20, 2026",
            endDate: "May 21, 2026",
            days: 2,
            reason: "Family function out of town",
            status: "approved",
            submittedAt: "May 18, 2026 at 4:30 PM",
            reviewedBy: { name: "Demo Admin" },
            reviewedAt: "May 19, 2026 at 11:00 AM",
            reviewNotes: "Approved, backup resource arranged.",
          }
        ] as LeaveRequest[];
      }

      const res = await hrmsApi.get<{ success: boolean; data: any[] }>("/api/leave/requests");
      return (res.data || []).map(mapRawToLeaveRequest);
    },
  });
}

export function useLeaveStats() {
  return useQuery({
    queryKey: ["leave-stats"],
    queryFn: async () => {
      // Local demo mode bypass
      if (localStorage.getItem("hrms_demo_session")) {
        return { pending: 1, approved: 1, rejected: 0 };
      }

      const res = await hrmsApi.get<{ success: boolean; data: any[] }>("/api/leave/requests");
      const data = res.data || [];

      const pending = data.filter((r) => r.status === "pending").length;
      const approved = data.filter((r) => r.status === "approved").length;
      const rejected = data.filter((r) => r.status === "rejected").length;

      return { pending, approved, rejected };
    },
  });
}

export function useLeaveTypes() {
  return useQuery({
    queryKey: ["leave-types"],
    queryFn: async () => {
      // Local demo mode bypass
      if (localStorage.getItem("hrms_demo_session")) {
        return [
          { id: "type-1", name: "Sick Leave", days_per_year: 10, is_paid: true },
          { id: "type-2", name: "Casual Leave", days_per_year: 12, is_paid: true },
          { id: "type-3", name: "Maternity Leave", days_per_year: 90, is_paid: true }
        ];
      }

      const res = await hrmsApi.get<{ success: boolean; data: any[] }>("/api/leave/types");
      return (res.data || []).map((t: any) => ({
        id: t.id,
        name: t.leave_name ?? t.type_name ?? t.name,
        days_per_year: t.max_days_per_year ?? t.days_per_year ?? 0,
        is_paid: t.paid_leave != null ? Boolean(t.paid_leave) : (t.is_paid ?? null),
      }));
    },
  });
}

export function useUpdateLeaveStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      await hrmsApi.patch(`/api/leave/requests/${id}/review`, {
        status,
        reviewNotes: null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-stats"] });
    },
  });
}
