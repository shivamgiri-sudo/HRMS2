import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { format } from "date-fns";

export interface Employee {
  id: string;
  employeeCode: string;
  name: string;
  email: string;
  phone?: string | null;
  avatar?: string;
  department: string;
  designation: string;
  joinDate: string;
  status: "active" | "inactive" | "onboarding" | "offboarded";
}

export interface EmployeeWithDetails {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  designation: string;
  hire_date: string;
  status: string;
  avatar_url: string | null;
  department: { name: string } | null;
}

export function useEmployees() {
  return useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>("/api/employees");
      return (res.data || []).map((emp: any): Employee => ({
        id: emp.id,
        employeeCode: emp.employee_code,
        name: `${emp.first_name} ${emp.last_name ?? ""}`.trim(),
        email: emp.email,
        phone: emp.mobile ?? null,
        department: emp.department_name || "Unassigned",
        designation: emp.designation_name || emp.designation || "",
        joinDate: emp.date_of_joining ? format(new Date(emp.date_of_joining), "MMM d, yyyy") : "",
        status: emp.employment_status as Employee["status"],
      }));
    },
  });
}

export function useEmployeeStats() {
  return useQuery({
    queryKey: ["employee-stats"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any }>("/api/employees/stats");
      const stats = res.data ?? {};
      return {
        total: stats.total_employees ?? 0,
        active: stats.active_employees ?? 0,
        onboarding: stats.onboarding_employees ?? 0,
      };
    },
  });
}

export function useDepartments() {
  return useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any[] }>("/api/org/departments");
      return (res.data ?? []).map((d: any) => ({
        id: d.id,
        name: d.dept_name,
        code: d.dept_code,
        description: d.description ?? "",
      }));
    },
  });
}

export function useBulkDeleteEmployees() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (employeeIds: string[]) => {
      // Deactivate in parallel via backend API
      const errors: string[] = [];

      await Promise.all(
        employeeIds.map(async (id) => {
          try {
            await hrmsApi.delete(`/api/employees/${id}`);
          } catch (err: any) {
            errors.push(`Failed to delete employee ${id}: ${err.message}`);
          }
        })
      );

      if (errors.length > 0) {
        throw new Error(errors.join("; "));
      }

      return { deletedCount: employeeIds.length };
    },
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["employee-stats"] });
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
    },
  });
}

export function useBulkUpdateEmployeeStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ employeeIds, status }: { employeeIds: string[]; status: "active" | "inactive" }) => {
      await Promise.all(
        employeeIds.map((id) => hrmsApi.patch(`/api/employees/${id}`, { employment_status: status }))
      );
      return { updatedCount: employeeIds.length, status };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["employee-stats"] });
    },
  });
}
