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
  content_text: string | null;
  status: CompanyPostStatus;
  moderation_state: CompanyPostModerationState;
  moderation_score: number | null;
  auto_reject_reason: string | null;
  review_notes: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
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

interface CompanyFeedApiResponse<T> {
  success: boolean;
  data: T;
}

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

function normalizeQueryKey(params?: CompanyFeedQueryParams): string {
  return buildQueryString(params);
}

export const companyFeedQueryKeys = {
  all: ["company-feed"] as const,
  feed: (params?: CompanyFeedQueryParams) =>
    ["company-feed", "feed", normalizeQueryKey(params)] as const,
  mine: (params?: CompanyFeedQueryParams) =>
    ["company-feed", "mine", normalizeQueryKey(params)] as const,
  approvals: (params?: CompanyFeedQueryParams) =>
    ["company-feed", "approvals", normalizeQueryKey(params)] as const,
  manage: (params?: CompanyFeedQueryParams) =>
    ["company-feed", "manage", normalizeQueryKey(params)] as const,
  creators: () => ["company-feed", "creators"] as const,
};

async function getCompanyPosts(path: string, params?: CompanyFeedQueryParams): Promise<CompanyPost[]> {
  const res = await hrmsApi.get<CompanyFeedApiResponse<CompanyPost[]>>(withQuery(path, params));
  return res.data ?? [];
}

function invalidateCompanyFeedCollections(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["company-feed", "feed"] });
  void queryClient.invalidateQueries({ queryKey: ["company-feed", "mine"] });
  void queryClient.invalidateQueries({ queryKey: ["company-feed", "approvals"] });
  void queryClient.invalidateQueries({ queryKey: ["company-feed", "manage"] });
}

export function useCompanyFeed(params?: CompanyFeedQueryParams) {
  return useQuery({
    queryKey: companyFeedQueryKeys.feed(params),
    queryFn: () => getCompanyPosts("/api/engagement/company-posts/feed", params),
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

export function useMyCompanyPosts(params?: CompanyFeedQueryParams) {
  return useQuery({
    queryKey: companyFeedQueryKeys.mine(params),
    queryFn: () => getCompanyPosts("/api/engagement/company-posts/mine", params),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

export function useCreateCompanyPost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateCompanyPostPayload) => {
      const res = await hrmsApi.post<CompanyFeedApiResponse<CompanyPost>>(
        "/api/engagement/company-posts",
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      invalidateCompanyFeedCollections(queryClient);
    },
  });
}

export function useApprovalQueue(params?: CompanyFeedQueryParams) {
  return useQuery({
    queryKey: companyFeedQueryKeys.approvals(params),
    queryFn: () => getCompanyPosts("/api/engagement/company-posts/approvals", params),
    placeholderData: (previous) => previous,
    staleTime: 10_000,
  });
}

export function useManageCompanyPosts(params?: CompanyFeedQueryParams) {
  return useQuery({
    queryKey: companyFeedQueryKeys.manage(params),
    queryFn: () => getCompanyPosts("/api/engagement/company-posts/manage", params),
    placeholderData: (previous) => previous,
    staleTime: 10_000,
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
      return res.data;
    },
    onSuccess: () => {
      invalidateCompanyFeedCollections(queryClient);
    },
  });
}

export function useRejectCompanyPost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ postId, ...payload }: ModerateCompanyPostPayload) => {
      const res = await hrmsApi.post<CompanyFeedApiResponse<CompanyPost>>(
        `/api/engagement/company-posts/${postId}/reject`,
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      invalidateCompanyFeedCollections(queryClient);
    },
  });
}

export function useDeleteCompanyPost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ postId, reason }: DeleteCompanyPostPayload) => {
      const res = await hrmsApi.delete<CompanyFeedApiResponse<null>>(
        `/api/engagement/company-posts/${postId}`,
        reason ? { params: { reason } } : undefined,
      );
      return res.data ?? null;
    },
    onSuccess: () => {
      invalidateCompanyFeedCollections(queryClient);
    },
  });
}

export function useCompanyPostCreators() {
  return useQuery({
    queryKey: companyFeedQueryKeys.creators(),
    queryFn: async () => {
      const res = await hrmsApi.get<CompanyFeedApiResponse<CompanyPostCreatorAccessRow[]>>(
        "/api/engagement/company-post-creators",
      );
      return res.data ?? [];
    },
    staleTime: 30_000,
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
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: companyFeedQueryKeys.creators() });
      invalidateCompanyFeedCollections(queryClient);
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
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: companyFeedQueryKeys.creators() });
      invalidateCompanyFeedCollections(queryClient);
    },
  });
}
