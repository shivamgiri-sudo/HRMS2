import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { hrmsApi } from '@/lib/hrmsApi';

export interface RMChangeRequest {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  branch_id: string | null;
  current_manager_id: string | null;
  current_manager_name: string;
  requested_manager_id: string;
  requested_manager_name: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  created_at: string;
}

export interface ManagerSearchResult {
  id: string;
  employee_code: string;
  full_name: string;
  designation_name: string | null;
}

export function useMyRMChangeRequests() {
  return useQuery({
    queryKey: ['rm-change', 'my'],
    queryFn: () =>
      hrmsApi
        .get<{ ok: boolean; data: RMChangeRequest[] }>('/api/rm-change/my-requests')
        .then((r) => r.data),
  });
}

export function usePendingRMChangeRequests() {
  return useQuery({
    queryKey: ['rm-change', 'pending'],
    queryFn: () =>
      hrmsApi
        .get<{ ok: boolean; data: RMChangeRequest[] }>('/api/rm-change/pending')
        .then((r) => r.data),
    refetchInterval: 5 * 60_000,   // was 30s — non-critical data, no need to hammer server
  });
}

export function useManagerSearch(query: string) {
  return useQuery({
    queryKey: ['rm-change', 'search', query],
    queryFn: () =>
      hrmsApi
        .get<{ ok: boolean; data: ManagerSearchResult[] }>(
          `/api/rm-change/search-managers?q=${encodeURIComponent(query)}`
        )
        .then((r) => r.data),
    enabled: query.length >= 2,
    staleTime: 10_000,
  });
}

export function useSubmitRMChangeRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { requested_manager_id: string; reason?: string }) =>
      hrmsApi
        .post<{ ok: boolean; data: { id: string } }>('/api/rm-change', payload)
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rm-change', 'my'] });
    },
  });
}

export function useActOnRMChangeRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      requestId,
      action,
      remarks,
    }: {
      requestId: string;
      action: 'approved' | 'rejected';
      remarks?: string;
    }) => hrmsApi.post(`/api/rm-change/${requestId}/action`, { action, remarks }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rm-change', 'pending'] });
    },
  });
}
