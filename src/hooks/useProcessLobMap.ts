import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

const BASE = "/api/wfm/process-lobs";
const KEY = ["wfm", "process-lobs"] as const;

export interface MappedLob {
  map_id: string;
  lob_id: string;
  lob_code: string;
  lob_name: string;
  active_status: number;
}

export interface ProcessRow {
  id: string;
  process_code: string | null;
  process_name: string;
  branch_id: string | null;
  branch_name: string | null;
  lobs: MappedLob[];
}

export interface LobOption {
  id: string;
  lob_code: string;
  lob_name: string;
}

export interface MappingDetail {
  mapping: {
    id: string; process_id: string; process_code: string | null; process_name: string;
    branch_id: string | null; branch_name: string | null; lob_id: string; lob_code: string; lob_name: string;
    lob_active: number; active_status: number; created_by: string | null; created_at: string;
    updated_by: string | null; updated_at: string;
  };
  employees_with_lob: number;
  audit: Array<{ id: string; action_type: string; actor_user_id: string; actor_email: string | null; metadata_json: unknown; created_at: string }>;
}

export interface WithoutLobSummaryRow {
  process_id: string;
  process_code: string | null;
  process_name: string;
  branch_id: string | null;
  branch_name: string | null;
  employees_without_lob: number;
  lobs: MappedLob[];
}

export interface EmployeeWithoutLob {
  id: string;
  employee_code: string;
  full_name: string;
  process_id: string;
  process_name: string;
  branch_name: string | null;
}

export interface BulkLobResult {
  process_id: string;
  lob_id: string;
  requested: number;
  updated: number;
  skipped: number;
  remaining: number;
}

const unwrap = <T,>(res: any): T => (res && typeof res === "object" && "data" in res ? res.data : res) as T;

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function useManageableProcesses(f: { branch_id?: string; search?: string; only_unmapped?: boolean; page: number; limit: number }) {
  return useQuery({
    queryKey: [...KEY, "processes", f],
    queryFn: async () => unwrap<{ items: ProcessRow[]; total: number }>(await hrmsApi.get(`${BASE}/processes${qs(f)}`)),
    placeholderData: (prev) => prev,
  });
}

export function useActiveLobs() {
  return useQuery({
    queryKey: [...KEY, "lobs"],
    queryFn: async () => unwrap<LobOption[]>(await hrmsApi.get(`${BASE}/lobs`)),
  });
}

export function useMappingDetail(id: string | null) {
  return useQuery({
    queryKey: [...KEY, "detail", id],
    enabled: !!id,
    queryFn: async () => unwrap<MappingDetail>(await hrmsApi.get(`${BASE}/${id}`)),
  });
}

/** LOBs mapped to a process; used by the WFM alignment form where the process is being chosen. */
export function useProcessLobOptions(processId: string) {
  const id = processId.trim();
  return useQuery({
    queryKey: [...KEY, "process-options", id],
    enabled: id.length > 0,
    retry: false,
    queryFn: async () =>
      unwrap<{ process_id: string; process_name: string; options: MappedLob[] }>(await hrmsApi.get(`${BASE}/processes/${encodeURIComponent(id)}/lob-options`)),
  });
}

export function useWithoutLobSummary(branchId?: string) {
  return useQuery({
    queryKey: [...KEY, "without-summary", branchId ?? ""],
    queryFn: async () => unwrap<WithoutLobSummaryRow[]>(await hrmsApi.get(`${BASE}/employees-without-lob/summary${qs({ branch_id: branchId })}`)),
  });
}

export function useEmployeesWithoutLob(f: { process_id?: string; search?: string; page: number; limit: number }) {
  return useQuery({
    queryKey: [...KEY, "without-list", f],
    enabled: !!f.process_id,
    queryFn: async () => unwrap<{ items: EmployeeWithoutLob[]; total: number }>(await hrmsApi.get(`${BASE}/employees-without-lob${qs(f)}`)),
    placeholderData: (prev) => prev,
  });
}

function useInvalidating<TVars, TRes>(fn: (v: TVars) => Promise<TRes>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
}

export const useAddMapping = () =>
  useInvalidating(async (v: { process_id: string; lob_id: string }) => unwrap<{ id: string; reactivated: boolean }>(await hrmsApi.post(BASE, v)));

export const useSetMappingActive = () =>
  useInvalidating(async (v: { id: string; active: boolean }) => unwrap(await hrmsApi.put(`${BASE}/${v.id}`, { active_status: v.active ? 1 : 0 })));

export const useCreateLob = () =>
  useInvalidating(async (v: { lob_name: string; lob_code?: string }) => unwrap<LobOption>(await hrmsApi.post(`${BASE}/lobs`, v)));

export const useBulkAssignLob = () =>
  useInvalidating(async (v: { process_id: string; lob_id: string; employee_ids?: string[] }) =>
    unwrap<BulkLobResult>(await hrmsApi.post(`${BASE}/employees/bulk-lob`, v)));
