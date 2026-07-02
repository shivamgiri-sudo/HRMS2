import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useGeoCapture } from "@/hooks/useGeoCapture";
import { eachDayOfInterval, isWeekend, parseISO, isSameDay } from "date-fns";
import { normalizeDate } from "@/lib/utils";
import { toast } from "sonner";

export interface LeaveType {
  id: string;
  name: string;
  description: string | null;
  days_per_year: number;
  is_paid: boolean | null;
}

export function useLeaveTypes() {
  return useQuery({
    queryKey: ["leave-types"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>("/api/leave/types");
      return (res.data || []).map((t: any): LeaveType => ({
        id: t.id,
        name: t.leave_name ?? t.type_name ?? t.name,
        description: t.description ?? null,
        days_per_year: t.max_days_per_year ?? t.days_per_year ?? 0,
        is_paid: t.paid_leave != null ? Boolean(t.paid_leave) : (t.is_paid ?? null),
      }));
    },
  });
}

export function useSubmitLeaveRequest() {
  const queryClient = useQueryClient();
  const geoCapture = useGeoCapture();

  return useMutation({
    mutationFn: async ({
      employeeId,
      leaveTypeId,
      leaveTypeName,
      startDate,
      endDate,
      reason,
    }: {
      employeeId: string;
      leaveTypeId: string;
      leaveTypeName: string;
      startDate: Date;
      endDate: Date;
      reason: string;
    }) => {
      // Fetch company holidays for the date range to calculate business days
      const year = startDate.getFullYear();
      let holidayDates: Date[] = [];
      try {
        const holidayRes = await hrmsApi.get<{ success: boolean; data: any[] }>(
          `/api/org/events?is_holiday=true&start=${year}-01-01&end=${year}-12-31`
        );
        holidayDates = (holidayRes.data || []).map((h: any) => parseISO(normalizeDate(h.event_date)));
      } catch {
        // Non-fatal — proceed without holiday exclusion
      }

      // Calculate business days count (excluding weekends and public holidays)
      const daysCount = eachDayOfInterval({ start: startDate, end: endDate })
        .filter((d) => !isWeekend(d) && !holidayDates.some((hd) => isSameDay(d, hd))).length;

      const formatLocalDate = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };
      const fromDate = formatLocalDate(startDate);
      const toDate = formatLocalDate(endDate);

      const geo = await geoCapture();
      const res = await hrmsApi.post<{ success: boolean; data: any }>("/api/leave/requests", {
        employeeId,
        leaveTypeId,
        fromDate,
        toDate,
        totalDays: daysCount,
        reason: reason.trim() || null,
        latitude: geo.latitude,
        longitude: geo.longitude,
      });

      const data = res.data;

      // Notify manager (fire and forget)
      hrmsApi.post("/api/communication/dispatch/send", {
        template_name: "leave_submission",
        recipient_employee_ids: [employeeId],
        data: {
          leave_type: leaveTypeName,
          from_date: fromDate,
          to_date: toDate,
          total_days: daysCount,
          reason: reason.trim() || undefined,
        },
        channel: "email",
      }).catch((err) => {
        console.error("Failed to send leave submission notification:", err);
      });

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      toast.success("Leave request submitted successfully");
    },
    onError: (error: Error) => {
      toast.error("Failed to submit leave request: " + error.message);
    },
  });
}
