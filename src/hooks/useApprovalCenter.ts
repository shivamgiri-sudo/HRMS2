import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";

export interface ApprovalField {
  label: string;
  value: string;
  type?: "text" | "money" | "date" | "long" | "badge";
}

export interface ApprovalItem {
  uid: string;
  kind: string;
  kindLabel: string;
  category: string;
  id: string;
  title: string;
  subtitle?: string;
  requester?: { name?: string | null; code?: string | null; branch?: string | null };
  stage?: string;
  fields: ApprovalField[];
  submittedAt?: string | null;
  priority?: "high" | "normal";
  viewPath: string;
  rejectNeedsReason: boolean;
  rejectMinLength?: number;
  approveLabel?: string;
  rejectLabel?: string;
  viewOnly?: boolean;
  noReject?: boolean;
  noApprove?: boolean;
}

export interface ApprovalCenterData {
  items: ApprovalItem[];
  counts: Record<string, number>;
  failed: Array<{ kind: string; label: string; reason: string }>;
  /** Older pending requests left out of the popup (they remain on their own pages). */
  staleHidden?: number;
  partial?: boolean;
  pendingKinds?: string[];
  generatedAt: string;
}

export const APPROVAL_CENTER_KEY = "approval-center";

// Set after a decision so the next list bypasses the server cache once.
let forceFresh = false;

export function useApprovalCenter() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [APPROVAL_CENTER_KEY, user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    // While some queues are still computing on the server, ask again shortly; otherwise the normal 5-minute refresh.
    refetchInterval: (q) => (q.state.data?.partial ? 6_000 : 5 * 60_000),
    refetchOnWindowFocus: true,
    retry: 1,
    queryFn: async (): Promise<ApprovalCenterData> => {
      const fresh = forceFresh;
      forceFresh = false;
      const res = await hrmsApi.get<{ success: boolean; data: ApprovalCenterData }>(
        fresh ? "/api/approval-center/pending?fresh=1" : "/api/approval-center/pending",
        150_000,
      );
      return res.data;
    },
  });
}

export function useDecideApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { uid: string; action: "approve" | "reject"; remarks?: string }) =>
      hrmsApi.post<{ success: boolean; message?: string }>("/api/approval-center/decide", v, 60_000),
    onSuccess: (_r, v) => {
      // Drop the actioned card at once; the refetch then confirms from a fresh server list.
      qc.setQueriesData<ApprovalCenterData>({ queryKey: [APPROVAL_CENTER_KEY] }, (old) =>
        old ? { ...old, items: old.items.filter((i) => i.uid !== v.uid) } : old,
      );
      forceFresh = true;
      void qc.invalidateQueries({ queryKey: [APPROVAL_CENTER_KEY] });
    },
  });
}
