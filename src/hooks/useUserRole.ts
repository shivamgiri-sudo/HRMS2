import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";
import type { AppRole } from "@/types/roles";
import { resolveActiveDemoCredential } from "@/lib/demoCreds";

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
  disabledPageCodes: string[];
};

const DEMO_LOGIN_ENABLED = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO_LOGIN === "true";

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

      const demoCredential = resolveActiveDemoCredential(user, DEMO_LOGIN_ENABLED);
      if (demoCredential) {
        const roles = [demoCredential.role] as AppRole[];
        const roleKeys = expandRoleKeys([...roles, "employee"]);

        return {
          roles,
          roleKeys,
          primaryRole: getPrimaryRole(roles),
          employeeId: demoCredential.employeeId,
          employeeCode: demoCredential.employeeCode,
          employeeName: demoCredential.fullName,
          scopes: [],
          pages: demoCredential.pages.map((pageCode) => ({
            page_code: pageCode,
            can_view: true,
            can_create: false,
            can_edit: false,
            can_delete: false,
            can_export: false,
          })),
          disabledPageCodes: [],
        };
      }

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
          disabledPageCodes: (data.disabledPageCodes ?? []).map(String),
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
        disabledPageCodes: [],
      };
    },
    enabled: !!user?.id,
    retry: 1,
    retryDelay: 1000,
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

export const useCanAccessPayroll = () => {
  const { data, isLoading, error } = useUserRole();
  const roleKeys = data?.roleKeys ?? [];

  return {
    canAccessPayroll: roleKeys.includes("admin") || roleKeys.includes("hr") || roleKeys.includes("finance") || roleKeys.includes("payroll"),
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
    const disabledPageSet = new Set(roleQuery.data?.disabledPageCodes ?? []);

    const isSuperAdmin = roleKeys.includes("super_admin");

    return {
      canViewPage: (pageCode: string) => isSuperAdmin || (!disabledPageSet.has(pageCode) && pageSet.has(pageCode)),
      visiblePageCodes: isSuperAdmin
        ? Array.from(pageSet)
        : Array.from(pageSet).filter((pageCode) => !disabledPageSet.has(pageCode)),
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

export const useCanSearchEmployees = () => {
  const { data, isLoading, error } = useUserRole();
  const roleKeys = data?.roleKeys ?? [];

  return {
    canSearchEmployees:
      roleKeys.includes("super_admin") ||
      roleKeys.includes("admin") ||
      roleKeys.includes("hr") ||
      roleKeys.includes("payroll_head") ||
      roleKeys.includes("payroll") ||
      roleKeys.includes("manager") ||
      roleKeys.includes("process_manager") ||
      roleKeys.includes("ceo") ||
      roleKeys.includes("branch_head"),
    isLoading,
    error,
    role: data?.primaryRole ?? null,
    roles: data?.roles ?? [],
    roleKeys,
  };
};
