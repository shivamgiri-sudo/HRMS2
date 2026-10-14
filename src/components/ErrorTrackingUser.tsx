import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { setErrorTrackingUser } from "@/lib/errorTracking";

/**
 * Tags error reports with the signed-in user's internal id and primary role, so an error can be
 * grouped by role ("every TL gets this") without sending a name or email. Renders nothing and does
 * nothing when error tracking is off.
 */
export function ErrorTrackingUser() {
  const { user } = useAuth();
  const { data: roleData } = useUserRole();
  const role = roleData?.primaryRole ?? null;
  useEffect(() => {
    setErrorTrackingUser(user?.id ? { id: user.id, role } : null);
  }, [user?.id, role]);
  return null;
}
