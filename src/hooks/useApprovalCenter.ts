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
  generatedAt: string;
}

export const APPROVAL_CENTER_KEY = "approval-center";

export function useApprovalCenter() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [APPROVAL_CENTER_KEY, user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
    queryFn: async (): Promise<ApprovalCenterData> => {
      const res = await hrmsApi.get<{ success: boolean; data: ApprovalCenterData }>("/api/approval-center/pending", 150_000);
      return res.data;
    },
  });
}

export function useDecideApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { uid: string; action: "approve" | "reject"; remarks?: string }) =>
      hrmsApi.post<{ success: boolean; message?: string }>("/api/approval-center/decide", v, 60_000),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [APPROVAL_CENTER_KEY] });
    },
  });
}
