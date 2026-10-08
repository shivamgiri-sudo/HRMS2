import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

/** GET /api/finance/grns/branch-split/options — Head Office GRN split across branches. */
export interface BranchSplitDrivers {
  plannedHeadcount: number;
  revenueRatePerHead: number;
  seatCount: number;
  floorAreaSqft: number;
  deviceCount: number;
  hiringVolume: number;
}

export interface BranchSplitBranch {
  branchId: string;
  branchName: string;
  isHeadOffice: boolean;
  /** ok = exactly one Back Office cost centre; none / ambiguous = this branch cannot receive a share yet. */
  status: "ok" | "none" | "ambiguous";
  resolved: { id: string; code: string; name: string | null } | null;
  candidates: Array<{ id: string; code: string; name: string | null }>;
  /** Present on the preview (head + month given): the branch's own budget for this head/sub-head. */
  coverage?: { headerActive: boolean; hasAnyLine: boolean; aggregateAvailable: number } | null;
  /** Present on the preview: drivers summed over the branch's cost centres (weightFor applies). */
  drivers?: BranchSplitDrivers | null;
}

export interface BranchSplitOptions {
  enabled: boolean;
  branches: BranchSplitBranch[];
}

/** Only the Finance Head / super admin can raise one, so only they fetch it. */
export function useBranchSplitOptions(enabled: boolean) {
  return useQuery({
    queryKey: ["grn-branch-split-options"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      (await hrmsApi.get<{ success: boolean; data: BranchSplitOptions }>("/api/finance/grns/branch-split/options")).data,
  });
}

/** The same list with each branch's budget headroom and drivers for one head/sub-head and month. */
export function useBranchSplitPreview(params: { period: string; head: string; subHead: string }, enabled: boolean) {
  const { period, head, subHead } = params;
  return useQuery({
    queryKey: ["grn-branch-split-preview", period, head, subHead],
    enabled: enabled && Boolean(period && head),
    staleTime: 60_000,
    queryFn: async () =>
      (await hrmsApi.get<{ success: boolean; data: BranchSplitOptions }>(
        `/api/finance/grns/branch-split/options?period=${encodeURIComponent(period)}&head=${encodeURIComponent(head)}&subHead=${encodeURIComponent(subHead)}`,
      )).data,
  });
}
