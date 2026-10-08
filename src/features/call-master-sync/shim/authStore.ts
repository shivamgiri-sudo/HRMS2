import { useUserRole } from "@/hooks/useUserRole";

/** Mirrors the slice of Mydashboards' zustand authStore the synced dashboards read: `user.role`. */
export function useAuthStore() {
  const { data } = useUserRole();
  const roles: string[] = (data?.roleKeys as string[] | undefined) ?? [];
  const role = roles.includes("super_admin") ? "super_admin" : roles[0] ?? "";
  return { user: data ? { role } : null };
}
