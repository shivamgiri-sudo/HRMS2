import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export interface Department {
  id: string;
  name: string;
  description: string | null;
  manager_id: string | null;
  manager_name: string | null;
  created_at: string;
  updated_at: string;
  employee_count: number;
}

export function useDepartments() {
  return useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: Array<{ id: string; dept_name: string; dept_code: string; description?: string | null; manager_id?: string | null; manager_name?: string | null; created_at?: string; updated_at?: string; employee_count?: number }> }>("/api/org/departments");
      return (res.data ?? []).map((d) => ({
        id: d.id,
        name: d.dept_name,
        code: d.dept_code,
        description: d.description ?? null,
        manager_id: d.manager_id ?? null,
        manager_name: d.manager_name ?? null,
        created_at: d.created_at ?? "",
        updated_at: d.updated_at ?? "",
        employee_count: d.employee_count ?? 0,
      })) as Department[];
    },
  });
}

export function useCreateDepartment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (department: { name: string; description?: string; manager_id?: string | null }) => {
      return hrmsApi.post("/api/org/departments", department);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["departments"] });
    },
  });
}

export function useUpdateDepartment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...department }: { id: string; name: string; description?: string; manager_id?: string | null }) => {
      return hrmsApi.put(`/api/org/departments/${id}`, department);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["departments"] });
    },
  });
}

export function useDeleteDepartment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return hrmsApi.delete(`/api/org/departments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["departments"] });
    },
  });
}
