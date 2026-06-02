import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";
import { Database } from "@/integrations/supabase/types";
import { DEMO_CREDENTIALS } from "@/lib/demoCreds";

type AppRole = Database["public"]["Enums"]["app_role"];

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

const getPrimaryRole = (roles: AppRole[]): AppRole | null => {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("hr")) return "hr";
  if (roles.includes("manager")) return "manager";
  if (roles.includes("employee")) return "employee";
  return null;
};

const unique = <T,>(values: T[]) => Array.from(new Set(values.filter(Boolean)));

export const useUserRole = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["user-role-workforce-os", user?.id],
    queryFn: async (): Promise<UserRoleData | null> => {
      if (!user?.id) return null;

      // Local demo mode bypass — per-role
      const demoCred = DEMO_CREDENTIALS.find(c => c.userId === user.id);
      if (demoCred) {
        return {
          roles: [demoCred.role as AppRole],
          roleKeys: [demoCred.role, "employee"],
          primaryRole: demoCred.role as AppRole,
          employeeId: demoCred.employeeId,
          employeeCode: demoCred.employeeCode,
          employeeName: demoCred.fullName,
          scopes: [],
          pages: demoCred.pages.map(code => ({
            page_code: code,
            can_view: true,
            can_create: true,
            can_edit: true,
            can_delete: true,
            can_export: true,
          })),
        };
      }

      // MySQL backend path — if hrms_access_token present, use /api/access/me
      if (localStorage.getItem('hrms_access_token')) {
        const res = await hrmsApi.get<{ success: boolean; data: any }>('/access/me');
        const d = (res as any).data;
        if (d) {
          const roles = (d.roles ?? []) as AppRole[];
          const scopeRoleKeys: string[] = (d.scopes ?? []).map((s: any) => s.role_key as string).filter(Boolean);
          const roleKeys = Array.from(new Set([...roles.map(String), ...scopeRoleKeys, 'employee']));
          return {
            roles,
            roleKeys,
            primaryRole: getPrimaryRole(roles),
            employeeId: d.employee?.id ?? null,
            employeeCode: d.employee?.employee_code ?? null,
            employeeName: d.employee ? `${d.employee.first_name ?? ''} ${d.employee.last_name ?? ''}`.trim() : null,
            scopes: d.scopes ?? [],
            pages: d.pagePerms ?? [],
          };
        }
      }

      const [{ data: roleRows, error: roleError }, { data: employeeRows, error: employeeError }, { data: scopeRows, error: scopeError }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user.id),
        supabase
          .from("employees")
          .select("id, employee_code, first_name, last_name")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("user_assignment_scope")
          .select("id, role_key, scope_type, branch_id, process_id, lob_id, department_id, manager_employee_id")
          .eq("user_id", user.id)
          .eq("active_status", true),
      ]);

      if (roleError) throw roleError;
      if (employeeError) throw employeeError;
      if (scopeError) throw scopeError;

      const roles = unique((roleRows ?? []).map((r) => r.role as AppRole));
      const scopeRoleKeys = unique((scopeRows ?? []).map((s: any) => s.role_key as string));
      const roleKeys = unique<string>([...roles.map(String), ...scopeRoleKeys, "employee"]);

      const { data: accessRows, error: accessError } = await supabase
        .from("role_page_access")
        .select("page_code, can_view, can_create, can_edit, can_delete, can_export")
        .in("role_key", roleKeys)
        .eq("active_status", true);

      if (accessError) throw accessError;

      const accessMap = new Map<string, WorkforcePageAccess>();
      (accessRows ?? []).forEach((row: any) => {
        const existing = accessMap.get(row.page_code);
        accessMap.set(row.page_code, {
          page_code: row.page_code,
          can_view: Boolean(existing?.can_view || row.can_view),
          can_create: Boolean(existing?.can_create || row.can_create),
          can_edit: Boolean(existing?.can_edit || row.can_edit),
          can_delete: Boolean(existing?.can_delete || row.can_delete),
          can_export: Boolean(existing?.can_export || row.can_export),
        });
      });

      const employee = employeeRows as any;
      return {
        roles,
        roleKeys,
        primaryRole: getPrimaryRole(roles),
        employeeId: employee?.id ?? null,
        employeeCode: employee?.employee_code ?? null,
        employeeName: employee ? `${employee.first_name ?? ""} ${employee.last_name ?? ""}`.trim() : null,
        scopes: (scopeRows ?? []) as WorkforceScope[],
        pages: Array.from(accessMap.values()),
      };
    },
    enabled: !!user?.id,
    retry: 2,
    staleTime: 30_000,
  });
};

export const useIsAdminOrHR = () => {
  const { data, isLoading, error } = useUserRole();
  const roles = data?.roles ?? [];

  return {
    isAdminOrHR: roles.includes("admin") || roles.includes("hr"),
    isLoading,
    error,
    role: data?.primaryRole ?? null,
    roles,
    roleKeys: data?.roleKeys ?? [],
  };
};

export const useWorkforceAccess = () => {
  const roleQuery = useUserRole();

  const access = useMemo(() => {
    const pageSet = new Set((roleQuery.data?.pages ?? []).filter((p) => p.can_view).map((p) => p.page_code));
    return {
      canViewPage: (pageCode: string) => pageSet.has(pageCode),
      visiblePageCodes: Array.from(pageSet),
      roleKeys: roleQuery.data?.roleKeys ?? [],
      scopes: roleQuery.data?.scopes ?? [],
      employeeId: roleQuery.data?.employeeId ?? null,
      employeeCode: roleQuery.data?.employeeCode ?? null,
      employeeName: roleQuery.data?.employeeName ?? null,
    };
  }, [roleQuery.data]);

  return {
    ...roleQuery,
    ...access,
  };
};
