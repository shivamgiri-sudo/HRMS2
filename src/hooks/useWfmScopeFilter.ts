import { useMemo } from "react";
import { useWorkforceAccess, type WorkforceScope } from "./useUserRole";

export interface WfmScopeFilter {
  branchIds: string[];
  processIds: string[];
  hasAllAccess: boolean;
  isScoped: boolean;
  scopeDescription: string;
}

/**
 * Hook to extract WFM scope filters from user's assignment scopes.
 *
 * For roles like branch_head, process_manager, operations_manager:
 * - Extracts their assigned branch_id(s) and process_id(s)
 * - Returns hasAllAccess: false so the frontend can filter dropdowns
 *
 * For admin/hr/wfm/ceo roles or scope_type='all':
 * - Returns hasAllAccess: true (no filtering needed)
 */
export const useWfmScopeFilter = (): WfmScopeFilter & { isLoading: boolean } => {
  const { scopes, roleKeys, isLoading, isResolved } = useWorkforceAccess();

  return useMemo(() => {
    if (!isResolved) {
      return {
        branchIds: [],
        processIds: [],
        hasAllAccess: true,
        isScoped: false,
        scopeDescription: "Loading...",
        isLoading: true,
      };
    }

    // Admin/HR/WFM/CEO bypass scope filters entirely
    const globalRoles = ["super_admin", "admin", "hr", "wfm", "ceo"];
    if (globalRoles.some((r) => roleKeys.includes(r))) {
      return {
        branchIds: [],
        processIds: [],
        hasAllAccess: true,
        isScoped: false,
        scopeDescription: "All branches and processes",
        isLoading,
      };
    }

    // Check for scope_type='all' in any scope
    const hasAllScope = scopes.some((s: WorkforceScope) => s.scope_type === "all");
    if (hasAllScope) {
      return {
        branchIds: [],
        processIds: [],
        hasAllAccess: true,
        isScoped: false,
        scopeDescription: "All branches and processes",
        isLoading,
      };
    }

    // Extract branch IDs and process IDs from scopes
    const branchIds = Array.from(
      new Set(
        scopes
          .filter((s: WorkforceScope) => s.branch_id)
          .map((s: WorkforceScope) => s.branch_id!)
      )
    );

    const processIds = Array.from(
      new Set(
        scopes
          .filter((s: WorkforceScope) => s.process_id)
          .map((s: WorkforceScope) => s.process_id!)
      )
    );

    const isScoped = branchIds.length > 0 || processIds.length > 0;

    let scopeDescription = "No assigned scope";
    if (isScoped) {
      const parts: string[] = [];
      if (branchIds.length === 1) parts.push("1 branch");
      else if (branchIds.length > 1) parts.push(`${branchIds.length} branches`);
      if (processIds.length === 1) parts.push("1 process");
      else if (processIds.length > 1) parts.push(`${processIds.length} processes`);
      scopeDescription = parts.join(", ");
    }

    return {
      branchIds,
      processIds,
      hasAllAccess: false,
      isScoped,
      scopeDescription,
      isLoading,
    };
  }, [scopes, roleKeys, isResolved, isLoading]);
};

/**
 * Filter a list of branches/processes based on user's scope.
 * Returns all items if user has all access; otherwise filters to assigned scope.
 */
export const filterByScope = <T extends { id: string }>(
  items: T[],
  allowedIds: string[],
  hasAllAccess: boolean
): T[] => {
  if (hasAllAccess || allowedIds.length === 0) return items;
  return items.filter((item) => allowedIds.includes(item.id));
};
