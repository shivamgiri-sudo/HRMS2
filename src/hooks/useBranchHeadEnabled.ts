import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

/** Asks the backend whether this caller passes flag + role + pilot. Any error or non-200 means not enabled. */
export async function fetchBranchHeadEnabled(): Promise<boolean> {
  try {
    const res = await hrmsApi.get<{ success?: boolean; data?: { enabled?: boolean } }>("/api/branch-head-health/enabled");
    return res?.success === true && res.data?.enabled === true;
  } catch {
    return false;
  }
}

/** `enabled` must be false for flag-off builds / callers who cannot resolve the variant: no request is made then. */
export function useBranchHeadEnabled(opts: { enabled: boolean }): { enabled: boolean; isLoading: boolean } {
  const q = useQuery({
    queryKey: ["branch-head-health-enabled"],
    queryFn: fetchBranchHeadEnabled,
    enabled: opts.enabled,
    retry: false,
    staleTime: 5 * 60_000,
  });
  return { enabled: opts.enabled && q.data === true, isLoading: opts.enabled && q.isLoading };
}
