import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

interface Branch {
  id: string;
  name?: string;
  branch_name?: string;
  branch_code?: string;
  city?: string;
  active_status?: number;
}

interface Process {
  id: string;
  name?: string;
  process_name?: string;
  process_code?: string;
  branch_id?: string;
  client_id?: string;
  active_status?: number;
}

interface Designation {
  id: string;
  name?: string;
  designation_name?: string;
  designation_code?: string;
  level?: number;
  active_status?: number;
}

interface Client {
  id: string;
  client_code: string;
  client_name: string;
  active_status?: boolean | number;
}

interface LOB {
  id: string;
  lob_code: string;
  lob_name: string;
  active_status?: number;
}

interface CostCentreMigrationStatus {
  total: number;
  orphaned: number;
  migrationComplete: boolean;
  message: string;
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

export function useClients() {
  return useQuery({
    queryKey: ["org", "clients"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: Client[] } | Client[]>("/api/clients");
      const list = Array.isArray(res) ? res : (res.data ?? []);
      return list.filter((c: Client) => c.active_status !== false && c.active_status !== 0);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useLOBs() {
  return useQuery({
    queryKey: ["org", "lobs"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: LOB[] } | LOB[]>("/api/org/lobs");
      const list = Array.isArray(res) ? res : (res.data ?? []);
      return list.filter((l: LOB) => l.active_status !== 0);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useCostCentreMigrationStatus() {
  return useQuery({
    queryKey: ["org", "cost-centres", "migration-status"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: CostCentreMigrationStatus }>("/api/org/cost-centres/migration-status");
      return res.data;
    },
    staleTime: 30 * 1000, // Refresh every 30 seconds
  });
}
