import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export type CompanyPostStatus =
  | "draft"
  | "pending_approval"
  | "borderline_flagged"
  | "approved"
  | "rejected"
  | "auto_rejected"
  | "deleted";

export type CompanyPostModerationState =
  | "clean"
  | "borderline"
  | "violation"
  | "manual_override_approved"
  | "manual_override_rejected";

export type CompanyPostMediaType = "image";

export interface CompanyPostMedia {
  id?: string;
  file_id: string;
  media_type: CompanyPostMediaType;
  sort_order: number;
  moderation_state?: CompanyPostModerationState;
  moderation_reason?: string | null;
}

export interface CompanyPost {
  id: string;
  author_user_id: string;
  author_employee_id: string;
  author_name: string | null;
  author_code: string | null;
  content_text: string | null;
  status: CompanyPostStatus;
  moderation_state: CompanyPostModerationState;
  moderation_score: number | null;
  auto_reject_reason: string | null;
  review_notes: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  approved_by_name: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  rejected_by_name: string | null;
  rejection_reason: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  active_status: boolean;
  created_at: string;
  updated_at: string;
  media: CompanyPostMedia[];
}

export interface CompanyPostCreatorAccessRow {
  id: string;
  employee_id: string;
  user_id: string;
  active_status: boolean;
  granted_by: string | null;
  granted_at: string;
  revoked_by: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
  employee_name: string | null;
  employee_code: string | null;
  department: string | null;
}

export interface CompanyFeedQueryParams {
  page?: number;
  limit?: number;
  status?: CompanyPostStatus;
  search?: string;
}

export interface CreateCompanyPostPayload {
  content_text?: string;
  media?: Array<{
    file_id: string;
    media_type: CompanyPostMediaType;
    sort_order: number;
  }>;
}

export interface ModerateCompanyPostPayload {
  postId: string;
  review_notes?: string;
}

export interface RejectCompanyPostPayload {
  postId: string;
  reason?: string;
  review_notes?: string;
}

export interface DeleteCompanyPostPayload {
  postId: string;
  reason?: string;
}

export interface GrantCompanyPostCreatorPayload {
  employeeId: string;
  user_id?: string;
}

export interface RevokeCompanyPostCreatorPayload {
  employeeId: string;
}

export interface CompanyFeedPageResult {
  posts: CompanyPost[];
  total: number;
  page: number;
  limit: number;
}

interface CompanyFeedApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface CompanyFeedPageApiResponse {
  success: boolean;
  posts: CompanyPost[];
  total: number;
  page: number;
  limit: number;
  error?: string;
}

// ─── Shared status metadata ───────────────────────────────────────────────────

export interface StatusMeta {
  label: string;
  color: string;
  bg: string;
}

export function getStatusMeta(status: CompanyPostStatus): StatusMeta {
  switch (status) {
    case "approved":
      return { label: "Published", color: "text-emerald-700", bg: "bg-emerald-50" };
    case "pending_approval":
      return { label: "Awaiting review", color: "text-amber-700", bg: "bg-amber-50" };
    case "borderline_flagged":
      return { label: "Needs moderator review", color: "text-orange-700", bg: "bg-orange-50" };
    case "rejected":
      return { label: "Rejected", color: "text-red-700", bg: "bg-red-50" };
    case "auto_rejected":
      return { label: "Auto-rejected", color: "text-red-800", bg: "bg-red-100" };
    case "deleted":
      return { label: "Deleted", color: "text-slate-500", bg: "bg-slate-100" };
    case "draft":
      return { label: "Draft", color: "text-slate-600", bg: "bg-slate-50" };
    default:
      return { label: String(status), color: "text-slate-600", bg: "bg-slate-50" };
  }
}

// ─── Query keys ───────────────────────────────────────────────────────────────

function buildQueryString(params?: CompanyFeedQueryParams): string {
  if (!params) return "";
  const searchParams = new URLSearchParams();
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right));
  for (const [key, value] of entries) {
    searchParams.set(key, String(value));
  }
  return searchParams.toString();
}

function withQuery(path: string, params?: CompanyFeedQueryParams): string {
  const query = buildQueryString(params);
  return query ? `${path}?${query}` : path;
}

export const companyFeedQueryKeys = {
  all: ["company-feed"] as const,
  feed: (params?: CompanyFeedQueryParams) =>
    ["company-feed", "feed", buildQueryString(params)] as const,
  mine: (params?: CompanyFeedQueryParams) =>
    ["company-feed", "mine", buildQueryString(params)] as const,
  approvals: (params?: CompanyFeedQueryParams) =>
    ["company-feed", "approvals", buildQueryString(params)] as const,
  manage: (params?: CompanyFeedQueryParams) =>
    ["company-feed", "manage", buildQueryString(params)] as const,
  creators: () => ["company-feed", "creators"] as const,
};

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchPagedPosts(path: string, params?: CompanyFeedQueryParams): Promise<CompanyFeedPageResult> {
  const res = await hrmsApi.get<CompanyFeedPageApiResponse>(withQuery(path, params));
  const body = res.data;
  if (!body?.success) throw new Error(body?.error ?? "Request failed");
  return {
    posts: body.posts ?? [],
    total: body.total ?? 0,
    page: body.page ?? 1,
    limit: body.limit ?? 20,
  };
}

