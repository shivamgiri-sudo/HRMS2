import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

const BASE = "/api/wfm/roster-offday-policies";
const KEY = ["wfm", "roster-offday-policies"] as const;

export type OffType = "FIXED_DAY" | "FLOATING";

export const OFF_TYPE_OPTIONS: Array<{ value: OffType; label: string }> = [
  { value: "FIXED_DAY", label: "Fixed day (same weekday every week)" },
  { value: "FLOATING", label: "Floating (N offs per week, rotated)" },
];

/** 0 = Sunday .. 6 = Saturday, the numbering the backend stores. */
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const MAX_FIXED_WEEKDAYS = 2;
export const FLOATING_OFFS_OPTIONS = [1, 2, 3, 4, 5, 6] as const;

export interface OffdayPolicyRow {
  id: string;
  process_id: string;
  process_code: string | null;
  process_name: string;
  lob_id: string | null;
  lob_code: string | null;
  lob_name: string | null;
  branch_id: string | null;
  branch_name: string | null;
  off_type: OffType;
  fixed_weekdays: number[];
  fixed_weekdays_label: string | null;
  floating_offs_per_week: number | null;
  effective_from: string;
  effective_to: string | null;
  active_status: number;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

export interface OffdayPolicyDetail {
  policy: OffdayPolicyRow;
  employees_in_scope: number;
  audit: Array<{ id: string; action_type: string; actor_user_id: string; actor_email: string | null; metadata_json: unknown; created_at: string }>;
}

export interface OffdayPolicyInput {
  process_id: string;
  lob_id: string | null;
  branch_id: string | null;
  off_type: OffType;
  fixed_weekdays: number[];
  floating_offs_per_week: number | null;
  effective_from: string;
  effective_to: string | null;
}

export interface BranchOption { id: string; branch_name: string }

const unwrap = <T,>(res: any): T => (res && typeof res === "object" && "data" in res ? res.data : res) as T;

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "" && v !== false) q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function useOffdayPolicies(f: { process_id?: string; include_inactive?: boolean; page: number; limit: number }) {
  return useQuery({
    queryKey: [...KEY, "list", f],
    queryFn: async () => unwrap<{ items: OffdayPolicyRow[]; total: number }>(await hrmsApi.get(`${BASE}${qs(f)}`)),
    placeholderData: (prev) => prev,
  });
}

export function useOffdayPolicyDetail(id: string | null) {
  return useQuery({
    queryKey: [...KEY, "detail", id],
    enabled: !!id,
    queryFn: async () => unwrap<OffdayPolicyDetail>(await hrmsApi.get(`${BASE}/${id}`)),
  });
}

export function useOffdayBranches() {
  return useQuery({
    queryKey: [...KEY, "branches"],
    queryFn: async () => unwrap<BranchOption[]>(await hrmsApi.get(`${BASE}/branches`)),
    staleTime: 5 * 60 * 1000,
  });
}

function useInvalidating<TVars, TRes>(fn: (v: TVars) => Promise<TRes>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
}

export const useCreateOffdayPolicy = () =>
  useInvalidating(async (v: OffdayPolicyInput) => unwrap<{ id: string }>(await hrmsApi.post(BASE, v)));

export const useUpdateOffdayPolicy = () =>
  useInvalidating(async (v: { id: string; body: Omit<OffdayPolicyInput, "process_id" | "lob_id" | "branch_id"> }) =>
    unwrap<{ id: string }>(await hrmsApi.put(`${BASE}/${v.id}`, v.body)));

export const useSetOffdayPolicyActive = () =>
  useInvalidating(async (v: { id: string; active: boolean }) =>
    unwrap<{ id: string; changed: boolean }>(await hrmsApi.patch(`${BASE}/${v.id}/active`, { active_status: v.active ? 1 : 0 })));
