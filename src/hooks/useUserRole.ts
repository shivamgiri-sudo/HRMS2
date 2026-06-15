import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";
import type { AppRole } from "@/types/roles";

export type WorkforcePageAccess = {
  page_code: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
};

export type WorkforceScope = {
  id: string;
  role_key: string;
  scope_type: string;
  branch_id: string | null;
  process_id: string | null;
  lob_id: string | null;
  department_id: string | null;
  manager_employee_id: string | null;
};

export type UserRoleData = {
  roles: AppRole[];
  roleKeys: string[];
  primaryRole: AppRole | null;
  employeeId: string | null;
  employeeCode: string | null;
  employeeName: string | null;
  scopes: WorkforceScope[];
  pages: WorkforcePageAccess[];
};

const ROLE_ALIASES: Record<string, string[]> = {
  manager: ["process_manager"],
  process_manager: ["manager"],
  tl: ["team_leader"],
  team_leader: ["tl"],
};

const unique = <T,>(values: T[]) => Array.from(new Set(values.filter(Boolean)));

function expandRoleKeys(values: string[]): string[] {
  const expanded = new Set(values.filter(Boolean));
  for (const role of values) {
    for (const alias of ROLE_ALIASES[role] ?? []) expanded.add(alias);
  }
  return Array.from(expanded);
}

const getPrimaryRole = (roles: AppRole[]): AppRole | null => {
  const expanded = expandRoleKeys(roles);
  const priority: AppRole[] = [
    "super_admin",
    "admin",
    "hr",
    "ceo",
    "branch_head",
    "process_manager",
    "manager",
    "assistant_manager",
    "wfm",
    "finance",
    "payroll",
    "qa",
    "recruiter",
    "trainer",
    "team_leader",
    "tl",
    "employee",
  ];

  return priority.find((role) => expanded.includes(role)) ?? null;
};

export const useUserRole = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["user-role-workforce-os", user?.id],
    queryFn: async (): Promise<UserRoleData | null> => {
      if (!user?.id) return null;

      const response = await hrmsApi.get<{ success: boolean; data: any }>("/api/access/me");
      const data = response.data;

      if (data) {
        const roles = unique((data.roles ?? []).map(String)) as AppRole[];
        const scopeRoleKeys = (data.scopes ?? [])
          .map((scope: WorkforceScope) => scope.role_key)
          .filter(Boolean);
        const roleKeys = expandRoleKeys([...roles, ...scopeRoleKeys, "employee"]);

        return {
          roles,
          roleKeys,
          primaryRole: getPrimaryRole(roles),
          employeeId: data.employeeId ?? data.employee?.id ?? null,
          employeeCode: data.employeeCode ?? data.employee?.employee_code ?? null,
          employeeName:
            data.employeeName ??
            (data.employee
              ? `${data.employee.first_name ?? ""} ${data.employee.last_name ?? ""}`.trim()
              : null),
          scopes: data.scopes ?? [],
          pages: data.pages ?? data.pagePerms ?? [],
        };
      }

      return {
        roles: [],
        roleKeys: [],
        primaryRole: null,
        employeeId: null,
        employeeCode: null,
        employeeName: null,
        scopes: [],
        pages: [],
      };
    },
    enabled: !!user?.id,
    retry: 2,
    staleTime: 30_000,
  });
};

export const useIsAdminOrHR = () => {
  const { data, isLoading, error } = useUserRole();
  const roleKeys = data?.roleKeys ?? [];

  return {
    isAdminOrHR: roleKeys.includes("super_admin") || roleKeys.includes("admin") || roleKeys.includes("hr"),
    isLoading,
    error,
    role: data?.primaryRole ?? null,
    roles: data?.roles ?? [],
    roleKeys,
  };
};

export const useWorkforceAccess = () => {
  const roleQuery = useUserRole();

  const access = useMemo(() => {
    const pageSet = new Set(
      (roleQuery.data?.pages ?? [])
        .filter((permission) => permission.can_view)
        .map((permission) => permission.page_code),
    );
    const roleKeys = expandRoleKeys(roleQuery.data?.roleKeys ?? []);

    return {
      canViewPage: (pageCode: string) => pageSet.has(pageCode),
      visiblePageCodes: Array.from(pageSet),
      roleKeys,
      scopes: roleQuery.data?.scopes ?? [],
      employeeId: roleQuery.data?.employeeId ?? null,
      employeeCode: roleQuery.data?.employeeCode ?? null,
      employeeName: roleQuery.data?.employeeName ?? null,
      hasAnyRole: (...roles: string[]) => expandRoleKeys(roles).some((role) => roleKeys.includes(role)),
    };
  }, [roleQuery.data]);

  return {
    ...roleQuery,
    ...access,
  };
};

export const useHasRole = (...roles: string[]) => {
  const { roleKeys } = useWorkforceAccess();
  return expandRoleKeys(roles).some((role) => roleKeys.includes(role));
};