async function fetchSinglePost(path: string): Promise<CompanyPost> {
  const res = await hrmsApi.get<CompanyFeedApiResponse<CompanyPost>>(path);
  const body = res.data;
  if (!body?.success) throw new Error(body?.error ?? "Request failed");
  return body.data;
}

// ─── Query hooks ──────────────────────────────────────────────────────────────

export function useCompanyFeed(params?: CompanyFeedQueryParams) {
  return useQuery({
    queryKey: companyFeedQueryKeys.feed(params),
    queryFn: () => fetchPagedPosts("/api/engagement/company-posts/feed", params),
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

export function useMyCompanyPosts(params?: CompanyFeedQueryParams) {
  return useQuery({
    queryKey: companyFeedQueryKeys.mine(params),
    queryFn: () => fetchPagedPosts("/api/engagement/company-posts/mine", params),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

export function useApprovalQueue(params?: CompanyFeedQueryParams) {
  return useQuery({
    queryKey: companyFeedQueryKeys.approvals(params),
    queryFn: () => fetchPagedPosts("/api/engagement/company-posts/approvals", params),
    placeholderData: (previous) => previous,
    staleTime: 10_000,
  });
}

export function useManageCompanyPosts(params?: CompanyFeedQueryParams) {
  return useQuery({
    queryKey: companyFeedQueryKeys.manage(params),
    queryFn: () => fetchPagedPosts("/api/engagement/company-posts/manage", params),
    placeholderData: (previous) => previous,
    staleTime: 10_000,
  });
}

export function useCompanyPostCreators() {
  return useQuery({
    queryKey: companyFeedQueryKeys.creators(),
    queryFn: async () => {
      const res = await hrmsApi.get<CompanyFeedApiResponse<CompanyPostCreatorAccessRow[]>>(
        "/api/engagement/company-post-creators",
      );
      const body = res.data;
      if (!body?.success) throw new Error(body?.error ?? "Request failed");
      return body.data ?? [];
    },
    staleTime: 30_000,
  });
}

// ─── Mutation hooks ───────────────────────────────────────────────────────────

export function useCreateCompanyPost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateCompanyPostPayload) => {
      const res = await hrmsApi.post<CompanyFeedApiResponse<CompanyPost>>(
        "/api/engagement/company-posts",
        payload,
      );
      const body = res.data;
      if (!body?.success) throw new Error(body?.error ?? "Request failed");
      return body.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["company-feed", "mine"] });
      void queryClient.invalidateQueries({ queryKey: ["company-feed", "feed"] });
    },
  });
}

export function useApproveCompanyPost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ postId, ...payload }: ModerateCompanyPostPayload) => {
      const res = await hrmsApi.post<CompanyFeedApiResponse<CompanyPost>>(
        `/api/engagement/company-posts/${postId}/approve`,
        payload,
      );
      const body = res.data;
      if (!body?.success) throw new Error(body?.error ?? "Request failed");
      return body.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["company-feed", "approvals"] });
      void queryClient.invalidateQueries({ queryKey: ["company-feed", "manage"] });
      void queryClient.invalidateQueries({ queryKey: ["company-feed", "feed"] });
    },
  });
}

export function useRejectCompanyPost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ postId, ...payload }: RejectCompanyPostPayload) => {
      const res = await hrmsApi.post<CompanyFeedApiResponse<CompanyPost>>(
        `/api/engagement/company-posts/${postId}/reject`,
        payload,
      );
      const body = res.data;
      if (!body?.success) throw new Error(body?.error ?? "Request failed");
      return body.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["company-feed", "approvals"] });
      void queryClient.invalidateQueries({ queryKey: ["company-feed", "manage"] });
    },
  });
}

export function useDeleteCompanyPost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ postId, reason }: DeleteCompanyPostPayload) => {
      const res = await hrmsApi.delete<CompanyFeedApiResponse<null>>(
        `/api/engagement/company-posts/${postId}`,
        { data: { reason } },
      );
      const body = res.data;
      if (!body?.success) throw new Error(body?.error ?? "Request failed");
      return null;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["company-feed", "manage"] });
      void queryClient.invalidateQueries({ queryKey: ["company-feed", "feed"] });
    },
  });
}

export function useGrantCompanyPostCreator() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ employeeId, ...payload }: GrantCompanyPostCreatorPayload) => {
      const res = await hrmsApi.post<CompanyFeedApiResponse<CompanyPostCreatorAccessRow>>(
        `/api/engagement/company-post-creators/${employeeId}/grant`,
        payload,
      );
      const body = res.data;
      if (!body?.success) throw new Error(body?.error ?? "Request failed");
      return body.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: companyFeedQueryKeys.creators() });
    },
  });
}

export function useRevokeCompanyPostCreator() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ employeeId }: RevokeCompanyPostCreatorPayload) => {
      const res = await hrmsApi.post<CompanyFeedApiResponse<CompanyPostCreatorAccessRow>>(
        `/api/engagement/company-post-creators/${employeeId}/revoke`,
        {},
      );
      const body = res.data;
      if (!body?.success) throw new Error(body?.error ?? "Request failed");
      return body.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: companyFeedQueryKeys.creators() });
    },
  });
}

// Kept for backward compat — internal only, not exported as a public API surface
export { fetchSinglePost };
