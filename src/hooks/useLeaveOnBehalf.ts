import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { eachDayOfInterval, parseISO, isSameDay } from "date-fns";
import { hrmsApi } from "@/lib/hrmsApi";
import { normalizeDate } from "@/lib/utils";

/**
 * "Raise leave for a direct report" — the consent-gated counterpart to
 * useSubmitLeaveRequest (which is self-service only). Backed by
 * /api/wfm/attendance/team-month/leave-on-behalf*, not /api/leave/requests: the employee
 * must consent before anything becomes a real leave_request. See that route file for why
 * this is a separate path rather than widening the existing on-behalf submission.
 */

export interface ManagerRaisedLeave {
  id: string;
  request_type: string;
  payload: { leaveTypeId: string; fromDate: string; toDate: string; totalDays: number; reason?: string | null };
  consent_status: "pending_employee_consent" | "consented" | "declined";
  created_at: string;
  resulting_request_id?: string | null;
  decline_reason?: string | null;
  raised_by_name?: string;
  leave_name?: string;
  employee_name?: string;
  employee_id?: string;
}

/** Business-day count for a range — same estimate useSubmitLeaveRequest uses, so the
 *  number a manager sees while raising this matches what the employee would see raising
 *  it themself. The backend recomputes/validates on consent regardless. */
export async function estimateLeaveDays(startDate: Date, endDate: Date): Promise<number> {
  const year = startDate.getFullYear();
  let holidayDates: Date[] = [];
  try {
    const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
      `/api/org/events?is_holiday=true&start=${year}-01-01&end=${year}-12-31`,
    );
    holidayDates = (res.data || []).map((h: any) => parseISO(normalizeDate(h.event_date)));
  } catch {
    // Non-fatal — proceed without holiday exclusion
  }
  return eachDayOfInterval({ start: startDate, end: endDate })
    .filter((d) => !holidayDates.some((hd) => isSameDay(d, hd))).length;
}

export function useRaiseLeaveOnBehalf() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      employeeId: string;
      leaveTypeId: string;
      fromDate: string;
      toDate: string;
      totalDays: number;
      reason?: string;
    }) => {
      const res = await hrmsApi.post<{ success: boolean; data: { id: string } }>(
        "/api/wfm/attendance/team-month/leave-on-behalf",
        input,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-on-behalf", "raised-by-me"] });
    },
  });
}

/** What the current manager/TL has raised, for the small status list on the attendance page. */
export function useMyRaisedLeaveRequests() {
  return useQuery<ManagerRaisedLeave[]>({
    queryKey: ["leave-on-behalf", "raised-by-me"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: ManagerRaisedLeave[] }>(
        "/api/wfm/attendance/team-month/leave-on-behalf",
      );
      return res.data ?? [];
    },
    staleTime: 30_000,
  });
}

/** Leave requests raised on the current employee's own behalf, awaiting their decision. */
export function usePendingLeaveConsents() {
  return useQuery<ManagerRaisedLeave[]>({
    queryKey: ["leave-on-behalf", "mine"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: ManagerRaisedLeave[] }>(
        "/api/wfm/attendance/team-month/leave-on-behalf/mine",
      );
      return res.data ?? [];
    },
    staleTime: 30_000,
  });
}

export function useDecideLeaveConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, decision, reason }: { id: string; decision: "approve" | "decline"; reason?: string }) => {
      const res = await hrmsApi.patch<{ success: boolean; data: unknown }>(
        `/api/wfm/attendance/team-month/leave-on-behalf/${id}/consent`,
        { decision, reason },
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-on-behalf"] });
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
    },
  });
}
