/**
 * Attendance corrections — the write half of Attendance Lookup.
 *
 * The page could already answer "what does this employee's attendance look like"; these
 * hooks are what let Payroll Head and Super Admin change it. Three separate backends sit
 * behind them, and they are deliberately kept apart rather than merged into one "fix it"
 * call, because each writes a different audit trail:
 *
 *   1. /api/attendance/manual-overrides — rewrites one day's attendance_daily_record
 *      status under approval. Built long ago, never given a screen: the table held 0 rows
 *      against 158,485 attendance records when this was written.
 *   2. /api/discard/*                   — reverses an approved leave / regularization /
 *      dispute and restores the days it changed. Already live, used from three other pages.
 *   3. /api/wfm/attendance-exceptions   — closes a reconciliation exception with a reason.
 *
 * Only super_admin and payroll_head get any of it. Everyone else keeps the read-only page
 * they have today.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi, getHrmsApiErrorStatus } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { AFFECTED_QUERY_KEYS } from "@/hooks/useDiscard";

/** Minimum characters for any correction reason. Matches every backend's own check. */
export const MIN_CORRECTION_REASON = 10;

/**
 * The statuses a day can be moved to.
 *
 * Sourced from what attendance_daily_record actually holds (live, last 90 days:
 * present 49,479 · missing_punch 23,321 · half_day 17,027 · absent 15,966 · week_off 851 ·
 * holiday 497 · leave_approved 117 · week_off_worked 94) rather than from an enum
 * somewhere — a value nobody can produce is a value nobody should be able to pick.
 *
 * `lwp` mirrors the backend's own map on approve: present 0, half_day 0.5, absent 1.0, and
 * NULL (leave the stored value alone) for everything else. Shown so the reviewer can see
 * the pay consequence before they commit, not to send it — the server derives its own.
 */
export const ATTENDANCE_STATUS_OPTIONS: { value: string; label: string; lwp: number | null; hint: string }[] = [
  { value: "present",         label: "Present",           lwp: 0,    hint: "Full paid day." },
  { value: "half_day",        label: "Half Day",          lwp: 0.5,  hint: "Half a day of loss of pay." },
  { value: "absent",          label: "Absent",            lwp: 1,    hint: "Full loss of pay." },
  { value: "missing_punch",   label: "Missing Punch",     lwp: null, hint: "Unresolved punch — pays zero until corrected." },
  { value: "week_off",        label: "Week Off",          lwp: null, hint: "Scheduled off day." },
  { value: "week_off_worked", label: "Week Off (Worked)", lwp: null, hint: "Worked on a week off — paid and still counts to entitlement." },
  { value: "holiday",         label: "Holiday",           lwp: null, hint: "Company holiday." },
  { value: "leave_approved",  label: "Leave (Approved)",  lwp: null, hint: "Covered by an approved leave request." },
];

export interface ManualOverrideRow {
  id: string;
  employee_id: string;
  attendance_date: string;
  old_status: string | null;
  new_status: string;
  old_lwp: number | null;
  new_lwp: number | null;
  reason: string;
  approval_status: "pending" | "approved" | "rejected";
  is_payroll_month_locked: number;
  higher_approval_required: number;
  payroll_month: string | null;
  created_at: string;
  approved_at: string | null;
  applied_at: string | null;
  employee_name?: string | null;
  employee_code?: string | null;
}

export interface AttendanceExceptionRow {
  id: string;
  issue_date: string;
  issue_type: string;
  severity: "blocker" | "warning";
  employee_id: string | null;
  employee_code: string | null;
  adr_status: string | null;
  source_minutes: number | null;
  hrms_minutes: number | null;
  auto_fix_status: string | null;
  auto_fix_reason: string | null;
  first_detected_at: string | null;
  last_detected_at: string | null;
  resolved_at: string | null;
  age_days: number | null;
}

