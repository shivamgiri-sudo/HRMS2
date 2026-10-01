import { useQueries } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { normalizeConflict, normalizeDispute, normalizeSwap, normalizeWeekoff, sortRequests } from "./normalize";
import type { RosterRequest } from "./types";

const qs = (lobId?: string) => (lobId ? `?lobId=${encodeURIComponent(lobId)}` : "");

export function useRosterRequests(lobId?: string) {
  const results = useQueries({
    queries: [
      { queryKey: ["rr", "swaps", lobId], queryFn: async () => (await hrmsApi.get<{ data: any[] }>(`/api/wfm-ext/roster/swaps?status=pending${lobId ? `&lobId=${encodeURIComponent(lobId)}` : ""}`)).data ?? [] },
      { queryKey: ["rr", "conflicts", lobId], queryFn: async () => (await hrmsApi.get<{ data: any[] }>(`/api/wfm-ext/roster/conflicts?resolved=false${lobId ? `&lobId=${encodeURIComponent(lobId)}` : ""}`)).data ?? [] },
      { queryKey: ["rr", "weekoff", lobId], queryFn: async () => (await hrmsApi.get<{ data: any[] }>(`/api/wfm/manager/weekoff-review${qs(lobId)}`)).data ?? [] },
      { queryKey: ["rr", "disputes", lobId], queryFn: async () => (await hrmsApi.get<{ data: any[] }>(`/api/roster-gov/manager-review-queue${qs(lobId)}`)).data ?? [] },
    ],
  });
  const [swaps, conflicts, weekoff, disputes] = results;
  const now = new Date();
  const requests: RosterRequest[] = sortRequests([
    ...(swaps.data ?? []).map((s) => normalizeSwap(s, now)),
    ...(conflicts.data ?? []).map((c) => normalizeConflict(c, now)),
    ...(weekoff.data ?? []).map((w) => normalizeWeekoff(w, now)),
    ...(disputes.data ?? []).map((d) => normalizeDispute(d, now)),
  ]);
  return {
    requests,
    isLoading: results.some((r) => r.isLoading),
    errors: [
      swaps.isError && "swaps", conflicts.isError && "conflicts", weekoff.isError && "week-off requests", disputes.isError && "disputes",
    ].filter(Boolean) as string[],
    refetch: () => results.forEach((r) => r.refetch()),
  };
}
