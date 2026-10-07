import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

/** GET /api/finance/grns/branch-split/options — Head Office GRN split across branches. */
export interface BranchSplitBranch {
  branchId: string;
  branchName: string;
  isHeadOffice: boolean;
  /** ok = exactly one Back Office cost centre; none / ambiguous = this branch cannot receive a share yet. */
  status: "ok" | "none" | "ambiguous";
  resolved: { id: string; code: string; name: string | null } | null;
  candidates: Array<{ id: string; code: string; name: string | null }>;
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
