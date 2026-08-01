import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export type SocialPlatform = "facebook" | "instagram" | "youtube";
export type SocialPlatformFilter = SocialPlatform | "all";

export interface SocialPost {
  id: string;
  platform: SocialPlatform;
  platform_post_id: string;
  content_text: string | null;
  media_url: string | null;
  post_url: string;
  like_count: number;
  comment_count: number;
  published_at: string | null;
  fetched_at: string;
}

interface FeedResponse {
  posts: SocialPost[];
  total: number;
}

export function useSocialFeed(platform: SocialPlatformFilter = "all", page = 1, limit = 10) {
  return useQuery<FeedResponse>({
    queryKey: ["social-feed", platform, page, limit],
    queryFn: async () => {
      const res = await hrmsApi.get<any>(
        `/api/social-feed/posts?platform=${platform}&page=${page}&limit=${limit}`,
      );
      return {
        posts: (res?.posts ?? []) as SocialPost[],
        total: Number(res?.total ?? 0),
      };
    },
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

export interface PlatformConfig {
  id: string;
  platform: SocialPlatform;
  page_id: string;
  access_token: string | null;
  token_expiry: string | null;
  enabled: boolean;
  last_synced_at: string | null;
}

interface AdminConfigResponse {
  configs: PlatformConfig[];
  counts: Record<string, number>;
}

export function useSocialFeedAdminConfig() {
  return useQuery<AdminConfigResponse>({
    queryKey: ["social-feed-admin-config"],
    queryFn: async () => {
      const res = await hrmsApi.get<any>("/api/social-feed/admin/config");
      return {
        configs: (res?.configs ?? []) as PlatformConfig[],
        counts: (res?.counts ?? {}) as Record<string, number>,
      };
    },
    staleTime: 60_000,
  });
}

export function useSaveSocialConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      platform: SocialPlatform;
      page_id: string;
      plain_token?: string;
      token_expiry?: string | null;
      enabled?: boolean;
    }) => {
      await hrmsApi.post("/api/social-feed/admin/config", data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["social-feed-admin-config"] });
    },
  });
}

export function useSyncSocialFeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await hrmsApi.post<any>("/api/social-feed/admin/sync", {});
      return res?.synced as Record<string, number>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["social-feed"] });
      qc.invalidateQueries({ queryKey: ["social-feed-admin-config"] });
    },
  });
}
