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

// The backend writes 'festival' too (festival-greeting.cron.ts, company_posts.post_type) —
// missing here meant TypeScript could never distinguish a festival post from a plain 'user'
// one, which is exactly why FeedPostCard's celebration routing below silently excluded it.
export type CompanyPostType = "user" | "birthday" | "anniversary" | "festival";

export interface CompanyPost {
  id: string;
  author_user_id: string;
  author_employee_id: string | null;
  author_name: string | null;
  author_code: string | null;
  content_text: string | null;
  post_type: CompanyPostType;
  is_system_post: boolean;
  celebrated_employee_id: string | null;
  celebrated_employee_name: string | null;
  celebrated_employee_code: string | null;
  celebrated_employee_avatar: string | null;
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
  like_count: number;
  dislike_count: number;
  comment_count: number;
  my_reaction: "like" | "dislike" | null;
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

export interface CommentItem {
  id: string;
  post_id: string;
  user_id: string;
  author_name: string | null;
  author_code: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface CommentListResult {
  comments: CommentItem[];
  total: number;
}

export interface ReactToPostPayload {
  postId: string;
  reaction: "like" | "dislike";
}

export interface AddCommentPayload {
  postId: string;
  body: string;
}

export interface DeleteCommentPayload {
  postId: string;
  commentId: string;
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
  comments: (postId: string) => ["company-feed", "comments", postId] as const,
};

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchPagedPosts(path: string, params?: CompanyFeedQueryParams): Promise<CompanyFeedPageResult> {
  const res = await hrmsApi.get<CompanyFeedPageApiResponse>(withQuery(path, params));
  const body = res;
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
  const body = res;
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
      const body = res;
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
      const body = res;
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
      const body = res;
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
      const body = res;
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
      const body = res;
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
      const body = res;
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
      const body = res;
      if (!body?.success) throw new Error(body?.error ?? "Request failed");
      return body.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: companyFeedQueryKeys.creators() });
    },
  });
}

export function useReactToPost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ postId, reaction }: ReactToPostPayload) => {
      const res = await hrmsApi.post<{ success: boolean; error?: string }>(
        `/api/engagement/company-posts/${postId}/react`,
        { reaction },
      );
      if (!res?.success) throw new Error(res?.error ?? "Request failed");
      return null;
    },
    onMutate: async ({ postId, reaction }) => {
      await queryClient.cancelQueries({ queryKey: ["company-feed", "feed"] });
      const previousData = queryClient.getQueriesData({ queryKey: ["company-feed", "feed"] });
      queryClient.setQueriesData(
        { queryKey: ["company-feed", "feed"] },
        (old: CompanyFeedPageResult | undefined) => {
          if (!old) return old;
          return {
            ...old,
            posts: old.posts.map((p) => {
              if (p.id !== postId) return p;
              const prevReaction = p.my_reaction;
              const isSame = prevReaction === reaction;
              const newLikeCount = p.like_count + (reaction === "like" ? (isSame ? -1 : 1) : (prevReaction === "like" ? -1 : 0));
              const newDislikeCount = p.dislike_count + (reaction === "dislike" ? (isSame ? -1 : 1) : (prevReaction === "dislike" ? -1 : 0));
              return {
                ...p,
                my_reaction: isSame ? null : reaction,
                like_count: Math.max(0, newLikeCount),
                dislike_count: Math.max(0, newDislikeCount),
              };
            }),
          };
        },
      );
      return { previousData };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousData) {
        for (const [queryKey, data] of context.previousData) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["company-feed", "feed"] });
    },
  });
}

export function useComments(postId: string, enabled = true) {
  return useQuery({
    queryKey: companyFeedQueryKeys.comments(postId),
    queryFn: async () => {
      const res = await hrmsApi.get<CommentListResult & { success: boolean; error?: string }>(
        `/api/engagement/company-posts/${postId}/comments`,
      );
      if (!res?.success) throw new Error(res?.error ?? "Request failed");
      return { comments: res.comments ?? [], total: res.total ?? 0 };
    },
    enabled: enabled && !!postId,
    staleTime: 15_000,
  });
}

export function useAddComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ postId, body }: AddCommentPayload) => {
      const res = await hrmsApi.post<{ success: boolean; data: CommentItem; error?: string }>(
        `/api/engagement/company-posts/${postId}/comments`,
        { body },
      );
      if (!res?.success) throw new Error(res?.error ?? "Request failed");
      return res.data;
    },
    onSuccess: (_data, { postId }) => {
      void queryClient.invalidateQueries({ queryKey: companyFeedQueryKeys.comments(postId) });
      void queryClient.invalidateQueries({ queryKey: ["company-feed", "feed"] });
    },
  });
}

export function useDeleteComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ postId, commentId }: DeleteCommentPayload) => {
      const res = await hrmsApi.delete<{ success: boolean; error?: string }>(
        `/api/engagement/company-posts/${postId}/comments/${commentId}`,
      );
      if (!res?.success) throw new Error(res?.error ?? "Request failed");
      return null;
    },
    onSuccess: (_data, { postId }) => {
      void queryClient.invalidateQueries({ queryKey: companyFeedQueryKeys.comments(postId) });
      void queryClient.invalidateQueries({ queryKey: ["company-feed", "feed"] });
    },
  });
}

// Kept for backward compat — internal only, not exported as a public API surface
export { fetchSinglePost };
