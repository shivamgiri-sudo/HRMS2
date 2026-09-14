import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";

/**
 * Discard of an approved leave / attendance regularization / attendance dispute.
 *
 * The server preview is authoritative: it runs exactly the checks the POST runs
 * and returns them as `blockers`, so the dialog and the write can never promise
 * different things.
 */

export type DiscardEntityType = "leave" | "regularization" | "dispute";

export type RestoreMode =
  | "snapshot"
  | "delete"
  | "partial"
  | "rederive"
  | "skip_locked"
  | "skip_owned";

export interface DateRestorePlan {
  date: string;
  currentStatus: string | null;
  currentLwp: number | null;
  mode: RestoreMode;
  restoredStatus: string | null;
  restoredLwp: number | null;
  note?: string;
}

export interface DiscardBlocker {
  code: string;
  message: string;
}

export interface DiscardPreview {
  entityType: DiscardEntityType;
  entityId: string;
  employeeId: string;
  employeeName: string | null;
  employeeCode: string | null;
  currentStatus: string;
  targetStatus: "discarded";
  blockers: DiscardBlocker[];
  warnings: string[];
  leave: null | {
    leaveTypeId: string;
    leaveTypeName: string | null;
    balanceYear: number;
    daysToRestore: number;
    balanceBefore: number | null;
    balanceAfter: number | null;
    ledgerRowExists: boolean;
  };
  attendance: DateRestorePlan[];
  payroll: Array<{ month: string; runStatus: string | null; isClosed: boolean }>;
  unrecoverableFields: string[];
}

export interface DiscardResult {
  discardId: string;
  entityType: DiscardEntityType;
  entityId: string;
  employeeId: string;
  restoreMode: string;
  daysRestored: number | null;
  balanceBefore: number | null;
  balanceAfter: number | null;
  datesRestored: number;
  datesDeleted: number;
  datesSkipped: number;
  attendance: DateRestorePlan[];
  warnings: string[];
  payrollRecalcStatus: string | null;
}

/**
 * Only super_admin, wfm and payroll_head may discard. Deliberately narrower than
 * useIsAdminOrHR, and it must stay in step with discardGate in discard.routes.ts — a role
 * shown the button but refused by the API gets a 403 where it expected a reversal.
 *
 * payroll_head was added with the Attendance Lookup corrections: the person fixing an
 * employee's attendance has to be able to reverse the leave or regularization that caused
 * the wrong day, and payroll owns that call org-wide.
 */
export function useCanDiscard(): { canDiscard: boolean; isLoading: boolean } {
  const { roleKeys, isLoading } = useWorkforceAccess();
  return {
    canDiscard: (roleKeys ?? []).some(
      (r: string) => r === "super_admin" || r === "wfm" || r === "payroll_head"
    ),
    isLoading,
  };
}

export function useDiscardPreview(entityType: DiscardEntityType | null, id: string | null) {
  return useQuery({
    queryKey: ["discard-preview", entityType, id],
    enabled: Boolean(entityType && id),
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<DiscardPreview> => {
      const res = await hrmsApi.get<{ success: boolean; data: DiscardPreview }>(
        `/api/discard/preview/${entityType}/${id}`
      );
      return res.data;
    },
  });
}

/**
 * Every cache a discard can invalidate.
 *
 * A discard changes three things at once — leave balance, attendance, and the
 * payroll figures derived from attendance — so anything reading any of those has
 * to be refetched. Several of these carry a 5-minute staleTime (the dashboards,
 * `attendance-monthly`, the calendar widget), so without an explicit invalidation
 * they show pre-discard numbers for minutes, not seconds.
 *
 * Keys are matched element-by-element, not by substring: `["attendance-hub"]`
 * matches nothing at all, and does not prefix-match
 * `["attendance-hub-filter-options"]`. Every entry below was checked against a
 * real `useQuery` call site.
 *
 * Not listed, deliberately: the Regularization and Disputes pages hold their rows
 * in `useState` rather than TanStack, so they cannot be invalidated — they are
 * refreshed instead through the dialog's `onDiscarded` callback.
 */
export const AFFECTED_QUERY_KEYS = [
  // ── Leave ────────────────────────────────────────────────────────────────
  ["leave-requests"],
  ["leave-balances"],
  ["leave-balance"],
  ["leave-eligibility"],
  ["team-leaves"],
  ["regularization-history"],

  // ── Attendance ───────────────────────────────────────────────────────────
  ["hub-employees"],          // Attendance Hub / Attendance Lookup table
  ["hub-today-summary"],      // Hub header counters
  ["attendance-summary"],     // Hub drawer → Attendance tab
  ["attendance-daily"],
  ["attendance-ncosec"],      // main Attendance page table
  ["attendance-my-summary"],  // Attendance page tiles (present / LWP / absent)
  ["attendance-calendar"],
  ["adr-calendar"],
  ["day-detail"],
  ["attendance-today"],
  ["attendance-monthly"],
  ["team-attendance-daily"],
  ["my-attendance-history"],
  ["emp-attendance"],

  // ── Payroll (a leave/LWP change moves earned salary) ─────────────────────
  ["running-salary"],
  ["payslip-history"],
  ["payslip-detail"],
  ["payroll-line-attendance"],
  ["payroll-attendance-control-tower"],

  // ── Dashboards ───────────────────────────────────────────────────────────
  ["dashboard-employee-summary"],
  ["dashboard-workforce-attendance"],
  ["dashboard-attendance"],
  ["dashboard-summary"],
  ["reference-dashboard-summary"],

  // ── This feature ─────────────────────────────────────────────────────────
  ["discard-history"],
  ["pending-approvals"],
];

export function useDiscardRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      entityType: DiscardEntityType;
      id: string;
      reason: string;
    }): Promise<DiscardResult> => {
      const res = await hrmsApi.post<{ success: boolean; data: DiscardResult; message: string }>(
        `/api/discard/${vars.entityType}/${vars.id}`,
        { reason: vars.reason }
      );
      return res.data;
    },
    onSuccess: () => {
      for (const key of AFFECTED_QUERY_KEYS) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useDiscardHistory(filters: {
  page?: number;
  limit?: number;
  entityType?: DiscardEntityType;
  employeeId?: string;
  fromDate?: string;
  toDate?: string;
} = {}) {
  const params = new URLSearchParams();
  params.set("page", String(filters.page ?? 1));
  params.set("limit", String(filters.limit ?? 25));
  if (filters.entityType) params.set("entityType", filters.entityType);
  if (filters.employeeId) params.set("employeeId", filters.employeeId);
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);

  return useQuery({
    queryKey: ["discard-history", filters],
    queryFn: async () => {
      return hrmsApi.get<{
        success: boolean;
        data: any[];
        meta: { total: number; page: number; limit: number };
      }>(`/api/discard/history?${params.toString()}`);
    },
  });
}
