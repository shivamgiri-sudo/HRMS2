import { useEmployeeProfile } from "@/hooks/useEmployeeProfile";
import { useUserRole } from "@/hooks/useUserRole";

export function useDashboardUser() {
  const { data: profile } = useEmployeeProfile();
  const { data: roleData } = useUserRole();

  const firstName = profile?.first_name ?? profile?.full_name?.split(" ")[0] ?? "User";
  const fullName = profile?.full_name ?? "User";
  const primaryRole = roleData?.roles?.[0] ?? "employee";

  const roleLabel = primaryRole
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return { firstName, fullName, primaryRole, roleLabel };
}
