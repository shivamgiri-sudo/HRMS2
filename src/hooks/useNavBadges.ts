import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";

const BADGE_ROLES = new Set([
  "wfm",
  "process_manager",
  "branch_head",
  "payroll_branch",
  "super_admin",
  "admin",
]);

interface PendingCountResponse {
  success: boolean;
  count: number;
  processes: Array<{
    branch_id: string;
    process_id: string;
    branch_name: string;
    process_name: string;
    readiness_score: number;
    readiness_status: string;
  }>;
}

/**
 * Returns a Map<href, badge-count> for sidebar nav items that need a count badge.
 * Only fetches when the user holds a role that has payroll-prep visibility.
 */
export function useNavBadges(): Map<string, number> {
  const { roleKeys } = useWorkforceAccess();
  const eligible = roleKeys.some((r) => BADGE_ROLES.has(r));

  const { data } = useQuery<PendingCountResponse>({
    queryKey: ["nav-badges", "payroll-prep-pending"],
    queryFn: () => hrmsApi.get<PendingCountResponse>("/api/payroll/process-readiness/my-pending-count"),
    enabled: eligible,
    staleTime: 5 * 60 * 1000,   // 5 min — badge updates are not latency-sensitive
    refetchInterval: 10 * 60 * 1000, // refetch every 10 min
    refetchOnWindowFocus: true,
  });

  const badges = new Map<string, number>();
  if (data?.count && data.count > 0) {
    badges.set("/payroll/process-readiness", data.count);
  }
  return badges;
}
