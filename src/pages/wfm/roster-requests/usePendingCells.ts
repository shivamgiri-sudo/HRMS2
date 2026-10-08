import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { indexPendingCells, type PendingCell, type PendingRef } from "./pendingCells";

const EMPTY: PendingCell[] = [];

/**
 * One request per visible date range (not per cell). Any failure degrades to an empty list so the
 * roster grid never breaks because the badges could not load.
 */
export function usePendingCells(p: { from?: string; to?: string; processId?: string; branchId?: string; enabled?: boolean }): Map<string, PendingRef[]> {
  const { from, to, processId, branchId, enabled = true } = p;
  const q = useQuery({
    queryKey: ["rr", "pending-cells", from, to, processId, branchId],
    enabled: enabled && !!from && !!to,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<PendingCell[]> => {
      try {
        const params = new URLSearchParams({ from: from as string, to: to as string });
        if (processId) params.set("processId", processId);
        if (branchId) params.set("branchId", branchId);
        const res = await hrmsApi.get<{ data?: PendingCell[] }>(`/api/roster-requests/pending-cells?${params}`);
        return Array.isArray(res?.data) ? res.data : EMPTY;
      } catch {
        return EMPTY;
      }
    },
  });
  return useMemo(() => indexPendingCells(q.data ?? EMPTY), [q.data]);
}
