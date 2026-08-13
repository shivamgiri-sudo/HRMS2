import { useEmployeeProfile } from "@/hooks/useEmployeeProfile";
import { useUserRole } from "@/hooks/useUserRole";

export function useDashboardUser() {
  const { data: profile } = useEmployeeProfile();
  const { data: roleData } = useUserRole();

  const firstName = profile?.first_name ?? profile?.full_name?.split(" ")[0] ?? "User";
  const fullName = profile?.full_name ?? "User";
  // Use the same priority-ranked primary role useUserRole() already computes
  // (getPrimaryRole) instead of roles[0] — the backend's roles array isn't
  // guaranteed to be priority-ordered, so roles[0] previously picked whichever
  // role happened to come back first from the API, which could disagree with
  // every other primary-role decision in the app (dashboard variant, route
  // access) for a user holding more than one role. (2026-08-13 auth audit)
  const primaryRole = roleData?.primaryRole ?? "employee";

  const roleLabel = primaryRole
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return { firstName, fullName, primaryRole, roleLabel };
}