/**
 * Who may correct attendance from this page.
 *
 * Narrower than the page itself, which hr / wfm / admin can also open — they keep the
 * read-only view. Narrower, too, than /api/attendance/manual-overrides accepts
 * (payroll_admin and admin also pass its own guard): the ask was Payroll Head and Super
 * Admin, and the UI should not offer a button the business has not sanctioned just
 * because the API would honour it.
 */
export function useCanCorrectAttendance(): { canCorrect: boolean; isLoading: boolean } {
  const { roleKeys, isLoading } = useWorkforceAccess();
  return {
    canCorrect: (roleKeys ?? []).some((r: string) => r === "super_admin" || r === "payroll_head"),
    isLoading,
  };
}

/** True for super_admin only — the one role that can approve a locked payroll month. */
export function useIsSuperAdmin(): boolean {
  const { roleKeys } = useWorkforceAccess();
  return (roleKeys ?? []).some((r: string) => r === "super_admin");
}

function invalidateAttendance(qc: ReturnType<typeof useQueryClient>) {
  // Reuses the discard feature's list rather than keeping a second one: a status change
  // and a discard move exactly the same downstream numbers (day, month summary, running
  // salary, dashboards), so two lists would drift and one screen would go stale.
  for (const key of AFFECTED_QUERY_KEYS) void qc.invalidateQueries({ queryKey: key });
  void qc.invalidateQueries({ queryKey: ["manual-overrides"] });
  void qc.invalidateQueries({ queryKey: ["employee-exceptions"] });
}

// ── Manual attendance status change ──────────────────────────────────────────

export interface ChangeStatusInput {
  employeeId: string;
  attendanceDate: string;   // YYYY-MM-DD
  newStatus: string;
  reason: string;
  /** YYYY-MM. Sent so the server can tell whether the payroll month is closed. */
  payrollMonth: string;
}

export interface ChangeStatusResult {
  /** "applied" — the day is changed. "pending_super_admin" — recorded, awaiting approval. */
  outcome: "applied" | "pending_super_admin";
  overrideId: string;
  lockedMonth: boolean;
}

/**
 * Change one day's attendance status.
 *
 * Two calls, because the API is a create-then-approve pair and the day only moves on
 * approve. For an open payroll month the same person does both in one click, which is what
 * was asked for. For a CLOSED month the server refuses the approve for anyone but Super
 * Admin — the request stays pending and the caller is told so, rather than the failure
 * being surfaced as an error on a change that was in fact recorded.
 */
export function useChangeAttendanceStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ChangeStatusInput): Promise<ChangeStatusResult> => {
      const created = await hrmsApi.post<{ success: boolean; data: { id: string; higher_approval_required?: number; is_payroll_month_locked?: number } }>(
        "/api/attendance/manual-overrides",
        {
          employee_id: input.employeeId,
          attendance_date: input.attendanceDate,
          new_status: input.newStatus,
          reason: input.reason,
          payroll_month: input.payrollMonth,
        },
      );
      const overrideId = created?.data?.id;
      if (!overrideId) throw new Error("The override was not created.");
      const lockedMonth = Boolean(created?.data?.higher_approval_required || created?.data?.is_payroll_month_locked);

      try {
        await hrmsApi.post(`/api/attendance/manual-overrides/${overrideId}/approve`, {});
        return { outcome: "applied", overrideId, lockedMonth };
      } catch (err: any) {
        // A locked month refuses the approve with 403 for everyone but Super Admin. The
        // create already succeeded, so this is not a failure — it is the approval step of
        // a two-stage flow, and saying "error" here would send the user to redo something
        // that is already recorded and waiting.
        if (lockedMonth && getHrmsApiErrorStatus(err) === 403) {
          return { outcome: "pending_super_admin", overrideId, lockedMonth: true };
        }
        throw err;
      }
    },
    onSuccess: () => invalidateAttendance(qc),
  });
}

