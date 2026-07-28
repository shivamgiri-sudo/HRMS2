import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import type {
  EligiblePostingResponse,
  IjpApplicationWithDetails,
  IjpPostingWithDetails,
  EligibilityCheckResult,
} from "./types";

export function useEligibleIjpPostings() {
  return useQuery({
    queryKey: ["ijp", "my", "eligible"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ postings: EligiblePostingResponse[] }>("/api/ijp/my/eligible");
      return res.postings ?? [];
    },
    staleTime: 60_000,
  });
}

export function useMyIjpApplications() {
  return useQuery({
    queryKey: ["ijp", "my", "applications"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ applications: IjpApplicationWithDetails[]; total: number }>("/api/ijp/my/applications");
      return res.applications ?? [];
    },
    staleTime: 60_000,
  });
}

export function useIjpPostingDetail(postingId: string | null) {
  return useQuery({
    queryKey: ["ijp", "posting", postingId],
    queryFn: async () => {
      if (!postingId) return null;
      const res = await hrmsApi.get<{ posting: IjpPostingWithDetails }>(`/api/ijp/postings/${postingId}`);
      return res.posting;
    },
    enabled: Boolean(postingId),
    staleTime: 60_000,
  });
}

export function useIjpEligibilityCheck(postingId: string | null) {
  return useQuery({
    queryKey: ["ijp", "eligibility", postingId],
    queryFn: async () => {
      if (!postingId) return null;
      const res = await hrmsApi.get<{ eligibility: EligibilityCheckResult }>(`/api/ijp/postings/${postingId}/eligibility`);
      return res.eligibility;
    },
    enabled: Boolean(postingId),
    staleTime: 30_000,
  });
}

export function useApplyToIjp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ postingId, applicationNote }: { postingId: string; applicationNote?: string }) => {
      const res = await hrmsApi.post<{ application: IjpApplicationWithDetails; message: string }>(
        `/api/ijp/postings/${postingId}/apply`,
        { application_note: applicationNote }
      );
      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ijp", "my", "eligible"] });
      qc.invalidateQueries({ queryKey: ["ijp", "my", "applications"] });
    },
  });
}

export function useWithdrawIjpApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (applicationId: string) => {
      const res = await hrmsApi.delete<{ application: IjpApplicationWithDetails; message: string }>(
        `/api/ijp/applications/${applicationId}`
      );
      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ijp", "my", "eligible"] });
      qc.invalidateQueries({ queryKey: ["ijp", "my", "applications"] });
    },
  });
}

export function useIjpPostings(filters?: {
  status?: string;
  departmentId?: string;
  processId?: string;
  branchId?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: ["ijp", "postings", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.departmentId) params.set("department_id", filters.departmentId);
      if (filters?.processId) params.set("process_id", filters.processId);
      if (filters?.branchId) params.set("branch_id", filters.branchId);
      if (filters?.limit) params.set("limit", String(filters.limit));
      if (filters?.offset) params.set("offset", String(filters.offset));
      const qs = params.toString();
      const res = await hrmsApi.get<{ postings: IjpPostingWithDetails[]; total: number }>(
        `/api/ijp/postings${qs ? `?${qs}` : ""}`
      );
      return res;
    },
    staleTime: 30_000,
  });
}

export function useIjpPostingApplications(postingId: string | null, filters?: { status?: string }) {
  return useQuery({
    queryKey: ["ijp", "applications", postingId, filters],
    queryFn: async () => {
      if (!postingId) return { applications: [], total: 0 };
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      const qs = params.toString();
      const res = await hrmsApi.get<{ applications: IjpApplicationWithDetails[]; total: number }>(
        `/api/ijp/postings/${postingId}/applications${qs ? `?${qs}` : ""}`
      );
      return res;
    },
    enabled: Boolean(postingId),
    staleTime: 30_000,
  });
}

export function useCreateIjpPosting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Record<string, unknown>) => {
      const res = await hrmsApi.post<{ posting: IjpPostingWithDetails }>("/api/ijp/postings", input);
      return res.posting;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ijp", "postings"] });
    },
  });
}

export function useUpdateIjpPosting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Record<string, unknown> }) => {
      const res = await hrmsApi.patch<{ posting: IjpPostingWithDetails }>(`/api/ijp/postings/${id}`, input);
      return res.posting;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ijp", "postings"] });
    },
  });
}

export function usePublishIjpPosting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await hrmsApi.post<{ posting: IjpPostingWithDetails; message: string }>(`/api/ijp/postings/${id}/publish`, {});
      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ijp", "postings"] });
    },
  });
}

export function useCloseIjpPosting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason, filled }: { id: string; reason?: string; filled?: boolean }) => {
      const res = await hrmsApi.post<{ posting: IjpPostingWithDetails; message: string }>(`/api/ijp/postings/${id}/close`, {
        reason,
        filled,
      });
      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ijp", "postings"] });
    },
  });
}

export function useUpdateApplicationStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      applicationId,
      status,
      remarks,
      interviewScheduledAt,
      offerDetails,
    }: {
      applicationId: string;
      status: string;
      remarks?: string;
      interviewScheduledAt?: string;
      offerDetails?: Record<string, unknown>;
    }) => {
      const res = await hrmsApi.patch<{ application: IjpApplicationWithDetails }>(`/api/ijp/applications/${applicationId}/status`, {
        status,
        remarks,
        interview_scheduled_at: interviewScheduledAt,
        offer_details: offerDetails,
      });
      return res.application;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ijp", "applications"] });
      qc.invalidateQueries({ queryKey: ["ijp", "postings"] });
    },
  });
}

export function useIjpStats() {
  return useQuery({
    queryKey: ["ijp", "stats"],
    queryFn: async () => {
      const res = await hrmsApi.get<{
        stats: {
          total_postings: number;
          open_postings: number;
          total_applications: number;
          pending_review: number;
          selected_this_month: number;
        };
      }>("/api/ijp/stats");
      return res.stats;
    },
    staleTime: 60_000,
  });
}
