import { useEffect, useRef } from "react";
import { Navigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useEmployeeStatus } from "@/hooks/useEmployeeStatus";
import { useIsAdminOrHR, useWorkforceAccess } from "@/hooks/useUserRole";
import { Loader2, ShieldX, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getHrmsApiErrorStatus } from "@/lib/hrmsApi";
import {
  canAccessDashboard,
  type DashboardCode,
} from "../../../backend/src/shared/dashboardAccessRegistry";
import { getRoutePageCode } from "@/lib/pageRoutePageCodes";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** When provided, the user must have at least one of these role keys. */
  roles?: string[];
  /** Canonical role-dashboard entitlement. Takes precedence over a local role list. */
  dashboardCode?: DashboardCode;
}

export function ProtectedRoute({ children, roles, dashboardCode }: ProtectedRouteProps) {
  const { user, isLoading, mustChangePassword, twoFactorRequired, twoFactorVerified } = useAuth();
  const location = useLocation();
  const { data: employeeStatus, isLoading: isEmployeeLoading } = useEmployeeStatus();
  const { isAdminOrHR, isLoading: isRoleLoading, error: roleError, roleKeys, isResolved: isRoleResolved } = useIsAdminOrHR();
  const { isLoading: isAccessLoading, isError: isAccessError, error: accessError, canViewPage, isResolved: isAccessResolved } = useWorkforceAccess();
  const isEmployee = employeeStatus?.isEmployee ?? false;
  const routePageCode = dashboardCode ? undefined : getRoutePageCode(location.pathname);
  const hasRoutePageAccess = routePageCode ? canViewPage(routePageCode) : false;
  // A 401 on these background queries means the access token expired mid-session.
  // Do NOT call signOut() here — that destroys the refresh cookie.
  // Simply redirect to /auth; the login page will attempt a silent cookie-based
  // refresh and restore the session without requiring the user to re-enter credentials.
  const authFailure =
    getHrmsApiErrorStatus(roleError) === 401 ||
    getHrmsApiErrorStatus(accessError) === 401;
  const hasTriggeredSignOutRef = useRef(false);

  useEffect(() => {
    if (!authFailure || hasTriggeredSignOutRef.current) return;
    hasTriggeredSignOutRef.current = true;
    // Only clear the stale access token; leave the refresh cookie intact
    localStorage.removeItem('hrms_access_token');
  }, [authFailure]);

  if (isLoading || isEmployeeLoading || isRoleLoading || isAccessLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (authFailure) {
    return <Navigate to="/auth" replace state={{ from: location }} />;
  }

  if (roleError || isAccessError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-yellow-100">
              <AlertTriangle className="h-8 w-8 text-yellow-600" />
            </div>
            <CardTitle>Unable to load page</CardTitle>
            <CardDescription>
              There was a problem verifying your access. Please refresh the page or try again.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-2">
            <Button onClick={() => window.location.reload()}>Refresh</Button>
            <Button variant="outline" asChild>
              <Link to="/dashboard">Go to Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (mustChangePassword && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  if (!mustChangePassword && twoFactorRequired && !twoFactorVerified && location.pathname !== "/two-factor") {
    return <Navigate to="/two-factor" replace />;
  }

  // Every check below denies on an empty role list or a false canViewPage, and both are
  // the default state before the role query resolves. That query is `enabled: !!user?.id`,
  // and React Query v5 computes isLoading as `isPending && isFetching` — so a disabled
  // query, and the first render after it is enabled but before the fetch effect runs,
  // reports isLoading === false with data still undefined. The loading gate above
  // therefore lets that render through, roleKeys is [], and the user is shown
  // "Access Denied" for a frame before their real roles arrive. That is the flash the
  // CEO UAT reported on /ceo/dashboard.
  //
  // Placed after the !user redirect on purpose: a signed-out user must still be sent to
  // /auth rather than held on a spinner the query will never resolve.
  if (!isRoleResolved || !isAccessResolved) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Dashboard routes stay tied to their dashboard entitlement.
  if (dashboardCode) {
    const hasRequiredRole = canAccessDashboard(dashboardCode, roleKeys);
    if (!hasRequiredRole) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
          <Card className="max-w-md w-full">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                <ShieldX className="h-8 w-8 text-destructive" />
              </div>
              <CardTitle>Access Denied</CardTitle>
              <CardDescription>
                You don't have permission to access this dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <Button asChild>
                <Link to="/dashboard">Go to Dashboard</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }
  }

  // For page-mapped routes, page access is the source of truth.
  // Local role lists remain only as a fallback for pages that are not yet mapped.
  if (!routePageCode && roles && roles.length > 0) {
    const hasRequiredRole = dashboardCode
      ? canAccessDashboard(dashboardCode, roleKeys)
      : roleKeys.includes("super_admin") || roles.some((r) => roleKeys.includes(r));
    if (!hasRequiredRole) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
          <Card className="max-w-md w-full">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                <ShieldX className="h-8 w-8 text-destructive" />
              </div>
              <CardTitle>Access Denied</CardTitle>
              <CardDescription>
                You don't have permission to access this page. This area is restricted to administrators.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <Button asChild>
                <Link to="/dashboard">Go to Dashboard</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }
  }

  if (routePageCode && !hasRoutePageAccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <ShieldX className="h-8 w-8 text-destructive" />
            </div>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You don't have page access for this HRMS area.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button asChild>
              <Link to="/dashboard">Go to Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Allow access to dashboard for everyone (non-employees see onboarding request form there)
  const isDashboard = location.pathname === "/dashboard";
  const isChangePassword = location.pathname === "/change-password";
  const isTwoFactor = location.pathname === "/two-factor";

  // Non-employees who are not admin/HR can only access dashboard, change-password, or two-factor
  if (!isEmployee && !isAdminOrHR && !isDashboard && !isChangePassword && !isTwoFactor) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <ShieldX className="h-8 w-8 text-destructive" />
            </div>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You don't have access to this module. Please complete your onboarding request first.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button asChild>
              <Link to="/dashboard">Go to Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
