import { Navigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useEmployeeStatus } from "@/hooks/useEmployeeStatus";
import { useIsAdminOrHR, useWorkforceAccess } from "@/hooks/useUserRole";
import { Loader2, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** When provided, the user must have at least one of these role keys. */
  roles?: string[];
}

export function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const { user, isLoading, mustChangePassword, twoFactorRequired, twoFactorVerified } = useAuth();
  const location = useLocation();
  const { data: employeeStatus, isLoading: isEmployeeLoading } = useEmployeeStatus();
  const { isAdminOrHR, isLoading: isRoleLoading, roleKeys } = useIsAdminOrHR();
  const { isLoading: isAccessLoading } = useWorkforceAccess();
  const isEmployee = employeeStatus?.isEmployee ?? false;

  if (isLoading || isEmployeeLoading || isRoleLoading || isAccessLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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

  // Role-restricted route: user must have one of the required roles
  if (roles && roles.length > 0) {
    const hasRequiredRole = roleKeys.includes("super_admin") || roles.some((r) => roleKeys.includes(r));
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

  // Allow access to dashboard for everyone (non-employees see onboarding request form there)
  const isDashboard = location.pathname === "/dashboard";

  // Non-employees who are not admin/HR can only access dashboard
  if (!isEmployee && !isAdminOrHR && !isDashboard) {
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
