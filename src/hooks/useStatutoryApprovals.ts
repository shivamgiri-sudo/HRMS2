import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { hrmsApi } from '@/lib/hrmsApi';

export interface StatutoryChangeRequest {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  branch_name: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected';
  requested_at: string;
}

export function usePendingStatutoryChangeRequests() {
  return useQuery({
    queryKey: ['statutory-change-requests', 'pending'],
    queryFn: () =>
      hrmsApi
        .get<{ success: boolean; data: StatutoryChangeRequest[] }>('/api/statutory-change-requests/pending')
        .then((r) => r.data),
    refetchInterval: 5 * 60_000,
  });
}

export function useActOnStatutoryChangeRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      requestId,
      decision,
      note,
    }: {
      requestId: string;
      decision: 'approved' | 'rejected';
      note?: string;
    }) => hrmsApi.patch(`/api/statutory-change-requests/${requestId}`, { decision, note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['statutory-change-requests', 'pending'] });
    },
  });
}
