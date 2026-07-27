import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

interface Branch {
  id: string;
  name: string;
  branch_code?: string;
  city?: string;
  active_status?: number;
}

interface Process {
  id: string;
  name: string;
  process_code?: string;
  branch_id?: string;
  active_status?: number;
}

interface Designation {
  id: string;
  name: string;
  designation_code?: string;
  level?: number;
  active_status?: number;
}

export function useBranches() {
  return useQuery({
    queryKey: ["org", "branches"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: Branch[] } | Branch[]>("/api/org/branches");
      const list = Array.isArray(res) ? res : (res.data ?? []);
      return list.filter((b: Branch) => b.active_status !== 0);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useProcesses(branchId?: string) {
  return useQuery({
    queryKey: ["org", "processes", branchId],
    queryFn: async () => {
      const url = branchId
        ? `/api/org/processes?branch_id=${branchId}`
        : "/api/org/processes";
      const res = await hrmsApi.get<{ data: Process[] } | Process[]>(url);
      const list = Array.isArray(res) ? res : (res.data ?? []);
      return list.filter((p: Process) => p.active_status !== 0);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useDesignations() {
  return useQuery({
    queryKey: ["org", "designations"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: Designation[] } | Designation[]>("/api/org/designations");
      const list = Array.isArray(res) ? res : (res.data ?? []);
      return list.filter((d: Designation) => d.active_status !== 0);
    },
    staleTime: 5 * 60 * 1000,
  });
}
