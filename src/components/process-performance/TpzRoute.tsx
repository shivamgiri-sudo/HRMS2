import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import WorkforcePageGate from "@/components/security/WorkforcePageGate";
import { useAuth } from "@/contexts/AuthContext";
import { useTpzAccess } from "@/hooks/useTpzAccess";

/** The roles that open TPZ Process today (mirrors the route's own list on main). They keep the role list AND the PROCESS_OPERATIONS page permission. */
const TPZ_ROLES = ["super_admin", "admin", "ceo", "coo", "manager", "process_manager", "operations_manager", "branch_head", "qa", "quality_analyst", "tq_head", "hr", "team_leader", "wfm", "branch_wfm"] as const;

/**
 * Route wrapper for TPZ Process (Process Performance V2).
 *
 *  - A role-based user (or anyone the access lookup could not describe) goes through exactly the checks the route always had.
 *  - A user who is NOT role-based but holds an admin-assigned TPZ grant is let in by that grant instead. The page then shows only
 *    the processes / sections they were granted, and the API enforces the same grants on every request.
 */
export function TpzRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const { data, isLoading: tpzLoading } = useTpzAccess();

  if (isLoading || (user && tpzLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const grantOnly = Boolean(data?.hasAccess) && !data?.roleBased;
  if (grantOnly) return <ProtectedRoute entitlementVerified>{children}</ProtectedRoute>;

  return (
    <ProtectedRoute roles={TPZ_ROLES}>
      <WorkforcePageGate pageCode="PROCESS_OPERATIONS">{children}</WorkforcePageGate>
    </ProtectedRoute>
  );
}