/** Every manual override raised against one employee, newest first. */
export function useEmployeeOverrides(employeeId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["manual-overrides", employeeId],
    enabled: Boolean(employeeId) && enabled,
    staleTime: 0,
    queryFn: async (): Promise<ManualOverrideRow[]> => {
      const res = await hrmsApi.get<{ success: boolean; data: ManualOverrideRow[] }>(
        `/api/attendance/manual-overrides?employeeId=${employeeId}`,
      );
      return res?.data ?? [];
    },
  });
}

/** Approve a pending override — Super Admin's path for a closed payroll month. */
export function useApproveOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (overrideId: string) => {
      await hrmsApi.post(`/api/attendance/manual-overrides/${overrideId}/approve`, {});
    },
    onSuccess: () => invalidateAttendance(qc),
  });
}

export function useRejectOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ overrideId, reason }: { overrideId: string; reason: string }) => {
      await hrmsApi.post(`/api/attendance/manual-overrides/${overrideId}/reject`, { rejection_reason: reason });
    },
    onSuccess: () => invalidateAttendance(qc),
  });
}

// ── Reconciliation exceptions ────────────────────────────────────────────────

/**
 * One employee's attendance exceptions.
 *
 * Note the store: /api/wfm/attendance-exceptions reads attendance_reconciliation_issue
 * (18,038 rows live, ~6,000 open). The similarly named
 * /api/attendance/exception-engine reads `attendance_exception`, which has never held a
 * single row — pointing this at it would produce a tab that is empty for everybody.
 *
 * fromDate is passed explicitly because the endpoint otherwise defaults to a 30-day
 * window, and someone correcting last quarter's attendance needs to see last quarter's
 * exceptions.
 */
export function useEmployeeExceptions(
  employeeId: string | null,
  opts: { fromDate: string; toDate?: string; status?: "open" | "resolved" | "all" } ,
) {
  const params = new URLSearchParams({
    employeeId: employeeId ?? "",
    status: opts.status ?? "all",
    fromDate: opts.fromDate,
    limit: "100",
  });
  if (opts.toDate) params.set("toDate", opts.toDate);

  return useQuery({
    queryKey: ["employee-exceptions", employeeId, opts.fromDate, opts.toDate ?? null, opts.status ?? "all"],
    enabled: Boolean(employeeId),
    staleTime: 0,
    queryFn: async (): Promise<AttendanceExceptionRow[]> => {
      const res = await hrmsApi.get<{ success: boolean; data: AttendanceExceptionRow[] }>(
        `/api/wfm/attendance-exceptions?${params.toString()}`,
      );
      return res?.data ?? [];
    },
  });
}

export function useResolveException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason, reopen }: { id: string; reason: string; reopen?: boolean }) => {
      await hrmsApi.post(`/api/wfm/attendance-exceptions/${id}/${reopen ? "reopen" : "resolve"}`, { reason });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["employee-exceptions"] });
      void qc.invalidateQueries({ queryKey: ["attendance-exceptions"] });
    },
  });
}

/** Human label for a reconciliation issue type. */
export const EXCEPTION_TYPE_LABELS: Record<string, string> = {
  unmapped_cosec_user: "Biometric user not mapped",
  missing_ibd: "Missing in biometric data",
  zero_minute_attendance: "Zero minutes recorded",
  missing_punch_with_usable_source: "Missing punch, source has data",
  missing_adr: "No attendance row for the day",
  apr_missing_adr: "APR data, no attendance row",
  apr_minutes_mismatch: "APR minutes disagree",
  apr_source_fallback_when_apr_exists: "Fell back to another source",
  approved_regularization_missing_adr: "Approved regularization, no attendance row",
  salary_payable_days_mismatch: "Payable days disagree with salary",
  dialler_source_without_evidence: "Dialler source with no evidence",
  inactive_cosec_user_activity: "Activity from an inactive biometric user",
};
