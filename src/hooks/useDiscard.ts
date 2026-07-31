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

/** Only super_admin and wfm may discard. Deliberately narrower than useIsAdminOrHR. */
export function useCanDiscard(): { canDiscard: boolean; isLoading: boolean } {
  const { roleKeys, isLoading } = useWorkforceAccess();
  return {
    canDiscard: (roleKeys ?? []).some((r: string) => r === "super_admin" || r === "wfm"),
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

/** Every cache a discard can invalidate — balances, lists, counters, history. */
const AFFECTED_QUERY_KEYS = [
  ["leave-requests"],
  ["leave-stats"],
  ["leave-balances"],
  ["leave-balance"],
  ["leave-eligibility"],
  ["team-leaves"],
  ["regularizations"],
  ["regularization-history"],
  ["attendance-disputes"],
  ["attendance-hub"],
  ["attendance-daily"],
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
